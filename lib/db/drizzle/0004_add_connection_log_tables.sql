-- Migration: 0004_add_connection_log_tables
-- Adds log_source + matched_rule to existing tables,
-- and creates new per-protocol attack tables for:
--   DB (MySQL), DNS (BIND9), LDAP (slapd), FTP (vsftpd)
--
-- Run in Supabase SQL Editor: Dashboard → SQL Editor → paste → Run

-- ── Extend ssh_sessions ────────────────────────────────────────────────────────
ALTER TABLE ssh_sessions
  ADD COLUMN IF NOT EXISTS log_source   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS matched_rule VARCHAR(256);

-- ── Extend http_attacks ────────────────────────────────────────────────────────
ALTER TABLE http_attacks
  ADD COLUMN IF NOT EXISTS log_source VARCHAR(128);

-- ── DB Attacks (MySQL on company-customer-db 10.20.20.10:3306) ────────────────
CREATE TABLE IF NOT EXISTS db_attacks (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_ip    VARCHAR(45)  NOT NULL,
  target_ip    VARCHAR(45)  NOT NULL DEFAULT '10.20.20.10',
  port         INTEGER      NOT NULL DEFAULT 3306,
  attack_type  VARCHAR(64),
  username     VARCHAR(64),
  query        TEXT,
  severity     VARCHAR(16)  NOT NULL DEFAULT 'high',
  blocked      BOOLEAN      NOT NULL DEFAULT FALSE,
  log_source   VARCHAR(128),
  matched_rule VARCHAR(256),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_attacks_created_at ON db_attacks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_attacks_source_ip  ON db_attacks (source_ip);

-- ── DNS Attacks (BIND9 on company-dns-server 10.10.10.20:53) ──────────────────
CREATE TABLE IF NOT EXISTS dns_attacks (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_ip    VARCHAR(45)  NOT NULL,
  target_ip    VARCHAR(45)  NOT NULL DEFAULT '10.10.10.20',
  attack_type  VARCHAR(64),
  query        VARCHAR(255),
  severity     VARCHAR(16)  NOT NULL DEFAULT 'high',
  log_source   VARCHAR(128),
  matched_rule VARCHAR(256),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dns_attacks_created_at ON dns_attacks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dns_attacks_source_ip  ON dns_attacks (source_ip);

-- ── LDAP Attacks (slapd on company-ldap-server 10.20.20.20:389) ───────────────
CREATE TABLE IF NOT EXISTS ldap_attacks (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_ip    VARCHAR(45)  NOT NULL,
  target_ip    VARCHAR(45)  NOT NULL DEFAULT '10.20.20.20',
  dn           VARCHAR(255),
  error_code   INTEGER,
  attack_type  VARCHAR(64),
  severity     VARCHAR(16)  NOT NULL DEFAULT 'high',
  log_source   VARCHAR(128),
  matched_rule VARCHAR(256),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ldap_attacks_created_at ON ldap_attacks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ldap_attacks_source_ip  ON ldap_attacks (source_ip);

-- ── FTP Sessions (vsftpd on company-web-server 10.10.10.10:21) ────────────────
CREATE TABLE IF NOT EXISTS ftp_sessions (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  source_ip    VARCHAR(45)  NOT NULL,
  username     VARCHAR(64),
  status       VARCHAR(16)  NOT NULL,
  command      VARCHAR(32),
  filename     VARCHAR(512),
  filesize     INTEGER,
  failures     INTEGER      NOT NULL DEFAULT 0,
  banned_by    VARCHAR(32),
  log_source   VARCHAR(128),
  matched_rule VARCHAR(256),
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ftp_sessions_created_at ON ftp_sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ftp_sessions_source_ip  ON ftp_sessions (source_ip);
