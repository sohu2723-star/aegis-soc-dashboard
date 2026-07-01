import { pgTable, serial, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const networkHostsTable = pgTable("network_hosts", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  hostname: text("hostname").notNull(),
  role: text("role").notNull().default("unknown"),
  os: text("os"),
  mac: text("mac"),
  openPorts: text("open_ports"),
  status: text("status").notNull().default("online"),
  isMonitored: boolean("is_monitored").notNull().default(false),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNetworkHostSchema = createInsertSchema(networkHostsTable).omit({ id: true, createdAt: true, lastSeen: true });
export type InsertNetworkHost = z.infer<typeof insertNetworkHostSchema>;
export type NetworkHost = typeof networkHostsTable.$inferSelect;
