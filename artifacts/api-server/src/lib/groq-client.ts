/**
 * Groq LLM client — wraps the OpenAI-compatible Groq REST API.
 * Model: llama-3.3-70b-versatile (best quality, still fast on Groq).
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL = "llama-3.3-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const groqAvailable = () => Boolean(GROQ_API_KEY);

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
}): Promise<string> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: opts.system },
        { role: "user",   content: opts.user },
      ],
      max_tokens:       opts.maxTokens ?? 2000,
      temperature:      0.4,
      frequency_penalty: 1.2,   // strongly penalise repeated tokens → prevents loop
      presence_penalty:  0.6,   // encourage covering new topics
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  const raw = (json.choices?.[0]?.message?.content ?? "").trim();
  return removeRepetition(raw);
}
