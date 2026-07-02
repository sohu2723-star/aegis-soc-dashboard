#!/usr/bin/env node
// pnpm --filter @workspace/db run clear-data
// Truncates all tables — removes ALL rows, keeps structure intact.
import { createConnection } from 'mysql2/promise';

const u = new URL(process.env.MYSQL_URL);
const conn = await createConnection({
  host: u.hostname,
  port: parseInt(u.port || '4000'),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: 'aegis',
  ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === 'false'
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true },
});

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

await conn.query('SET FOREIGN_KEY_CHECKS = 0');
for (const t of tables) {
  await conn.query(`TRUNCATE TABLE \`${t}\``);
  console.log(`✓ Cleared ${t}`);
}
await conn.query('SET FOREIGN_KEY_CHECKS = 1');
console.log('\n✅ All tables cleared. Ready for real attacks.');
await conn.end();
