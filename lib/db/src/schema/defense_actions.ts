import { pgTable, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const blockedIpsTable = pgTable("blocked_ips", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ip:          varchar("ip", { length: 45 }).notNull(),
  reason:      text("reason").notNull(),
  blockedBy:   varchar("blocked_by", { length: 32 }).notNull().default("manual"),
  isActive:    boolean("is_active").notNull().default(true),
  blockedAt:   timestamp("blocked_at").defaultNow().notNull(),
  unblockedAt: timestamp("unblocked_at"),
});

export const defenseActionsTable = pgTable("defense_actions", {
  id:             integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type:           varchar("type", { length: 32 }).notNull(),
  action:         varchar("action", { length: 64 }).notNull(),
  targetIp:       varchar("target_ip", { length: 45 }).notNull(),
  reason:         text("reason").notNull(),
  performedBy:    varchar("performed_by", { length: 64 }).notNull().default("system"),
  status:         varchar("status", { length: 32 }).notNull().default("success"),
  relatedEventId: varchar("related_event_id", { length: 32 }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

export const firewallRulesTable = pgTable("firewall_rules", {
  id:         integer("id").primaryKey().generatedAlwaysAsIdentity(),
  chain:      varchar("chain", { length: 16 }).notNull().default("INPUT"),
  action:     varchar("action", { length: 16 }).notNull(),
  protocol:   varchar("protocol", { length: 8 }),
  sourceIp:   varchar("source_ip", { length: 45 }),
  destIp:     varchar("dest_ip", { length: 45 }),
  sourcePort: varchar("source_port", { length: 16 }),
  destPort:   varchar("dest_port", { length: 16 }),
  iface:      varchar("iface", { length: 16 }),
  ruleText:   text("rule_text").notNull(),
  isActive:   boolean("is_active").notNull().default(true),
  appliedAt:  timestamp("applied_at").defaultNow().notNull(),
  createdBy:  varchar("created_by", { length: 64 }).notNull().default("admin"),
});

export const insertDefenseActionSchema  = createInsertSchema(defenseActionsTable).omit({ createdAt: true });
export const insertBlockedIpSchema      = createInsertSchema(blockedIpsTable).omit({ blockedAt: true, unblockedAt: true });
export const insertFirewallRuleSchema   = createInsertSchema(firewallRulesTable).omit({ appliedAt: true });

export type InsertDefenseAction = z.infer<typeof insertDefenseActionSchema>;
export type DefenseAction       = typeof defenseActionsTable.$inferSelect;
export type InsertBlockedIp     = z.infer<typeof insertBlockedIpSchema>;
export type BlockedIp           = typeof blockedIpsTable.$inferSelect;
export type InsertFirewallRule  = z.infer<typeof insertFirewallRuleSchema>;
export type FirewallRule        = typeof firewallRulesTable.$inferSelect;
