import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemStatusTable = pgTable("system_status", {
  id: serial("id").primaryKey(),
  component: text("component").notNull(),
  layer: text("layer").notNull(),
  status: text("status").notNull().default("unknown"),
  description: text("description").notNull(),
  metrics: text("metrics"),
  lastCheck: timestamp("last_check").defaultNow().notNull(),
});

export const insertSystemStatusSchema = createInsertSchema(systemStatusTable).omit({ id: true, lastCheck: true });
export type InsertSystemStatus = z.infer<typeof insertSystemStatusSchema>;
export type SystemStatus = typeof systemStatusTable.$inferSelect;
