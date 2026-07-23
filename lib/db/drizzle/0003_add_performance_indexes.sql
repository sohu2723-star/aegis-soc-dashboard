-- AEGIS Performance Indexes — Migration 0003
-- Run this directly in Supabase SQL editor (Dashboard → SQL Editor).
-- drizzle-kit push is broken with pooler URL — run SQL manually.
--
-- These indexes eliminate full-table scans on security_events which is
-- the most-queried table (8 parallel queries on every dashboard refresh,
-- every 8 seconds). Without indexes the dashboard gets slower as events grow.

-- security_events: most critical — queried on every dashboard refresh
CREATE INDEX IF NOT EXISTS security_events_created_at_idx  ON security_events (created_at);
CREATE INDEX IF NOT EXISTS security_events_severity_idx    ON security_events (severity);
CREATE INDEX IF NOT EXISTS security_events_status_idx      ON security_events (status);
CREATE INDEX IF NOT EXISTS security_events_type_idx        ON security_events (type);
CREATE INDEX IF NOT EXISTS security_events_target_host_idx ON security_events (target_host);
CREATE INDEX IF NOT EXISTS security_events_source_ip_idx   ON security_events (source_ip);

-- alerts: dashboard counts unacknowledged alerts on every refresh
CREATE INDEX IF NOT EXISTS alerts_acknowledged_idx ON alerts (acknowledged);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx   ON alerts (created_at);

-- incidents: dashboard counts open incidents on every refresh
CREATE INDEX IF NOT EXISTS incidents_status_idx     ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents (created_at);
