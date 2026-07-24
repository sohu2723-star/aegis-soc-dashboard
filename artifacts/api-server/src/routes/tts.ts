/**
 * Google Translate TTS proxy
 * POST /api/tts/speak   { text: string, lang?: string }
 * GET  /api/tts/speak?text=...&lang=my   (kept for backward compat, short texts only)
 *
 * Fetches audio from Google TTS server-side and returns base64-encoded MP3 chunks.
 * Browser plays via Blob URLs — no CORS issues, no autoplay policy blocking.
 * No API key required — uses the unofficial google-tts-api package.
 */
import { Router } from "express";
import googleTTS from "google-tts-api";

const router = Router();

const TTS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "Referer": "https://translate.google.com/",
  "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
};

async function buildTtsResponse(text: string, lang: string, res: any) {
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" }); return;
  }
  if (text.length > 5000) {
    res.status(400).json({ error: "text too long (max 5000 chars)" }); return;
  }
  try {
    const chunks: { url: string }[] = googleTTS.getAllAudioUrls(text, {
      lang,
      slow: false,
      host: "https://translate.google.com",
      splitPunct: ",.!?၊။",
    });

    // Fetch all chunks server-side → return as base64 so browser plays via Blob URL (no CORS)
    const b64chunks = await Promise.all(
      chunks.map(async (c) => {
        const r = await fetch(c.url, { headers: TTS_HEADERS });
        if (!r.ok) throw new Error(`TTS fetch failed: ${r.status}`);
        const buf = await r.arrayBuffer();
        return Buffer.from(buf).toString("base64");
      })
    );

    res.json({ chunks: b64chunks, type: "base64/mp3" });
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
