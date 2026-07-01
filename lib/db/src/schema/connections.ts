import { mysqlTable, int, varchar, text, timestamp, boolean } from "drizzle-orm/mysql-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── SSH Sessions ─────────────────────────────────────────────────────────────
// Populated by Fail2ban / auth.log forwarder
export const sshSessionsTable = mysqlTable("ssh_sessions", {
  id:         int("id").primaryKey().autoincrement(),
  sourceIp:   varchar("source_ip", { length: 45 }).notNull(),
  username:   varchar("username", { length: 64 }),
  status:     varchar("status", { length: 16 }).notNull(),   // success | failed | active | closed
  authMethod: varchar("auth_method", { length: 16 }),        // password | publickey
  sessionId:  varchar("session_id", { length: 64 }),
  failures:   int("failures").notNull().default(0),
  bannedBy:   varchar("banned_by", { length: 32 }),          // fail2ban | manual | none
  createdAt:  timestamp("created_at").defaultNow().notNull(),
  endedAt:    timestamp("ended_at"),
});

// ─── FTP Sessions ─────────────────────────────────────────────────────────────
// Populated by vsftpd / proftpd log forwarder
export const ftpSessionsTable = mysqlTable("ftp_sessions", {
  id:        int("id").primaryKey().autoincrement(),
  sourceIp:  varchar("source_ip", { length: 45 }).notNull(),
  username:  varchar("username", { length: 64 }),
  command:   varchar("command", { length: 16 }),             // STOR | RETR | LIST | DELE | MKD
  filePath:  varchar("file_path", { length: 512 }),
  fileSize:  int("file_size"),                               // bytes
  status:    varchar("status", { length: 16 }).notNull(),    // success | failed | blocked
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Encrypted Traffic Events ─────────────────────────────────────────────────
// Populated by Suricata TLS logging (eve.json event_type:tls)
export const encryptedTrafficTable = mysqlTable("encrypted_traffic", {
  id:           int("id").primaryKey().autoincrement(),
  sourceIp:     varchar("source_ip", { length: 45 }).notNull(),
  destIp:       varchar("dest_ip", { length: 45 }).notNull(),
  destPort:     int("dest_port"),
  tlsVersion:   varchar("tls_version", { length: 16 }),      // TLSv1.2 | TLSv1.3 | SSLv3
  cipherSuite:  varchar("cipher_suite", { length: 128 }),
  sni:          varchar("sni", { length: 255 }),             // Server Name Indication
  certIssuer:   varchar("cert_issuer", { length: 255 }),
  certSubject:  varchar("cert_subject", { length: 255 }),
  certExpiry:   varchar("cert_expiry", { length: 32 }),
  isSuspicious: boolean("is_suspicious").notNull().default(false), // self-signed, expired, etc.
  reason:       varchar("reason", { length: 128 }),          // why flagged
  createdAt:    timestamp("created_at").defaultNow().notNull(),
});

// ─── HTTP Attack Events ───────────────────────────────────────────────────────
// Populated by ModSecurity / Nginx access log forwarder
export const httpAttacksTable = mysqlTable("http_attacks", {
  id:          int("id").primaryKey().autoincrement(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetUrl:   varchar("target_url", { length: 1024 }).notNull(),
  method:      varchar("method", { length: 8 }).notNull(),   // GET | POST | PUT | DELETE
  statusCode:  int("status_code"),
  attackType:  varchar("attack_type", { length: 64 }),       // SQLi | XSS | LFI | RFI | CSRF | DirTraversal | Brute
  payload:     text("payload"),                              // truncated request body / param
  userAgent:   varchar("user_agent", { length: 512 }),
  ruleId:      varchar("rule_id", { length: 16 }),           // ModSecurity rule ID
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
