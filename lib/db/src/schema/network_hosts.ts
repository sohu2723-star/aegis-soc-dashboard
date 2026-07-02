import { pgTable, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const networkHostsTable = pgTable("network_hosts", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ip:          varchar("ip", { length: 45 }).notNull(),
  hostname:    varchar("hostname", { length: 128 }).notNull(),
  role:        varchar("role", { length: 32 }).notNull().default("unknown"),
  os:          varchar("os", { length: 64 }),
  mac:         varchar("mac", { length: 17 }),
  openPorts:   text("open_ports"),
  status:      varchar("status", { length: 16 }).notNull().default("online"),
  isMonitored: boolean("is_monitored").notNull().default(false),
  lastSeen:    timestamp("last_seen").defaultNow().notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertNetworkHostSchema = createInsertSchema(networkHostsTable).omit({ id: true, createdAt: true, lastSeen: true });
export type InsertNetworkHost = z.infer<typeof insertNetworkHostSchema>;
export type NetworkHost = typeof networkHostsTable.$inferSelect;
