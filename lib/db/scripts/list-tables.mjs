#!/usr/bin/env node
import { createConnection } from 'mysql2/promise';

const u = new URL(process.env.MYSQL_URL);
const conn = await createConnection({
  host: u.hostname, port: parseInt(u.port || '4000'),
  user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  database: 'aegis',
  ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === 'false' ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
});
const [rows] = await conn.query("SHOW TABLES");
console.log("Tables in aegis:");
rows.forEach(r => console.log(" -", Object.values(r)[0]));
await conn.end();
