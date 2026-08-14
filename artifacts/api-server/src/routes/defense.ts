import { Router } from "express";
import { db, blockedIpsTable, defenseActionsTable, systemStatusTable, defenseCommandsTable, defenseRulesTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { z } from "zod";
import { isAutoDefenseEnabled, setSetting } from "../lib/app-settings";
import { sanitizeIp } from "../lib/defense-sanitize";
import { ensureSystemStatusSeeded } from "./system";
import { requireAuth } from "../lib/jwt-auth";

const router = Router();
const PFSENSE_IP = "10.30.30.1";

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

// ─── Admin manual block ───────────────────────────────────────────────────────
router.post("/defense/block", requireAuth, async (req, res) => {
  const schema = z.object({
    ip:     z.string(),
    reason: z.string().default("Admin manual block"),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "ip required" }); return; }

  let safeIp: string;
  try { safeIp = sanitizeIp(body.data.ip); }
  catch { res.status(400).json({ error: "Invalid IP address" }); return; }

  const reason = body.data.reason.slice(0, 200);

  // Idempotent — if already blocked just return the existing row
  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, safeIp), eq(blockedIpsTable.isActive, true)));
  if (existing.length > 0) {
    res.json({ already: true, ip: safeIp });
    return;
  }

  // Insert to blocked_ips
  await db.insert(blockedIpsTable).values({
    ip: safeIp, reason, blockedBy: "manual", isActive: true,
  });

  // Queue iptables DROP + session kill on all VMs.
  // -I (insert) takes priority over existing ACCEPT rules.
  // ss -K terminates live connections so the block hits active sessions immediately.
  await db.insert(defenseCommandsTable).values({
    targetVm: "all", commandType: "iptables",
    commandText: `iptables -I INPUT -s ${safeIp} -j DROP && ss -K dst ${safeIp} 2>/dev/null; ss -K src ${safeIp} 2>/dev/null; true`,
    targetIp: safeIp, status: "pending",
  });

  // Queue pfSense block
  await db.insert(defenseCommandsTable).values({
    targetVm: "pfsense", commandType: "ssh_pfsense",
    commandText: `easyrule block WAN ${safeIp}`,
    targetIp: safeIp, status: "pending",
  });

  // Log action
  await db.insert(defenseActionsTable).values({
    type: "manual", action: "block", targetIp: safeIp,
    reason: `Admin manual block: ${reason}`,
    performedBy: "admin", status: "queued",
  });

  res.status(201).json({ blocked: true, ip: safeIp });
});

router.delete("/defense/block/:ip", requireAuth, async (req, res) => {
  const rawIp = req.params.ip;
  const ip = Array.isArray(rawIp) ? rawIp[0] : rawIp;
  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length === 0) { res.status(404).json({ error: "IP not found in block list" }); return; }

  try {
    const safeIp = sanitizeIp(ip);
    const block = existing[0];
    if (block.blockedBy.startsWith("fail2ban:")) {
      const jail = block.blockedBy.slice("fail2ban:".length);
      const targetByIp: Record<string, string> = {
        "10.10.10.10": "company-web-server",
        "10.10.10.20": "company-dns-server",
        "10.20.20.10": "company-customer-db",
        "10.20.20.20": "company-ldap-server",
      };
      const targetVm = targetByIp[block.targetHost ?? ""] ?? block.targetHost;
      if (!targetVm) throw new Error("Fail2ban target is missing");
      const [command] = await db.insert(defenseCommandsTable).values({
        targetVm, commandType: "fail2ban_unban",
        commandText: `fail2ban-client set ${jail} unbanip ${safeIp}`,
        targetIp: safeIp, status: "pending",
      }).returning();
      // Also flush any direct iptables DROP rule that auto-defense may have
      // added on the same VM (auto-defense queues iptables before the
      // idempotent blocked_ips check, so the rule can exist even when
      // blockedBy is "fail2ban:*").  Use 2>/dev/null || true so the command
      // succeeds even if no matching rule exists.
      await db.insert(defenseCommandsTable).values({
        targetVm, commandType: "iptables",
        commandText: `iptables -D INPUT -s ${safeIp} -j DROP 2>/dev/null || true`,
        targetIp: safeIp, status: "pending",
      });
      await db.insert(defenseActionsTable).values({
        type: "manual", action: "unblock", targetIp: safeIp,
        targetHost: block.targetHost,
        reason: `Fail2ban unban queued; command #${command.id}`,
        performedBy: "admin", status: "queued",
      });
    } else {
      await db.insert(defenseCommandsTable).values({
        targetVm: "all", commandType: "iptables",
        // Use both -D and -F variants to handle rules added with -I or -A
        commandText: `iptables -D INPUT -s ${safeIp} -j DROP 2>/dev/null || true`,
        targetIp: safeIp, status: "pending",
      });
      const [pfCommand] = await db.insert(defenseCommandsTable).values({
        targetVm: "pfsense", commandType: "ssh_pfsense",
        commandText: `easyrule unblock WAN ${safeIp}`,
        targetIp: safeIp, status: "pending",
      }).returning();
      await db.insert(defenseActionsTable).values({
        type: "manual", action: "unblock", targetIp: safeIp,
        reason: `Admin unblock queued; pfSense command #${pfCommand.id}`,
        performedBy: "admin", status: "queued",
      });
    }

    // Immediately mark as unblocked in the DB so the active-blocks list
    // reflects the intent right away — even if the VM command is still pending.
    await db.update(blockedIpsTable)
      .set({ isActive: false, unblockedAt: new Date() })
      .where(and(eq(blockedIpsTable.ip, safeIp), eq(blockedIpsTable.isActive, true)));

  } catch {
    res.status(400).json({ error: "Unblock could not be queued safely" });
    return;
  }

  res.status(202).json({ queued: true, ip });
});

router.get("/defense/actions", async (req, res) => {
  const device = (req.query.device as string) || undefined;
  const limit  = Math.min(Number(req.query.limit)  || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const conditions = device ? [eq(defenseActionsTable.targetHost, device)] : [];
  const actions = await db.select().from(defenseActionsTable)
    .where(conditions.length > 0 ? conditions[0] : undefined)
    .orderBy(desc(defenseActionsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(actions.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.get("/defense/status", async (req, res) => {
  const device = (req.query.device as string) || null;
  await ensureSystemStatusSeeded();

  // 5-minute staleness threshold for VM sensors (matches system.ts STALE_VM_MS)
  const STALE_MS = 5 * 60 * 1000;
  const now = Date.now();

  const [activeBlocks, recentActions, sensorRows, autoDefenseEnabled] = await Promise.all([
    db.select().from(blockedIpsTable).where(eq(blockedIpsTable.isActive, true)),
    db.select().from(defenseActionsTable).orderBy(desc(defenseActionsTable.createdAt)).limit(5),
    db.select().from(systemStatusTable),
    isAutoDefenseEnabled(),
  ]);

  // Apply staleness: VM-reported sensors last seen > 5 min ago = offline
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
      // pfSense is represented by global infrastructure rows because its
      // Suricata sensor covers all zones rather than one VM host.
      if (device === PFSENSE_IP && name.toLowerCase().includes("suricata")) {
        return matching.some(r => !r.hostIp && r.status === "online");
      }
      const row = matching.find(r => r.hostIp === device);
      return row?.status === "online";
    }
    return matching.some(r => r.status === "online");
  }

  // Per-host sensor breakdown — returns every sensor row per host so the UI
  // can show all sensors, not just fail2ban + suricata.
  const hostIps = [...new Set(liveSensorRows.filter(r => r.hostIp).map(r => r.hostIp as string))];
  const perHostSensors = hostIps.map(hostIp => {
    const rows = liveSensorRows.filter(r => r.hostIp === hostIp);
    const f2bRow = rows.find(r => r.component.toLowerCase().includes("fail2ban"));
    const surRow = rows.find(r => r.component.toLowerCase().includes("suricata"));
    return {
      hostIp,
      sensors: rows.map(r => ({ component: r.component, status: r.status })),
      // legacy fields kept for device-scoped ServiceCards in the frontend
      fail2ban: f2bRow != null ? f2bRow.status === "online" : null,
      suricata: surRow != null ? surRow.status === "online" : null,
    };
  });
  const pfsenseSuricata = liveSensorRows.find(
    r => r.component.toLowerCase().includes("pfsense suricata") && !r.hostIp,
  );
  if (pfsenseSuricata) {
    perHostSensors.push({
      hostIp: PFSENSE_IP,
      sensors: [{ component: pfsenseSuricata.component, status: pfsenseSuricata.status }],
      fail2ban: null,
      suricata: pfsenseSuricata.status === "online",
    });
  }

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
// Browser mutation: requires a valid admin JWT (VM agents use their own key path).
router.patch("/defense/settings", requireAuth, async (req, res) => {
  const schema = z.object({ autoDefenseEnabled: z.boolean() });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "autoDefenseEnabled (boolean) required" }); return; }

  await setSetting("autoDefenseEnabled", String(body.data.autoDefenseEnabled));

  let cancelledCommands = 0;
  if (!body.data.autoDefenseEnabled) {
    // Cancel ALL pending defense commands that were queued by the auto-defense
    // engine (company VM iptables + pfSense API).  Commands that were already
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
