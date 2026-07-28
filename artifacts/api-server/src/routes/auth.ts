/**
 * Auth routes
 *   POST /api/auth/admin-key   — login with AEGIS_ADMIN_KEY
 *   POST /api/auth/google      — verify Google ID token; allow only ADMIN_EMAIL
 *   POST /api/auth/demo        — public demo access (read-only token)
 *   GET  /api/auth/me          — validate current session
 *   POST /api/auth/logout      — client-side only (clears nothing server-side)
 */
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { signToken, signDemoToken, verifyToken } from "../lib/jwt-auth";

const router = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
// ADMIN_EMAIL must be set via env — no hardcoded fallback (security)
const ALLOWED_EMAIL = process.env.ADMIN_EMAIL ?? "";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/* ── Admin Key login ─────────────────────────────────────────────────────── */
router.post("/auth/admin-key", (req, res) => {
  const { key } = req.body as { key?: string };
  const adminKey = process.env.AEGIS_ADMIN_KEY;

  if (!adminKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }
  if (!key || key !== adminKey) {
    res.status(401).json({ error: "Invalid access key" });
    return;
  }

  const token = signToken({ role: "admin", method: "admin-key" });
  res.json({ ok: true, token });
});

/* ── Google login ────────────────────────────────────────────────────────── */
router.post("/auth/google", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential) {
    res.status(400).json({ error: "No credential provided" });
    return;
  }
  if (!GOOGLE_CLIENT_ID) {
    res.status(500).json({ error: "Google auth not configured" });
    return;
  }

  try {
    const ticket  = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      res.status(401).json({ error: "Could not verify identity" });
      return;
    }
    if (!ALLOWED_EMAIL || payload.email !== ALLOWED_EMAIL) {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    // email not stored in JWT — only role/method (JWT is base64 decodable)
    const token = signToken({ role: "admin", method: "google" });
    // Return display name only (not full email) for UI
    const displayName = payload.name ?? payload.email.split("@")[0];
    res.json({ ok: true, token, displayName });
  } catch (err: any) {
    res.status(401).json({ error: "Verification failed" });
  }
});

/* ── Demo access — no credentials needed, read-only token ───────────────── */
router.post("/auth/demo", (_req, res) => {
  const token = signDemoToken();
  res.json({ ok: true, token });
});

/* ── Whoami ──────────────────────────────────────────────────────────────── */
router.get("/auth/me", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }
  // Never return sensitive info — only role and method
  res.json({ ok: true, user: { role: payload.role, method: payload.method } });
});

/* ── Logout (stateless — client just discards the token) ─────────────────── */
router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;
