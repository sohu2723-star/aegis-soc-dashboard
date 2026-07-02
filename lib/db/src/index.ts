import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

if (!process.env.MYSQL_URL) {
  throw new Error(
    "MYSQL_URL must be set. Format: mysql://user:password@host:4000/aegis",
  );
}

const _u = new URL(process.env.MYSQL_URL!);
const pool = mysql.createPool({
  host: _u.hostname,
  port: parseInt(_u.port || "4000", 10),
  user: decodeURIComponent(_u.username),
  password: decodeURIComponent(_u.password),
  database: _u.pathname.replace(/^\//, "").replace(/^sys$/, "aegis") || "aegis",
  ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === "false"
    ? { rejectUnauthorized: false }
    : { rejectUnauthorized: true },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export const db = drizzle(pool, { schema, mode: "default" });

export * from "./schema";
