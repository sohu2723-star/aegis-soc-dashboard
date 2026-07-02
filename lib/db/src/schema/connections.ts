import { pgTable, serial, varchar, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sshSessionsTable = pgTable("ssh_sessions", {
  id:         serial("id").primaryKey(),
  sourceIp:   varchar("source_ip", { length: 45 }).notNull(),
  username:   varchar("username", { length: 64 }),
  status:     varchar("status", { length: 16 }).notNull(),
  authMethod: varchar("auth_method", { length: 16 }),
  sessionId:  varchar("session_id", { length: 64 }),
  failures:   integer("failures").notNull().default(0),
  bannedBy:   varchar("banned_by", { length: 32 }),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  endedAt:    timestamp("ended_at"),
});

export const ftpSessionsTable = pgTable("ftp_sessions", {
  id:        serial("id").primaryKey(),
  sourceIp:  varchar("source_ip", { length: 45 }).notNull(),
  username:  varchar("username", { length: 64 }),
  command:   varchar("command", { length: 16 }),
  filePath:  varchar("file_path", { length: 512 }),
  fileSize:  integer("file_size"),
  status:    varchar("status", { length: 16 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const encryptedTrafficTable = pgTable("encrypted_traffic", {
  id:           serial("id").primaryKey(),
  sourceIp:     varchar("source_ip", { length: 45 }).notNull(),
  destIp:       varchar("dest_ip", { length: 45 }).notNull(),
  destPort:     integer("dest_port"),
  tlsVersion:   varchar("tls_version", { length: 16 }),
  cipherSuite:  varchar("cipher_suite", { length: 128 }),
  sni:          varchar("sni", { length: 255 }),
  certIssuer:   varchar("cert_issuer", { length: 255 }),
  certSubject:  varchar("cert_subject", { length: 255 }),
  certExpiry:   varchar("cert_expiry", { length: 32 }),
  isSuspicious: boolean("is_suspicious").notNull().default(false),
  reason:       varchar("reason", { length: 128 }),
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

export const httpAttacksTable = pgTable("http_attacks", {
  id:          serial("id").primaryKey(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetUrl:   varchar("target_url", { length: 1024 }).notNull(),
  method:      varchar("method", { length: 8 }).notNull(),
  statusCode:  integer("status_code"),
  attackType:  varchar("attack_type", { length: 64 }),
  payload:     text("payload"),
  userAgent:   varchar("user_agent", { length: 512 }),
  ruleId:      varchar("rule_id", { length: 16 }),
  blocked:     boolean("blocked").notNull().default(false),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

export const insertSshSessionSchema       = createInsertSchema(sshSessionsTable).omit({ id: true, createdAt: true });
export const insertFtpSessionSchema       = createInsertSchema(ftpSessionsTable).omit({ id: true, createdAt: true });
export const insertEncryptedTrafficSchema = createInsertSchema(encryptedTrafficTable).omit({ id: true, createdAt: true });
export const insertHttpAttackSchema       = createInsertSchema(httpAttacksTable).omit({ id: true, createdAt: true });

export type SshSession        = typeof sshSessionsTable.$inferSelect;
export type FtpSession        = typeof ftpSessionsTable.$inferSelect;
export type EncryptedTraffic  = typeof encryptedTrafficTable.$inferSelect;
export type HttpAttack        = typeof httpAttacksTable.$inferSelect;

export type InsertSshSession       = z.infer<typeof insertSshSessionSchema>;
export type InsertFtpSession       = z.infer<typeof insertFtpSessionSchema>;
export type InsertEncryptedTraffic = z.infer<typeof insertEncryptedTrafficSchema>;
export type InsertHttpAttack       = z.infer<typeof insertHttpAttackSchema>;
