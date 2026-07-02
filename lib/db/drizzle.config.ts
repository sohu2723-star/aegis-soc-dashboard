import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL must be set. Get it from Supabase: Settings → Database → Connection string (URI mode).");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL,
  },
});
