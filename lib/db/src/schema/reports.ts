import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = mysqlTable("reports", {
  id:             int("id").primaryKey().autoincrement(),
  title:          varchar("title", { length: 255 }).notNull(),
  type:           varchar("type", { length: 32 }).notNull(),
  format:         varchar("format", { length: 16 }).notNull().default("html"),
  summary:        text("summary").notNull(),
  eventsCount:    int("events_count").notNull().default(0),
  incidentsCount: int("incidents_count").notNull().default(0),
  generatedAt:    timestamp("generated_at").defaultNow().notNull(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, generatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
