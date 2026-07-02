import { Router } from "express";
import { db, firewallRulesTable, defenseActionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// GET /firewall/rules — list all rules
router.get("/firewall/rules", async (_req, res) => {
  const rules = await db.select().from(firewallRulesTable)
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

  // Build iptables command string
  const parts = ["iptables", "-A", d.chain];
  if (d.protocol)   parts.push("-p", d.protocol);
  if (d.sourceIp)   parts.push("-s", d.sourceIp);
  if (d.destIp)     parts.push("-d", d.destIp);
  if (d.sourcePort) parts.push("--sport", d.sourcePort);
  if (d.destPort)   parts.push("--dport", d.destPort);
  if (d.iface)      parts.push("-i", d.iface);
  parts.push("-j", d.action);
  const ruleText = parts.join(" ");

  const [rule] = await db.insert(firewallRulesTable).values({
    chain:      d.chain,
    action:     d.action,
    protocol:   d.protocol ?? null,
    sourceIp:   d.sourceIp ?? null,
    destIp:     d.destIp ?? null,
    sourcePort: d.sourcePort ?? null,
    destPort:   d.destPort ?? null,
    iface:      d.iface ?? null,
    ruleText,
    isActive:   true,
    createdBy:  d.createdBy,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "firewall_rule_add",
    targetIp:    d.sourceIp ?? "any",
    reason:      `Firewall rule added: ${ruleText}`,
    performedBy: d.createdBy,
    status:      "success",
  });

  res.status(201).json({ id: rule.id, ruleText, ...d });
});

// DELETE /firewall/rules/:id — deactivate a rule
router.delete("/firewall/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db.select().from(firewallRulesTable).where(eq(firewallRulesTable.id, id));
  if (existing.length === 0) { res.status(404).json({ error: "Rule not found" }); return; }

  await db.update(firewallRulesTable).set({ isActive: false }).where(eq(firewallRulesTable.id, id));

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "firewall_rule_remove",
    targetIp:    existing[0].sourceIp ?? "any",
    reason:      `Firewall rule removed: ${existing[0].ruleText}`,
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
