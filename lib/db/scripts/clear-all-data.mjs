#!/usr/bin/env node
// pnpm --filter @workspace/db run clear-data
// Truncates all tables — removes ALL rows, keeps structure intact.
import pg from 'pg';
const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set.');
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const tables = [
  'alerts',
  'attack_counters',
  'blocked_ips',
  'defense_actions',
  'defense_commands',
  'defense_rules',
  'encrypted_traffic',
  'firewall_rules',
  'ftp_sessions',
  'http_attacks',
  'incidents',
  'network_hosts',
  'reports',
  'security_events',
  'ssh_sessions',
  'system_status',
];

for (const t of tables) {
  await client.query(`TRUNCATE TABLE "${t}" RESTART IDENTITY CASCADE`);
  console.log(`✓ Cleared ${t}`);
}
console.log('\n✅ All tables cleared. Ready for real attacks.');
await client.end();
