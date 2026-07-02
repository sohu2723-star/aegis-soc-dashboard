#!/usr/bin/env node
// pnpm --filter @workspace/db run create-db
// Creates the 'aegis' database on TiDB Cloud if it doesn't exist yet.
import { createConnection } from 'mysql2/promise';

const u = new URL(process.env.MYSQL_URL);
const conn = await createConnection({
  host: u.hostname,
  port: parseInt(u.port || '4000'),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === 'false'
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true },
});
await conn.query('CREATE DATABASE IF NOT EXISTS `aegis`');
console.log('✓ Database aegis created / already exists');
await conn.end();
