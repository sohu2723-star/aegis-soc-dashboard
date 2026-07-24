/**
 * Google Translate TTS proxy
 * GET /api/tts/speak?text=...&lang=my
 * Returns an array of audio URLs the browser plays sequentially.
 * No API key required — uses the unofficial google-tts-api package.
 */
import { Router } from "express";
import googleTTS from "google-tts-api";

const router = Router();

router.get("/tts/speak", (req, res) => {
  const text = (req.query.text as string) ?? "";
  const lang = (req.query.lang as string) ?? "my";

  if (!text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (text.length > 3000) {
    res.status(400).json({ error: "text too long (max 3000 chars)" });
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
});

export default router;
