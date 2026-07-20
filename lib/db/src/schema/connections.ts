import { pgTable, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sshSessionsTable = pgTable("ssh_sessions", {
  id:         integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:   varchar("source_ip", { length: 45 }).notNull(),
  username:   varchar("username", { length: 64 }),
  status:     varchar("status", { length: 16 }).notNull(),
  authMethod: varchar("auth_method", { length: 16 }),
  sessionId:  varchar("session_id", { length: 64 }),
  failures:   integer("failures").notNull().default(0),
  bannedBy:   varchar("banned_by", { length: 32 }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  endedAt:    timestamp("ended_at"),
});


export const httpAttacksTable = pgTable("http_attacks", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetUrl:   varchar("target_url", { length: 1024 }).notNull(),
  method:      varchar("method", { length: 8 }).notNull(),
  statusCode:  integer("status_code"),
  attackType:  varchar("attack_type", { length: 64 }),
  payload:     text("payload"),
  userAgent:   varchar("user_agent", { length: 512 }),
  ruleId:      varchar("rule_id", { length: 16 }),
  blocked:     boolean("blocked").notNull().default(false),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertSshSessionSchema  = createInsertSchema(sshSessionsTable).omit({ createdAt: true });
export const insertHttpAttackSchema  = createInsertSchema(httpAttacksTable).omit({ createdAt: true });

export type SshSession  = typeof sshSessionsTable.$inferSelect;
export type HttpAttack  = typeof httpAttacksTable.$inferSelect;

export type InsertSshSession  = z.infer<typeof insertSshSessionSchema>;
export type InsertHttpAttack  = z.infer<typeof insertHttpAttackSchema>;
