import { pgTable, integer, varchar, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("alerts", {
  id:           integer("id").primaryKey().generatedAlwaysAsIdentity(),
  message:      text("message").notNull(),
  severity:     varchar("severity", { length: 16 }).notNull(),
  channel:      varchar("channel", { length: 32 }).notNull().default("dashboard"),
  acknowledged: boolean("acknowledged").notNull().default(false),
  eventId:      integer("event_id"),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Dashboard counts unacknowledged alerts on every summary refresh.
  index("alerts_acknowledged_idx").on(t.acknowledged),
  index("alerts_created_at_idx").on(t.createdAt),
]);

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;
