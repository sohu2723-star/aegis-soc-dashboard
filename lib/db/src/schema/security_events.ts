import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityEventsTable = mysqlTable("security_events", {
  id:          int("id").primaryKey().autoincrement(),
  type:        varchar("type", { length: 64 }).notNull(),
  subtype:     varchar("subtype", { length: 128 }).notNull(),
  severity:    varchar("severity", { length: 16 }).notNull(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetHost:  varchar("target_host", { length: 255 }).notNull(),
  toolUsed:    varchar("tool_used", { length: 64 }),
  description: text("description").notNull(),
  status:      varchar("status", { length: 32 }).notNull().default("detected"),
  layer:       varchar("layer", { length: 32 }).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ id: true, createdAt: true });
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;
