import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Replit PostgreSQL should provision this automatically.",
  );
}

const dbUrl = process.env.DATABASE_URL;
const useSSL = !dbUrl.includes("sslmode=disable");

const client = postgres(dbUrl, {
  ssl: useSSL ? "require" : false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export * from "./schema";
