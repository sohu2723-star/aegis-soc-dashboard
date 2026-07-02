import { mysqlTable, int, varchar, text, timestamp } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const incidentsTable = mysqlTable("incidents", {
  id:          int("id").primaryKey().autoincrement(),
  title:       varchar("title", { length: 255 }).notNull(),
  severity:    varchar("severity", { length: 16 }).notNull(),
  status:      varchar("status", { length: 32 }).notNull().default("open"),
  description: text("description").notNull(),
  responder:   varchar("responder", { length: 128 }),
  notes:       text("notes"),
  eventCount:  int("event_count").notNull().default(0),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});

export const insertIncidentSchema = createInsertSchema(incidentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidentsTable.$inferSelect;
