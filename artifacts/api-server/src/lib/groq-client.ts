/**
 * Groq LLM client — wraps the OpenAI-compatible Groq REST API.
 * Model: llama-3.3-70b-versatile (best quality, still fast on Groq).
 *
 * Multi-key fallback: reads GROQ_API_KEY (primary) + GROQ_API_KEY_1 … GROQ_API_KEY_N.
 * On 429 / token-quota error the client automatically retries with the next key.
 * Set as many keys as you like — they are tried in order until one succeeds.
 */

const MODEL = "llama-3.3-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/** Collect all configured Groq API keys (deduped, empty strings excluded). */
function collectGroqKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
  for (let i = 1; i <= 20; i++) {
    const k = process.env[`GROQ_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  // Deduplicate while preserving order
  return [...new Set(keys)];
}

// Errors that indicate this key is exhausted → try next key
const ROTATE_CODES = new Set([
  429,   // rate_limit_exceeded / requests_per_day exceeded
  402,   // payment required / free-tier quota exhausted
]);
function isQuotaBody(body: string): boolean {
  const low = body.toLowerCase();
  return (
    low.includes("rate_limit") ||
    low.includes("quota") ||
    low.includes("tokens_per_day") ||
    low.includes("requests_per_day") ||
    low.includes("exceeded") ||
    low.includes("limit reached")
  );
}

export const groqAvailable = () => collectGroqKeys().length > 0;

/**
 * Detect and truncate runaway repetition in LLM output.
 * Checks for any sentence/phrase (≥30 chars) repeated 3+ times consecutively.
 */
function removeRepetition(text: string): string {
  const lines = text.split("\n");
  const seen: string[] = [];
  const out: string[] = [];
  let skipCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(line); seen.length = 0; continue; }

    // Check if this line is a near-duplicate of any of the last 6 lines
    const isDupe = seen.slice(-6).some(
      (prev) => prev.length >= 20 && trimmed.length >= 20 &&
        (prev === trimmed || prev.includes(trimmed.slice(0, 30)) || trimmed.includes(prev.slice(0, 30)))
    );

    if (isDupe) {
      skipCount++;
      if (skipCount >= 3) break; // 3+ consecutive dupes → truncate here
    } else {
      skipCount = 0;
      out.push(line);
      seen.push(trimmed);
    }
  }

  return out.join("\n").trim();
}

export async function askGroq(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number; // default 0.4; use 0.2 for factual/accuracy tasks
  topP?: number;        // default 0.95; use 0.9 for tighter sampling
}): Promise<string> {
  const keys = collectGroqKeys();
  if (keys.length === 0) throw new Error("No GROQ_API_KEY configured. Set GROQ_API_KEY or GROQ_API_KEY_1 … GROQ_API_KEY_N.");

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user",   content: opts.user },
    ],
    max_tokens:        opts.maxTokens ?? 2000,
    temperature:       opts.temperature ?? 0.4,
    top_p:             opts.topP ?? 0.95,
    frequency_penalty: 1.2,
    presence_penalty:  0.6,
  });

  let lastError = "";

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (res.ok) {
      const json = await res.json() as any;
      const raw = (json.choices?.[0]?.message?.content ?? "").trim();
      // Log which key slot was used (index only — never log the key itself)
      if (i > 0) console.info(`[groq] Used key slot ${i + 1} after ${i} exhausted key(s)`);
      return removeRepetition(raw);
    }

    const txt = await res.text();

    // Rotate on quota/rate-limit errors; hard-fail on anything else
    if (ROTATE_CODES.has(res.status) || isQuotaBody(txt)) {
      lastError = `Key slot ${i + 1}: HTTP ${res.status} — ${txt.slice(0, 120)}`;
      console.warn(`[groq] Key slot ${i + 1} exhausted — trying next key (${keys.length - i - 1} remaining)`);
      continue;
    }

    // Non-quota error (auth failure, bad request, server error) — fail immediately
    throw new Error(`Groq API ${res.status}: ${txt.slice(0, 300)}`);
  }

  throw new Error(`All ${keys.length} Groq API key(s) exhausted. Last error: ${lastError}`);
}
