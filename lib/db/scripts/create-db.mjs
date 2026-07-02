#!/usr/bin/env node
// pnpm --filter @workspace/db run create-db
// Verifies the PostgreSQL database is reachable (Replit provisions it automatically).
import pg from 'pg';
const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set. It is auto-provisioned by Replit.');
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query('SELECT current_database() AS db');
console.log('✓ Database', res.rows[0].db, 'is ready');
await client.end();
