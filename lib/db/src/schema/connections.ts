import { pgTable, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// ─── SSH Sessions ──────────────────────────────────────────────────────────────
// Source: /var/log/auth.log on all company VMs
// Populated by: _watch_remote_ssh() + /ingest/ssh
export const sshSessionsTable = pgTable("ssh_sessions", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  username:    varchar("username", { length: 64 }),
  status:      varchar("status", { length: 16 }).notNull(),          // failed | success | active
  authMethod:  varchar("auth_method", { length: 16 }),
  sessionId:   varchar("session_id", { length: 64 }),
  failures:    integer("failures").notNull().default(0),
  bannedBy:    varchar("banned_by", { length: 32 }),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/auth.log
  matchedRule: varchar("matched_rule", { length: 256 }),             // e.g. "fail2ban[sshd]: ban after 5 failures"
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  endedAt:     timestamp("ended_at"),
});

// ─── HTTP Attacks ──────────────────────────────────────────────────────────────
// Source: /var/log/apache2/modsec_audit.log (ModSecurity) or access.log
// Populated by: _watch_remote_modsecurity() + /ingest/http
export const httpAttacksTable = pgTable("http_attacks", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetUrl:   varchar("target_url", { length: 1024 }).notNull(),
  method:      varchar("method", { length: 8 }).notNull(),
  statusCode:  integer("status_code"),
  attackType:  varchar("attack_type", { length: 64 }),               // SQLi | XSS | LFI | RFI | CSRF | Brute
  payload:     text("payload"),
  userAgent:   varchar("user_agent", { length: 512 }),
  ruleId:      varchar("rule_id", { length: 16 }),                   // ModSecurity rule ID
  blocked:     boolean("blocked").notNull().default(false),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/apache2/modsec_audit.log
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── DB Attacks ────────────────────────────────────────────────────────────────
// Source: /var/log/mysql/error.log on company-customer-db (10.20.20.10, port 3306)
// Populated by: _watch_remote_mysql() → /ingest/mysql
export const dbAttacksTable = pgTable("db_attacks", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetIp:    varchar("target_ip", { length: 45 }).notNull().default("10.20.20.10"),
  port:        integer("port").notNull().default(3306),
  attackType:  varchar("attack_type", { length: 64 }),               // Auth Brute | SQLi | Enum | Data Dump | Privilege Esc
  username:    varchar("username", { length: 64 }),
  query:       text("query"),                                         // partial query or error text
  severity:    varchar("severity", { length: 16 }).notNull().default("high"),
  blocked:     boolean("blocked").notNull().default(false),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/mysql/error.log
  matchedRule: varchar("matched_rule", { length: 256 }),             // e.g. "MySQL: Access denied for user 'root'@'..."
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── DNS Attacks ───────────────────────────────────────────────────────────────
// Source: /var/log/named/named.log on company-dns-server (10.10.10.20, port 53)
// Populated by: _watch_remote_bind9() → /ingest/dns (extended)
export const dnsAttacksTable = pgTable("dns_attacks", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetIp:    varchar("target_ip", { length: 45 }).notNull().default("10.10.10.20"),
  attackType:  varchar("attack_type", { length: 64 }),               // dns_zone_transfer | dns_query_refused | dns_amplification | dns_tunneling
  query:       varchar("query", { length: 255 }),                    // DNS query name
  severity:    varchar("severity", { length: 16 }).notNull().default("high"),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/named/named.log
  matchedRule: varchar("matched_rule", { length: 256 }),             // e.g. "BIND9: AXFR zone transfer refused"
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── LDAP Attacks ──────────────────────────────────────────────────────────────
// Source: /var/log/syslog (slapd) on company-ldap-server (10.20.20.20, port 389)
// Populated by: _watch_remote_slapd() → /ingest/ldap
export const ldapAttacksTable = pgTable("ldap_attacks", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  targetIp:    varchar("target_ip", { length: 45 }).notNull().default("10.20.20.20"),
  dn:          varchar("dn", { length: 255 }),                       // bind DN attempted
  errorCode:   integer("error_code"),                                // 49 = Invalid credentials, 32 = No such object
  attackType:  varchar("attack_type", { length: 64 }),               // Auth Brute | Enum | Injection
  severity:    varchar("severity", { length: 16 }).notNull().default("high"),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/syslog (slapd)
  matchedRule: varchar("matched_rule", { length: 256 }),             // e.g. "slapd: err=49 Invalid credentials"
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── FTP Sessions ──────────────────────────────────────────────────────────────
// Source: /var/log/vsftpd.log on company-web-server (10.10.10.10, port 21)
// Populated by: _watch_remote_ftp() → /ingest/ftp
export const ftpSessionsTable = pgTable("ftp_sessions", {
  id:          integer("id").primaryKey().generatedAlwaysAsIdentity(),
  sourceIp:    varchar("source_ip", { length: 45 }).notNull(),
  username:    varchar("username", { length: 64 }),
  status:      varchar("status", { length: 16 }).notNull(),          // failed | success | upload | download
  command:     varchar("command", { length: 32 }),                   // LOGIN | UPLOAD | DOWNLOAD | DELETE
  filename:    varchar("filename", { length: 512 }),                 // file path accessed
  filesize:    integer("filesize"),                                   // bytes, for DOWNLOAD/UPLOAD
  failures:    integer("failures").notNull().default(0),
  bannedBy:    varchar("banned_by", { length: 32 }),
  logSource:   varchar("log_source", { length: 128 }),               // e.g. /var/log/vsftpd.log
  matchedRule: varchar("matched_rule", { length: 256 }),             // e.g. "vsftpd: FAIL LOGIN" or "fail2ban[vsftpd]"
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ─── Schemas & Types ───────────────────────────────────────────────────────────
export const insertSshSessionSchema  = createInsertSchema(sshSessionsTable).omit({ createdAt: true });
export const insertHttpAttackSchema  = createInsertSchema(httpAttacksTable).omit({ createdAt: true });
export const insertDbAttackSchema    = createInsertSchema(dbAttacksTable).omit({ createdAt: true });
export const insertDnsAttackSchema   = createInsertSchema(dnsAttacksTable).omit({ createdAt: true });
export const insertLdapAttackSchema  = createInsertSchema(ldapAttacksTable).omit({ createdAt: true });
export const insertFtpSessionSchema  = createInsertSchema(ftpSessionsTable).omit({ createdAt: true });

export type SshSession   = typeof sshSessionsTable.$inferSelect;
export type HttpAttack   = typeof httpAttacksTable.$inferSelect;
export type DbAttack     = typeof dbAttacksTable.$inferSelect;
export type DnsAttack    = typeof dnsAttacksTable.$inferSelect;
export type LdapAttack   = typeof ldapAttacksTable.$inferSelect;
export type FtpSession   = typeof ftpSessionsTable.$inferSelect;

export type InsertSshSession  = z.infer<typeof insertSshSessionSchema>;
export type InsertHttpAttack  = z.infer<typeof insertHttpAttackSchema>;
export type InsertDbAttack    = z.infer<typeof insertDbAttackSchema>;
export type InsertDnsAttack   = z.infer<typeof insertDnsAttackSchema>;
export type InsertLdapAttack  = z.infer<typeof insertLdapAttackSchema>;
export type InsertFtpSession  = z.infer<typeof insertFtpSessionSchema>;
