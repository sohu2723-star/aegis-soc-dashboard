/**
 * Groq LLM client — wraps the OpenAI-compatible Groq REST API.
 * Model: llama-3.3-70b-versatile (best quality, still fast on Groq).
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY ?? "";
const MODEL = "llama-3.3-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export const groqAvailable = () => Boolean(GROQ_API_KEY);

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
      max_tokens:  opts.maxTokens ?? 4000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Groq API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json() as any;
  return (json.choices?.[0]?.message?.content ?? "").trim();
}
