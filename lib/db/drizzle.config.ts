import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.MYSQL_URL) {
  throw new Error("MYSQL_URL must be set. Format: mysql://user:password@host:4000/aegis");
}

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
    ssl: process.env.MYSQL_SSL_REJECT_UNAUTH === "false"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
  },
});
