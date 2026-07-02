import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set.");
}

const useSSL = !databaseUrl.includes("sslmode=disable");

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: useSSL ? "require" : false,
  },
});
