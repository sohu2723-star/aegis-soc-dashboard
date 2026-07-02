import { mysqlTable, int, varchar, text, timestamp, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const defenseRulesTable = mysqlTable("defense_rules", {
  id:               int("id").primaryKey().autoincrement(),
  name:             varchar("name", { length: 128 }).notNull(),
  description:      text("description"),

  triggerAttackType: varchar("trigger_attack_type", { length: 64 }).notNull().default("any"),
  triggerSeverity:  varchar("trigger_severity", { length: 16 }).notNull().default("any"),
  triggerThreshold: int("trigger_threshold").notNull().default(1),
  triggerWindowSecs: int("trigger_window_secs").notNull().default(60),

  actionType:    varchar("action_type", { length: 16 }).notNull().default("auto"),
  defenseType:   varchar("defense_type", { length: 32 }).notNull(),
  actionParams:  text("action_params"),

  targetVm:    varchar("target_vm", { length: 32 }).notNull().default("ubuntu"),
  priority:    int("priority").notNull().default(100),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const defenseCommandsTable = mysqlTable("defense_commands", {
  id:          int("id").primaryKey().autoincrement(),
  ruleId:      int("rule_id"),
  eventId:     int("event_id"),
  targetVm:    varchar("target_vm", { length: 32 }).notNull().default("ubuntu"),
  commandType: varchar("command_type", { length: 32 }).notNull(),
  commandText: text("command_text").notNull(),
  undoCommand: text("undo_command"),
  targetIp:    varchar("target_ip", { length: 45 }),
  status:      varchar("status", { length: 16 }).notNull().default("pending"),
  errorMsg:    text("error_msg"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  executedAt:  timestamp("executed_at"),
});

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
