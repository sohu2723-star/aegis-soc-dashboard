/**
 * Auth routes
 *   POST /api/auth/admin-key   — login with AEGIS_ADMIN_KEY
 *   POST /api/auth/google      — verify Google ID token; allow only ALLOWED_EMAIL
 *   GET  /api/auth/me          — validate current session
 *   POST /api/auth/logout      — client-side only (clears nothing server-side)
 */
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import { signToken, verifyToken } from "../lib/jwt-auth";

const router = Router();

const GOOGLE_CLIENT_ID = "524254578493-9ce8ttte7c63hjo61rn9seo2m6jpfbjb.apps.googleusercontent.com";
const ALLOWED_EMAIL    = "copy2723@gmail.com";

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

/* ── Admin Key login ─────────────────────────────────────────────────────── */
router.post("/auth/admin-key", (req, res) => {
  const { key } = req.body as { key?: string };
  const adminKey = process.env.AEGIS_ADMIN_KEY;

  if (!adminKey) {
    res.status(500).json({ error: "Server not configured (AEGIS_ADMIN_KEY missing)" });
    return;
  }
  if (!key || key !== adminKey) {
    res.status(401).json({ error: "Invalid admin key" });
    return;
  }

  const token = signToken({ role: "admin", method: "admin-key" });
  res.json({ ok: true, token });
});

/* ── Google login ────────────────────────────────────────────────────────── */
router.post("/auth/google", async (req, res) => {
  const { credential } = req.body as { credential?: string };
  if (!credential) {
    res.status(400).json({ error: "No Google credential provided" });
    return;
  }

  try {
    const ticket  = await googleClient.verifyIdToken({
      idToken:  credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      res.status(401).json({ error: "Could not read email from token" });
      return;
    }
    if (payload.email !== ALLOWED_EMAIL) {
      res.status(403).json({ error: `Access denied — ${payload.email} is not authorised` });
      return;
    }

    const token = signToken({ role: "admin", method: "google", email: payload.email });
    res.json({ ok: true, token, email: payload.email });
  } catch (err: any) {
    res.status(401).json({ error: err?.message ?? "Google token verification failed" });
  }
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
  res.json({ ok: true, user: payload });
});

/* ── Logout (stateless — client just discards the token) ─────────────────── */
router.post("/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

export default router;
