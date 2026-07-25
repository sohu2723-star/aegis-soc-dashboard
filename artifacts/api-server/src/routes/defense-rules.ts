/**
 * Defense Rules + Command Queue API
 * All mutation endpoints require X-AEGIS-Admin-Key.
 * Agent polling (/defense/commands/pending) also requires the admin key.
 */
import { Router } from "express";
import { db, blockedIpsTable, defenseActionsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/admin-auth";
import { broadcaster } from "../lib/broadcaster";

const router = Router();

// ─── Command queue (agent polling) ────────────────────────────────────────────
// Atomic claim: one UPDATE ... RETURNING statement with SKIP LOCKED.

router.get("/defense/commands/pending", requireAdmin, async (req, res) => {
  const vm = (req.query.vm as string) ?? "company-web-server";

  const claimed = await db.execute(sql`
    WITH claim AS (
      SELECT id FROM defense_commands
      WHERE status = 'pending'
        AND (target_vm = ${vm} OR target_vm = 'all')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 20
    )
    UPDATE defense_commands AS dc
    SET status = 'sent'
    FROM claim
    WHERE dc.id = claim.id
    RETURNING
      dc.id,
      dc.rule_id AS "ruleId",
      dc.event_id AS "eventId",
      dc.target_vm AS "targetVm",
      dc.command_type AS "commandType",
      dc.command_text AS "commandText",
      dc.undo_command AS "undoCommand",
      dc.target_ip AS "targetIp",
      dc.status,
      dc.error_msg AS "errorMsg",
      dc.created_at AS "createdAt",
      dc.executed_at AS "executedAt"
  `);
  res.json(claimed);
});

router.post("/defense/commands/:id/result", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { success, error } = req.body;
  const updated = await db.execute(sql`
    UPDATE defense_commands
    SET status = ${success ? "executed" : "failed"},
        error_msg = ${error ? String(error).slice(0, 500) : null},
        executed_at = NOW()
    WHERE id = ${id} AND status = 'sent'
    RETURNING command_type AS "commandType", command_text AS "commandText", target_ip AS "targetIp"
  `);
  if (updated.length === 0) {
    res.status(409).json({ error: "Command was not in sent state" });
    return;
  }
  const command = updated[0] as { commandType: string; commandText: string; targetIp: string | null };
  const confirmedUnblock = success && command.targetIp && (
    (command.commandType === "ssh_pfsense" && command.commandText.startsWith("pfctl -t EasyRuleBlockHosts -T delete ")) ||
    command.commandType === "fail2ban_unban"
  );
  if (confirmedUnblock && command.targetIp) {
    await db.update(blockedIpsTable).set({ isActive: false, unblockedAt: new Date() })
      .where(and(eq(blockedIpsTable.ip, command.targetIp), eq(blockedIpsTable.isActive, true)));
    await db.insert(defenseActionsTable).values({
      type: "manual", action: "unblock", targetIp: command.targetIp,
      reason: command.commandType === "fail2ban_unban"
        ? "Fail2ban unban executed"
        : "pfSense EasyRuleBlockHosts removal executed",
      performedBy: "aegis-defense-agent", status: "success",
    });
  }
  broadcaster.broadcast("defense_result", {
    commandId: id, commandType: command.commandType, targetIp: command.targetIp,
    status: success ? "executed" : "failed", error: success ? null : String(error ?? "Execution failed").slice(0, 200),
    timestamp: new Date().toISOString(),
  });
  res.json({ ok: true });
});

export default router;
