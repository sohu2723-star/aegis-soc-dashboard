import { Router } from "express";
import { db, sshSessionsTable, httpAttacksTable, dbAttacksTable, dnsAttacksTable, ldapAttacksTable, ftpSessionsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

// ─── SSH Sessions ─────────────────────────────────────────────────────────────
// Source: /var/log/auth.log on all company VMs

router.get("/connections/ssh", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sessions = await db.select().from(sshSessionsTable)
    .orderBy(desc(sshSessionsTable.createdAt)).limit(limit);
  res.json(sessions.map(s => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    endedAt:   s.endedAt?.toISOString() ?? null,
  })));
});

// ─── HTTP Attacks ─────────────────────────────────────────────────────────────
// Source: /var/log/apache2/modsec_audit.log (ModSecurity) on company-web-server

router.get("/connections/http-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(httpAttacksTable)
    .orderBy(desc(httpAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── DB Attacks ───────────────────────────────────────────────────────────────
// Source: /var/log/mysql/error.log on company-customer-db (10.20.20.10:3306)

router.get("/connections/db-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(dbAttacksTable)
    .orderBy(desc(dbAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── DNS Attacks ──────────────────────────────────────────────────────────────
// Source: /var/log/named/named.log on company-dns-server (10.10.10.20:53)

router.get("/connections/dns-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(dnsAttacksTable)
    .orderBy(desc(dnsAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── LDAP Attacks ─────────────────────────────────────────────────────────────
// Source: /var/log/syslog (slapd) on company-ldap-server (10.20.20.20:389)

router.get("/connections/ldap-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(ldapAttacksTable)
    .orderBy(desc(ldapAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── FTP Sessions ─────────────────────────────────────────────────────────────
// Source: /var/log/vsftpd.log on company-web-server (10.10.10.10:21)

router.get("/connections/ftp", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(ftpSessionsTable)
    .orderBy(desc(ftpSessionsTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

export default router;
