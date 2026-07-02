import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("alerts", {
  id:           serial("id").primaryKey(),
  message:      text("message").notNull(),
  severity:     varchar("severity", { length: 16 }).notNull(),
  channel:      varchar("channel", { length: 32 }).notNull().default("dashboard"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  eventId:      integer("event_id"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
