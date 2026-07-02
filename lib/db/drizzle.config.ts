import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.MYSQL_URL) {
  throw new Error("MYSQL_URL must be set. Format: mysql://user:password@host:4000/aegis");
}

// Parse the URL so we can inject ssl explicitly (drizzle-kit ignores ssl: {} on url-only config)
const u = new URL(process.env.MYSQL_URL);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "mysql",
  dbCredentials: {
    host: u.hostname,
    port: parseInt(u.port || "4000", 10),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, "").replace(/^sys$/, "aegis") || "aegis",
    // TiDB Cloud Serverless uses a public CA trusted by Node.js by default.
    // Only skip verification when explicitly opted-in via env (local non-TLS dev).
    ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === "false"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
  },
});
