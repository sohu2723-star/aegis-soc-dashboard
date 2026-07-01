import { mysqlTable, int, varchar, text, timestamp, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const blockedIpsTable = mysqlTable("blocked_ips", {
  id:          int("id").primaryKey().autoincrement(),
  ip:          varchar("ip", { length: 45 }).notNull(),
  reason:      text("reason").notNull(),
  blockedBy:   varchar("blocked_by", { length: 32 }).notNull().default("manual"),
  isActive:    boolean("is_active").notNull().default(true),
  blockedAt:   timestamp("blocked_at").defaultNow().notNull(),
  unblockedAt: timestamp("unblocked_at"),
});

export const defenseActionsTable = mysqlTable("defense_actions", {
  id:             int("id").primaryKey().autoincrement(),
  type:           varchar("type", { length: 32 }).notNull(),
  action:         varchar("action", { length: 64 }).notNull(),
  targetIp:       varchar("target_ip", { length: 45 }).notNull(),
  reason:         text("reason").notNull(),
  performedBy:    varchar("performed_by", { length: 64 }).notNull().default("system"),
  status:         varchar("status", { length: 32 }).notNull().default("success"),
  relatedEventId: varchar("related_event_id", { length: 32 }),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
});

// Firewall rules (iptables / ufw)
export const firewallRulesTable = mysqlTable("firewall_rules", {
  id:         int("id").primaryKey().autoincrement(),
  chain:      varchar("chain", { length: 16 }).notNull().default("INPUT"),   // INPUT | OUTPUT | FORWARD
  action:     varchar("action", { length: 16 }).notNull(),                   // DROP | ACCEPT | REJECT | LOG
  protocol:   varchar("protocol", { length: 8 }),                            // tcp | udp | icmp | all
  sourceIp:   varchar("source_ip", { length: 45 }),
  destIp:     varchar("dest_ip", { length: 45 }),
  sourcePort: varchar("source_port", { length: 16 }),
  destPort:   varchar("dest_port", { length: 16 }),
  iface:      varchar("iface", { length: 16 }),                              // eth0 | ens33 etc.
  ruleText:   text("rule_text").notNull(),                                   // full iptables command
  isActive:   boolean("is_active").notNull().default(true),
  appliedAt:  timestamp("applied_at").defaultNow().notNull(),
  createdBy:  varchar("created_by", { length: 64 }).notNull().default("admin"),
});

export const insertDefenseActionSchema  = createInsertSchema(defenseActionsTable).omit({ id: true, createdAt: true });
export const insertBlockedIpSchema      = createInsertSchema(blockedIpsTable).omit({ id: true, blockedAt: true, unblockedAt: true });
export const insertFirewallRuleSchema   = createInsertSchema(firewallRulesTable).omit({ id: true, appliedAt: true });

export type InsertDefenseAction = z.infer<typeof insertDefenseActionSchema>;
export type DefenseAction       = typeof defenseActionsTable.$inferSelect;
export type InsertBlockedIp     = z.infer<typeof insertBlockedIpSchema>;
export type BlockedIp           = typeof blockedIpsTable.$inferSelect;
export type InsertFirewallRule  = z.infer<typeof insertFirewallRuleSchema>;
export type FirewallRule        = typeof firewallRulesTable.$inferSelect;
