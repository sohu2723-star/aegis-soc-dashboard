import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.SUPABASE_DB_URL) {
  throw new Error(
    "SUPABASE_DB_URL must be set. Get it from Supabase: Settings → Database → Connection string (URI mode).",
  );
}

const client = postgres(process.env.SUPABASE_DB_URL, {
  ssl: "require",
  max: 10,
});

export const db = drizzle(client, { schema });

export * from "./schema";
