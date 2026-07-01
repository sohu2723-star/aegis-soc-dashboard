import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityEventsTable = pgTable("security_events", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  subtype: text("subtype").notNull(),
  severity: text("severity").notNull(),
  sourceIp: text("source_ip").notNull(),
  targetHost: text("target_host").notNull(),
  toolUsed: text("tool_used"),
  description: text("description").notNull(),
  status: text("status").notNull().default("detected"),
  layer: text("layer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ id: true, createdAt: true });
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;
