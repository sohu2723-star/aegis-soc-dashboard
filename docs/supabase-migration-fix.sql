-- ============================================================
--  AEGIS SOC Dashboard — Supabase Full Migration Fix
--  Run this in: Supabase Dashboard → SQL Editor → paste → Run
--  Safe to run multiple times (idempotent).
-- ============================================================

-- ── Migration 0001: app_settings + column additions ─────────

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key"        varchar(64) PRIMARY KEY NOT NULL,
  "value"      text        NOT NULL,
  "updated_at" timestamp   DEFAULT now() NOT NULL
);

ALTER TABLE "system_status"   ADD COLUMN IF NOT EXISTS "host_ip"     varchar(45);
ALTER TABLE "blocked_ips"     ADD COLUMN IF NOT EXISTS "target_host" varchar(255);
ALTER TABLE "defense_actions" ADD COLUMN IF NOT EXISTS "target_host" varchar(255);

-- ── Migration 0002: suricata rule columns ───────────────────

-- (encrypted_traffic was dropped in 0002; skip if already gone)
ALTER TABLE "defense_commands" ALTER COLUMN "target_vm" SET DEFAULT 'all';
ALTER TABLE "defense_rules"    ALTER COLUMN "target_vm" SET DEFAULT 'bank-web';

ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "signature_id"    integer;
ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "alert_rev"       integer;
ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "alert_action"    varchar(32);
ALTER TABLE "security_events" ADD COLUMN IF NOT EXISTS "alert_category"  varchar(128);

-- ── Migration 0003: performance indexes ─────────────────────

CREATE INDEX IF NOT EXISTS security_events_created_at_idx  ON security_events (created_at);
CREATE INDEX IF NOT EXISTS security_events_severity_idx    ON security_events (severity);
CREATE INDEX IF NOT EXISTS security_events_status_idx      ON security_events (status);
CREATE INDEX IF NOT EXISTS security_events_type_idx        ON security_events (type);
CREATE INDEX IF NOT EXISTS security_events_target_host_idx ON security_events (target_host);
CREATE INDEX IF NOT EXISTS security_events_source_ip_idx   ON security_events (source_ip);

CREATE INDEX IF NOT EXISTS alerts_acknowledged_idx ON alerts (acknowledged);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx   ON alerts (created_at);

CREATE INDEX IF NOT EXISTS incidents_status_idx     ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents (created_at);

-- ── Migration 0004: extended attack tables ──────────────────

ALTER TABLE ssh_sessions  ADD COLUMN IF NOT EXISTS log_source   VARCHAR(128);
ALTER TABLE ssh_sessions  ADD COLUMN IF NOT EXISTS matched_rule VARCHAR(256);
ALTER TABLE http_attacks  ADD COLUMN IF NOT EXISTS log_source   VARCHAR(128);

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

-- ftp_sessions may already exist from 0000 — extend only
ALTER TABLE ftp_sessions ADD COLUMN IF NOT EXISTS log_source   VARCHAR(128);
ALTER TABLE ftp_sessions ADD COLUMN IF NOT EXISTS matched_rule VARCHAR(256);

-- ── Done ─────────────────────────────────────────────────────
SELECT 'Migration complete ✓' AS result;
