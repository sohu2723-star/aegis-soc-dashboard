import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const defenseRulesTable = pgTable("defense_rules", {
  id:               serial("id").primaryKey(),
  name:             varchar("name", { length: 128 }).notNull(),
  description:      text("description"),

  triggerAttackType: varchar("trigger_attack_type", { length: 64 }).notNull().default("any"),
  triggerSeverity:  varchar("trigger_severity", { length: 16 }).notNull().default("any"),
  triggerThreshold: integer("trigger_threshold").notNull().default(1),
  triggerWindowSecs: integer("trigger_window_secs").notNull().default(60),

  actionType:    varchar("action_type", { length: 16 }).notNull().default("auto"),
  defenseType:   varchar("defense_type", { length: 32 }).notNull(),
  actionParams:  text("action_params"),

  targetVm:    varchar("target_vm", { length: 32 }).notNull().default("ubuntu"),
  priority:    integer("priority").notNull().default(100),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const defenseCommandsTable = pgTable("defense_commands", {
  id:          serial("id").primaryKey(),
  ruleId:      integer("rule_id"),
  eventId:     integer("event_id"),
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

export const attackCountersTable = pgTable("attack_counters", {
  id:          serial("id").primaryKey(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  attackType:  varchar("attack_type", { length: 64 }).notNull(),
  count:       integer("count").notNull().default(1),
  windowStart: timestamp("window_start").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const insertDefenseRuleSchema   = createInsertSchema(defenseRulesTable).omit({ id: true, createdAt: true });
export const insertDefenseCommandSchema = createInsertSchema(defenseCommandsTable).omit({ id: true, createdAt: true });

export type DefenseRule    = typeof defenseRulesTable.$inferSelect;
export type DefenseCommand = typeof defenseCommandsTable.$inferSelect;
export type InsertDefenseRule    = z.infer<typeof insertDefenseRuleSchema>;
export type InsertDefenseCommand = z.infer<typeof insertDefenseCommandSchema>;
