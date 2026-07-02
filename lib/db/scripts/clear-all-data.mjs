#!/usr/bin/env node
// pnpm --filter @workspace/db run clear-data
// Truncates all tables — removes ALL rows, keeps structure intact.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(url, { max: 1 });

const tables = [
  "alerts",
  "attack_counters",
  "blocked_ips",
  "defense_actions",
  "defense_commands",
  "defense_rules",
  "encrypted_traffic",
  "firewall_rules",
  "ftp_sessions",
  "http_attacks",
  "incidents",
  "network_hosts",
  "reports",
  "security_events",
  "ssh_sessions",
  "system_status",
];

for (const t of tables) {
  await sql`TRUNCATE TABLE ${sql(t)} RESTART IDENTITY CASCADE`;
  console.log(`✓ Cleared ${t}`);
}
console.log("\n✅ All tables cleared. Ready for real attacks.");
await sql.end();
