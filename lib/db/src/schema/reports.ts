import { pgTable, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable("reports", {
  id:             integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title:          varchar("title", { length: 255 }).notNull(),
  type:           varchar("type", { length: 32 }).notNull(),
  format:         varchar("format", { length: 16 }).notNull().default("html"),
  summary:        text("summary").notNull(),
  eventsCount:    integer("events_count").notNull().default(0),
  incidentsCount: integer("incidents_count").notNull().default(0),
  generatedAt:    timestamp("generated_at").defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, generatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
