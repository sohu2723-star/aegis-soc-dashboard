import { Router } from "express";
import { db, firewallRulesTable, defenseActionsTable, defenseCommandsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import {
  sanitizeChain,
  sanitizeFwAction,
  sanitizeFirewallPort,
  sanitizeInterface,
  sanitizeOptionalIp,
  sanitizeProtocol,
} from "../lib/defense-sanitize";

const router = Router();

// GET /firewall/rules — list all rules
router.get("/firewall/rules", async (_req, res) => {
  const rules = await db.select().from(firewallRulesTable)
    .where(eq(firewallRulesTable.isActive, true))
    .orderBy(desc(firewallRulesTable.appliedAt));
  res.json(rules.map(r => ({ ...r, appliedAt: r.appliedAt.toISOString() })));
});

// POST /firewall/rules — add a rule
router.post("/firewall/rules", async (req, res) => {
  const schema = z.object({
    chain:      z.enum(["INPUT", "OUTPUT", "FORWARD"]).default("INPUT"),
    action:     z.enum(["DROP", "ACCEPT", "REJECT", "LOG"]),
    protocol:   z.enum(["tcp", "udp", "icmp", "all"]).optional(),
    sourceIp:   z.string().optional(),
    destIp:     z.string().optional(),
    sourcePort: z.string().optional(),
    destPort:   z.string().optional(),
    iface:      z.string().optional(),
    createdBy:  z.string().default("admin"),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return; }

  const d = body.data;
  let chain: string;
  let action: string;
  let protocol: string | null;
  let sourceIp: string | null;
  let destIp: string | null;
  let sourcePort: string | null;
  let destPort: string | null;
  let iface: string | null;
  try {
    chain = sanitizeChain(d.chain);
    action = sanitizeFwAction(d.action);
    protocol = d.protocol ? sanitizeProtocol(d.protocol) : null;
    sourceIp = sanitizeOptionalIp(d.sourceIp);
    destIp = sanitizeOptionalIp(d.destIp);
    sourcePort = sanitizeFirewallPort(d.sourcePort);
    destPort = sanitizeFirewallPort(d.destPort);
    iface = sanitizeInterface(d.iface);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid firewall rule" });
    return;
  }

  // Build a shell-safe iptables command string.
  const parts = ["iptables", "-A", chain];
  if (protocol)   parts.push("-p", protocol);
  if (sourceIp)   parts.push("-s", sourceIp);
  if (destIp)     parts.push("-d", destIp);
  if (sourcePort) parts.push("--sport", sourcePort);
  if (destPort)   parts.push("--dport", destPort);
  if (iface)      parts.push("-i", iface);
  parts.push("-j", action);
  const ruleText = parts.join(" ");

  const [rule] = await db.insert(firewallRulesTable).values({
    chain, action, protocol, sourceIp, destIp, sourcePort, destPort, iface,
    ruleText,
    isActive:   true,
    createdBy:  d.createdBy,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "firewall_rule_add",
    targetIp:    sourceIp ?? "any",
    reason:      `Firewall rule added: ${ruleText}`,
    performedBy: d.createdBy,
    status:      "success",
  });

  await db.insert(defenseCommandsTable).values({
    targetVm: "all",
    commandType: "iptables",
    commandText: ruleText,
    undoCommand: ruleText.replace(" -A ", " -D "),
    targetIp: sourceIp,
    status: "pending",
  });

  res.status(201).json({ id: rule.id, ruleText, ...d });
});

// DELETE /firewall/rules/:id — deactivate a rule
router.delete("/firewall/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db.select().from(firewallRulesTable).where(eq(firewallRulesTable.id, id));
  if (existing.length === 0) { res.status(404).json({ error: "Rule not found" }); return; }

  const rule = existing[0];
  await db.delete(defenseCommandsTable).where(and(
    eq(defenseCommandsTable.commandText, rule.ruleText),
    eq(defenseCommandsTable.status, "pending"),
  ));
  await db.insert(defenseCommandsTable).values({
    targetVm: "all",
    commandType: "iptables",
    commandText: rule.ruleText.replace(" -A ", " -D "),
    undoCommand: rule.ruleText,
    targetIp: rule.sourceIp ?? null,
    status: "pending",
  });
  await db.delete(firewallRulesTable).where(eq(firewallRulesTable.id, id));

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "firewall_rule_remove",
    targetIp:    rule.sourceIp ?? "any",
    reason:      `Firewall rule removed: ${rule.ruleText}`,
    performedBy: "admin",
    status:      "success",
  });

  res.json({ success: true, id });
});

// GET /firewall/rules/active — iptables export (rules to apply on Ubuntu VM)
router.get("/firewall/rules/export", async (_req, res) => {
  const rules = await db.select().from(firewallRulesTable)
    .where(eq(firewallRulesTable.isActive, true))
    .orderBy(firewallRulesTable.appliedAt);

  const lines = [
    "#!/bin/bash",
    "# AEGIS Firewall Rules Export",
    `# Generated: ${new Date().toISOString()}`,
    "iptables -F   # Flush existing rules",
    "",
    ...rules.map(r => r.ruleText),
    "",
    "echo 'AEGIS firewall rules applied.'",
  ];

  res.setHeader("Content-Type", "text/plain");
  res.send(lines.join("\n"));
});

export default router;
