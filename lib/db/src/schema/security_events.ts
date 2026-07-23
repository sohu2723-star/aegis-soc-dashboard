import { pgTable, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
// signatureId / alertRev / alertAction / alertCategory: populated from Suricata EVE JSON alert object
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const securityEventsTable = pgTable("security_events", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type:        varchar("type", { length: 64 }).notNull(),
  subtype:     varchar("subtype", { length: 128 }).notNull(),
  severity:    varchar("severity", { length: 16 }).notNull(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetHost:  varchar("target_host", { length: 255 }).notNull(),
  toolUsed:    varchar("tool_used", { length: 64 }),
  description: text("description").notNull(),
  status:      varchar("status", { length: 32 }).notNull().default("detected"),
  layer:         varchar("layer", { length: 32 }).notNull(),
  signatureId:   integer("signature_id"),
  alertRev:      integer("alert_rev"),
  alertAction:   varchar("alert_action", { length: 32 }),
  alertCategory: varchar("alert_category", { length: 128 }),
  signatureText: text("signature_text"),   // full matched rule text (Suricata rule string / Fail2ban filter info)
  createdAt:     timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // Most queries ORDER BY created_at DESC — this index is used for every
  // recent-events fetch and the 12-hour trend window (range + sort).
  index("security_events_created_at_idx").on(t.createdAt),

  // Dashboard summary counts filter/group by these columns individually.
  index("security_events_severity_idx").on(t.severity),
  index("security_events_status_idx").on(t.status),
  index("security_events_type_idx").on(t.type),

  // Device-scoped dashboard queries (targetHost filter on every widget).
  index("security_events_target_host_idx").on(t.targetHost),

  // Source IP filtering (auto-defense lookups, event search).
  index("security_events_source_ip_idx").on(t.sourceIp),
]);

export const insertSecurityEventSchema = createInsertSchema(securityEventsTable).omit({ createdAt: true });
export type InsertSecurityEvent = z.infer<typeof insertSecurityEventSchema>;
export type SecurityEvent = typeof securityEventsTable.$inferSelect;
