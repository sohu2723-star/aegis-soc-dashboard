import { Router } from "express";
import { db, blockedIpsTable, defenseActionsTable, systemStatusTable, defenseCommandsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { isAutoDefenseEnabled, setSetting } from "../lib/app-settings";
import { sanitizeIp } from "../lib/defense-sanitize";

const router = Router();

router.get("/defense/blocks", async (req, res) => {
  const device = (req.query.device as string) || undefined;
  const blocks = await db.select().from(blockedIpsTable).orderBy(desc(blockedIpsTable.blockedAt));
  const filtered = device ? blocks.filter(b => b.targetHost === device) : blocks;
  res.json(filtered.map(b => ({
    ...b,
    blockedAt:   b.blockedAt.toISOString(),
    unblockedAt: b.unblockedAt ? b.unblockedAt.toISOString() : null,
  })));
});

router.post("/defense/block", async (req, res) => {
  const schema = z.object({
    ip:         z.string().ip(),
    reason:     z.string().min(1),
    blockedBy:  z.enum(["manual", "auto"]).optional(),
    targetHost: z.string().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid IP or reason" }); return; }

  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, body.data.ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length > 0) { res.status(409).json({ error: "IP already blocked" }); return; }

  const [row] = await db.insert(blockedIpsTable).values({
    ip:         body.data.ip,
    reason:     body.data.reason,
    blockedBy:  body.data.blockedBy ?? "manual",
    targetHost: body.data.targetHost ?? null,
    isActive:   true,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type:        body.data.blockedBy === "auto" ? "auto" : "manual",
    action:      "block",
    targetIp:    body.data.ip,
    targetHost:  body.data.targetHost ?? null,
    reason:      body.data.reason,
    performedBy: body.data.blockedBy === "auto" ? "system" : "admin",
    status:      "success",
  });

  // Also push the block out to the real infrastructure — queue commands for
  // whichever agents are polling (Ubuntu VM iptables + pfSense REST API).
  // defense_agent.py claims these via GET /defense/commands/pending and
  // executes them; if no agent is running yet the commands just sit as
  // "pending" and cause no harm.
  try {
    const safeIp = sanitizeIp(body.data.ip);
    await db.insert(defenseCommandsTable).values({
      targetVm:    "ubuntu",
      commandType: "iptables",
      commandText: `iptables -I INPUT -s ${safeIp} -j DROP`,
      undoCommand: `iptables -D INPUT -s ${safeIp} -j DROP`,
      targetIp:    safeIp,
      status:      "pending",
    });
    await db.insert(defenseCommandsTable).values({
      targetVm:    "pfsense",
      commandType: "pfsense_api",
      commandText: JSON.stringify({ action: "block_ip", ip: safeIp, reason: body.data.reason }),
      undoCommand: JSON.stringify({ action: "unblock_ip", ip: safeIp }),
      targetIp:    safeIp,
      status:      "pending",
    });
  } catch { /* invalid IP already rejected by zod above — defensive only */ }

  const [blocked] = await db.select().from(blockedIpsTable).where(eq(blockedIpsTable.id, row.id));
  res.json({ ...blocked, blockedAt: blocked.blockedAt.toISOString(), unblockedAt: null });
});

router.delete("/defense/block/:ip", async (req, res) => {
  const ip = req.params.ip;
  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length === 0) { res.status(404).json({ error: "IP not found in block list" }); return; }

  await db.update(blockedIpsTable).set({ isActive: false, unblockedAt: new Date() })
    .where(eq(blockedIpsTable.ip, ip));

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "unblock",
    targetIp:    ip,
    reason:      "Admin manually unblocked",
    performedBy: "admin",
    status:      "success",
  });

  try {
    const safeIp = sanitizeIp(ip);
    await db.insert(defenseCommandsTable).values({
      targetVm:    "ubuntu",
      commandType: "iptables",
      commandText: `iptables -D INPUT -s ${safeIp} -j DROP`,
      targetIp:    safeIp,
      status:      "pending",
    });
    await db.insert(defenseCommandsTable).values({
      targetVm:    "pfsense",
      commandType: "pfsense_api",
      commandText: JSON.stringify({ action: "unblock_ip", ip: safeIp }),
      targetIp:    safeIp,
      status:      "pending",
    });
  } catch { /* invalid IP format — nothing to unblock on agents */ }

  res.json({ success: true, ip });
});

router.get("/defense/actions", async (req, res) => {
  const device = (req.query.device as string) || undefined;
  const actions = await db.select().from(defenseActionsTable)
    .orderBy(desc(defenseActionsTable.createdAt)).limit(200);
  const filtered = device ? actions.filter(a => a.targetHost === device) : actions;
  res.json(filtered.slice(0, 100).map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.get("/defense/status", async (_req, res) => {
  const [activeBlocks, recentActions, sensorRows, autoDefenseEnabled] = await Promise.all([
    db.select().from(blockedIpsTable).where(eq(blockedIpsTable.isActive, true)),
    db.select().from(defenseActionsTable).orderBy(desc(defenseActionsTable.createdAt)).limit(5),
    db.select().from(systemStatusTable),
    isAutoDefenseEnabled(),
  ]);

  // Derive sensor liveness from system_status rows sent by the Ubuntu VM forwarder.
  // If the forwarder has never connected, these rows won't exist → show false.
  function sensorOnline(name: string) {
    const row = sensorRows.find(r => r.component.toLowerCase().includes(name.toLowerCase()));
    return row?.status === "online";
  }

  res.json({
    autoDefenseEnabled,
    fail2banActive: sensorOnline("fail2ban"),
    suricataActive: sensorOnline("suricata"),
    totalBlocked:   activeBlocks.length,
    recentActions:  recentActions.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
});

// ─── Auto-defense global toggle — real persisted setting ──────────────────────
// Same trust level as the manual block/unblock endpoints above: called directly
// from the (unauthenticated) dashboard UI, not from VM agents, so it does not
// require the VM-facing X-AEGIS-Admin-Key.
router.patch("/defense/settings", async (req, res) => {
  const schema = z.object({ autoDefenseEnabled: z.boolean() });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "autoDefenseEnabled (boolean) required" }); return; }

  await setSetting("autoDefenseEnabled", String(body.data.autoDefenseEnabled));
  res.json({ autoDefenseEnabled: body.data.autoDefenseEnabled });
});

export default router;
