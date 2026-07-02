import { pgTable, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const systemStatusTable = pgTable("system_status", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  component:   varchar("component", { length: 64 }).notNull(),
  layer:       varchar("layer", { length: 32 }).notNull(),
  status:      varchar("status", { length: 16 }).notNull().default("unknown"),
  description: text("description").notNull(),
  metrics:     text("metrics"),
  lastCheck:   timestamp("last_check").defaultNow().notNull(),
});

export const insertSystemStatusSchema = createInsertSchema(systemStatusTable).omit({ id: true, lastCheck: true });
export type InsertSystemStatus = z.infer<typeof insertSystemStatusSchema>;
export type SystemStatus = typeof systemStatusTable.$inferSelect;
