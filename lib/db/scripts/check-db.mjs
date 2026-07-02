#!/usr/bin/env node
// pnpm --filter @workspace/db run check-db
// Prints connection details and verifies 'aegis' database is reachable.
import { createConnection } from 'mysql2/promise';

const u = new URL(process.env.MYSQL_URL);
console.log('Host    :', u.hostname);
console.log('Port    :', u.port);
console.log('User    :', u.username);
console.log('DB path :', u.pathname.replace(/^\//, '') || '(none)');

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
const [rows] = await conn.query('SELECT DATABASE() AS db');
console.log('Connected DB:', rows[0].db, '✓');
await conn.end();
