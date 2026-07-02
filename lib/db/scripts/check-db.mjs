#!/usr/bin/env node
// pnpm --filter @workspace/db run check-db
// Prints connection details and verifies the database is reachable.
import pg from 'pg';
const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set.');
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query('SELECT current_database() AS db');
console.log('Connected DB:', res.rows[0].db, '✓');
await client.end();
