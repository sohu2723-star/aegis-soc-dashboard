import { Router } from "express";
import { db } from "@workspace/db";
import { systemStatusTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const router = Router();

router.get("/system/status", async (req, res) => {
  const statuses = await db
    .select()
    .from(systemStatusTable)
    .orderBy(asc(systemStatusTable.layer));

  res.json(statuses.map(s => ({
    ...s,
    lastCheck: s.lastCheck.toISOString(),
  })));
});

export default router;
