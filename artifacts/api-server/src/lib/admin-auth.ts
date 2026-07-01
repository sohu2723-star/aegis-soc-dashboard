/**
 * Admin auth middleware for sensitive endpoints.
 * Requires X-AEGIS-Admin-Key header matching AEGIS_ADMIN_KEY env var.
 * Agent polling uses the same key with vm= query param.
 */
import type { Request, Response, NextFunction } from "express";

const ADMIN_KEY = process.env.AEGIS_ADMIN_KEY;

if (!ADMIN_KEY) {
  throw new Error(
    "AEGIS_ADMIN_KEY env var is required. " +
    "Set a strong random secret (e.g. openssl rand -hex 32)."
  );
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-aegis-admin-key"] as string | undefined;
  if (!key || key !== ADMIN_KEY) {
    res.status(401).json({ error: "Unauthorized: X-AEGIS-Admin-Key required" });
    return;
  }
  next();
}
