/**
 * JWT session auth — sign / verify / Express middleware
 * Session secret comes from SESSION_SECRET env var (already configured).
 */
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = () => process.env.SESSION_SECRET ?? "aegis-dev-fallback";
const EXPIRY  = "24h";
const DEMO_EXPIRY = "7d"; // Demo tokens last longer

export interface SessionPayload {
  role:   "admin" | "demo";
  method: "admin-key" | "google" | "demo";
  // email intentionally omitted from token — not safe in base64-decodable JWT
}

export function signToken(payload: SessionPayload, expiry = EXPIRY): string {
  return jwt.sign(payload, SECRET(), { expiresIn: expiry });
}

export function signDemoToken(): string {
  return signToken({ role: "demo", method: "demo" }, DEMO_EXPIRY);
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET()) as SessionPayload;
  } catch {
    return null;
  }
}

/** Express middleware — requires valid Bearer JWT (admin or demo) */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized — please login" });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  (req as any).user = payload;
  next();
}

/** Express middleware — requires admin role (blocks demo users from write ops) */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as SessionPayload | undefined;
  if (user?.role !== "admin") {
    res.status(403).json({ error: "Read-only — demo mode does not allow this action" });
    return;
  }
  next();
}
