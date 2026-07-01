import { mysqlTable, int, varchar, text, timestamp, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── Defense Rules ─────────────────────────────────────────────────────────────
// Configurable rules: "if attack type X from IP Y with count ≥ Z → do action A"
export const defenseRulesTable = mysqlTable("defense_rules", {
  id:               int("id").primaryKey().autoincrement(),
  name:             varchar("name", { length: 128 }).notNull(),
  description:      text("description"),

  // Trigger conditions
  triggerAttackType: varchar("trigger_attack_type", { length: 64 }).notNull().default("any"),
  //   any | ssh_brute | port_scan | ddos | web_attack | phishing
  //   mail_attack | ftp_brute | honeypot | tls_suspicious | dns_attack
  triggerSeverity:  varchar("trigger_severity", { length: 16 }).notNull().default("any"),
  //   any | critical | high | medium | low
  triggerThreshold: int("trigger_threshold").notNull().default(1),
  //   number of events before rule fires (1 = fire immediately)
  triggerWindowSecs: int("trigger_window_secs").notNull().default(60),
  //   time window for counting threshold events

  // Action
  actionType:    varchar("action_type", { length: 16 }).notNull().default("auto"),
  //   auto | suggest   (suggest = create incident, wait for admin)
  defenseType:   varchar("defense_type", { length: 32 }).notNull(),
  //   block_ip | rate_limit | null_route | port_block | dns_block
  //   waf_rule | pfsense_block | pfsense_port_block | alert_only
  actionParams:  text("action_params"),
  //   JSON: { durationSecs, port, protocol, rateLimit, ... }

  targetVm:    varchar("target_vm", { length: 32 }).notNull().default("ubuntu"),
  //   ubuntu | pfsense | all
  priority:    int("priority").notNull().default(100),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── Defense Commands (polling queue) ─────────────────────────────────────────
// Ubuntu / pfSense agent polls GET /api/defense/commands/pending
// After executing, it POSTs back to mark as done
export const defenseCommandsTable = mysqlTable("defense_commands", {
  id:          int("id").primaryKey().autoincrement(),
  ruleId:      int("rule_id"),            // which rule triggered this
  eventId:     int("event_id"),           // source event
  targetVm:    varchar("target_vm", { length: 32 }).notNull().default("ubuntu"),
  commandType: varchar("command_type", { length: 32 }).notNull(),
  //   iptables | ufw | pfsense_api | custom | null_route | dns_block
  commandText: text("command_text").notNull(),
  //   exact shell command or pfSense API payload
  undoCommand: text("undo_command"),
  //   command to reverse the rule (unblock, etc.)
  targetIp:    varchar("target_ip", { length: 45 }),
  status:      varchar("status", { length: 16 }).notNull().default("pending"),
  //   pending | sent | executed | failed | skipped
  errorMsg:    text("error_msg"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  executedAt:  timestamp("executed_at"),
});

// ─── Attack Counters (persisted fallback for window tracking) ──────────────────
export const attackCountersTable = mysqlTable("attack_counters", {
  id:          int("id").primaryKey().autoincrement(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  attackType:  varchar("attack_type", { length: 64 }).notNull(),
  count:       int("count").notNull().default(1),
  windowStart: timestamp("window_start").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const insertDefenseRuleSchema   = createInsertSchema(defenseRulesTable).omit({ id: true, createdAt: true });
export const insertDefenseCommandSchema = createInsertSchema(defenseCommandsTable).omit({ id: true, createdAt: true });

export type DefenseRule    = typeof defenseRulesTable.$inferSelect;
export type DefenseCommand = typeof defenseCommandsTable.$inferSelect;
export type InsertDefenseRule    = z.infer<typeof insertDefenseRuleSchema>;
export type InsertDefenseCommand = z.infer<typeof insertDefenseCommandSchema>;
