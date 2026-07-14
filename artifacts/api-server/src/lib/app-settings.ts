/**
 * Small persisted key/value settings store (app_settings table).
 * Used for global toggles like autoDefenseEnabled that must survive restarts
 * and be shared between the ingest pipeline and the dashboard API.
 */
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.insert(appSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

export async function isAutoDefenseEnabled(): Promise<boolean> {
  const v = await getSetting("autoDefenseEnabled");
  // Default OFF — auto-defense must be explicitly enabled from the dashboard.
  // Prevents phantom blocks when the setting has never been saved.
  return v === "true";
}
