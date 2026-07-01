import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const blockedIpsTable = pgTable("blocked_ips", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  reason: text("reason").notNull(),
  blockedBy: text("blocked_by").notNull().default("manual"),
  isActive: boolean("is_active").notNull().default(true),
  blockedAt: timestamp("blocked_at").defaultNow().notNull(),
  unblockedAt: timestamp("unblocked_at"),
});

export const defenseActionsTable = pgTable("defense_actions", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  action: text("action").notNull(),
  targetIp: text("target_ip").notNull(),
  reason: text("reason").notNull(),
  performedBy: text("performed_by").notNull().default("system"),
  status: text("status").notNull().default("success"),
  relatedEventId: text("related_event_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDefenseActionSchema = createInsertSchema(defenseActionsTable).omit({ id: true, createdAt: true });
export type InsertDefenseAction = z.infer<typeof insertDefenseActionSchema>;
export type DefenseAction = typeof defenseActionsTable.$inferSelect;

export const insertBlockedIpSchema = createInsertSchema(blockedIpsTable).omit({ id: true, blockedAt: true, unblockedAt: true });
export type InsertBlockedIp = z.infer<typeof insertBlockedIpSchema>;
export type BlockedIp = typeof blockedIpsTable.$inferSelect;
