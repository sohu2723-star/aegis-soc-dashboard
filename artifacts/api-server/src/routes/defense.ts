import { Router } from "express";
import { db, blockedIpsTable, defenseActionsTable, systemStatusTable, defenseCommandsTable, defenseRulesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
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

router.get("/defense/status", async (req, res) => {
  const device = (req.query.device as string) || null;

  // 3-minute staleness threshold — same as system.ts
  const STALE_MS = 3 * 60 * 1000;
  const now = Date.now();

  const [activeBlocks, recentActions, sensorRows, autoDefenseEnabled] = await Promise.all([
    db.select().from(blockedIpsTable).where(eq(blockedIpsTable.isActive, true)),
    db.select().from(defenseActionsTable).orderBy(desc(defenseActionsTable.createdAt)).limit(5),
    db.select().from(systemStatusTable),
    isAutoDefenseEnabled(),
  ]);

  // Apply staleness: VM-reported sensors last seen > 3 min ago = offline
  const liveSensorRows = sensorRows.map(r => ({
    ...r,
    status: (r.hostIp && r.status === "online" && now - r.lastCheck.getTime() > STALE_MS)
      ? "offline"
      : r.status,
  }));

  // Derive sensor liveness from system_status rows.
  // If device is selected: check only that host's row.
  // If "All Devices": true if ANY registered VM has the sensor online.
  function sensorOnline(name: string): boolean {
    const matching = liveSensorRows.filter(r =>
      r.component.toLowerCase().includes(name.toLowerCase())
    );
    if (device) {
      const row = matching.find(r => r.hostIp === device);
      return row?.status === "online";
    }
    return matching.some(r => r.status === "online");
  }

  // Per-host sensor breakdown (only when "All Devices" selected so the UI
  // knows which specific host has each sensor up or down).
  const hostIps = [...new Set(liveSensorRows.filter(r => r.hostIp).map(r => r.hostIp as string))];
  const perHostSensors = hostIps.map(hostIp => {
    const rows = liveSensorRows.filter(r => r.hostIp === hostIp);
    const f2b = rows.find(r => r.component.toLowerCase().includes("fail2ban"));
    const sur = rows.find(r => r.component.toLowerCase().includes("suricata"));
    return {
      hostIp,
      fail2ban: f2b ? f2b.status === "online" : null,
      suricata: sur ? sur.status === "online" : null,
    };
  });

  res.json({
    autoDefenseEnabled,
    fail2banActive: sensorOnline("fail2ban"),
    suricataActive: sensorOnline("suricata"),
    totalBlocked:   activeBlocks.length,
    recentActions:  recentActions.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
    perHostSensors,
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

  let cancelledCommands = 0;
  if (!body.data.autoDefenseEnabled) {
    // Cancel ALL pending defense commands that were queued by the auto-defense
    // engine (ubuntu iptables + pfSense API).  Commands that were already
    // claimed by a VM agent (status "running" or "done") are not touched —
    // those cannot be recalled, and the VM agent will execute or skip them
    // based on its own state.  Only "pending" (not yet claimed) commands are
    // cancelled here so that turning the toggle off has immediate effect on
    // queued-but-not-yet-dispatched rules.
    const result = await db
      .update(defenseCommandsTable)
      .set({ status: "cancelled" })
      .where(eq(defenseCommandsTable.status, "pending"))
      .returning();
    cancelledCommands = result.length;
  }

  res.json({ autoDefenseEnabled: body.data.autoDefenseEnabled, cancelledCommands });
});

export default router;
