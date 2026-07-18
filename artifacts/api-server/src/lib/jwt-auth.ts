/**
 * JWT session auth — sign / verify / Express middleware
 * Session secret comes from SESSION_SECRET env var (already configured).
 */
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

const SECRET = () => process.env.SESSION_SECRET ?? "aegis-dev-fallback";
const EXPIRY  = "24h";

export interface SessionPayload {
  role:   "admin";
  method: "admin-key" | "google";
  email?: string;
}

export function signToken(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET(), { expiresIn: EXPIRY });
}

export function verifyToken(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET()) as SessionPayload;
  } catch {
    return null;
  }
}

/** Express middleware — requires valid Bearer JWT */
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
