/**
 * Google Translate TTS proxy
 * POST /api/tts/speak   { text: string, lang?: string }
 * GET  /api/tts/speak?text=...&lang=my   (kept for backward compat, short texts only)
 *
 * Returns an array of audio URLs the browser plays sequentially.
 * No API key required — uses the unofficial google-tts-api package.
 *
 * POST is preferred because full AI analysis text (500-1500 chars) easily
 * exceeds safe URL length when URL-encoded as a GET query param.
 */
import { Router } from "express";
import googleTTS from "google-tts-api";

const router = Router();

function buildTtsResponse(text: string, lang: string, res: any) {
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "text too long (max 5000 chars)" });
    return;
  }
  try {
    const chunks = googleTTS.getAllAudioUrls(text, {
      lang,
      slow: false,
      host: "https://translate.google.com",
      splitPunct: ",.!?၊။",
    });
    res.json({ urls: chunks.map((c: any) => c.url) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}

// POST — preferred for long texts (full AI analysis)
router.post("/tts/speak", (req, res) => {
  const text = (req.body?.text as string) ?? "";
  const lang = (req.body?.lang as string) ?? "my";
  buildTtsResponse(text, lang, res);
});

// GET — kept for backward compat
router.get("/tts/speak", (req, res) => {
  const text = (req.query.text as string) ?? "";
  const lang = (req.query.lang as string) ?? "my";
  buildTtsResponse(text, lang, res);
});

export default router;
