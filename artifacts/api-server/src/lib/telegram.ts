/**
 * Telegram Bot client — sends alert messages to a configured chat.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
 */

const BOT_TOKEN  = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID    = () => process.env.TELEGRAM_CHAT_ID   ?? "";
const RETRY_DELAYS_MS = [250, 750];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function telegramAvailable(): boolean {
  return Boolean(BOT_TOKEN() && CHAT_ID());
}

/**
 * Sanitize arbitrary text for use inside Telegram HTML parse_mode.
 * Escapes &, <, > then converts Markdown ## headings and **bold** to HTML tags.
 */
export function sanitizeForTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // ## Section headings → <b>
    .replace(/^##\s+(.+)$/gm, "\n<b>$1</b>")
    // **bold** → <b>
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    // Trim excess blank lines
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const token  = BOT_TOKEN();
  const chatId = CHAT_ID();
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured");

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      });
      if (res.ok) return;

      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === RETRY_DELAYS_MS.length) {
        throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
      }
    } catch (error) {
      if (attempt === RETRY_DELAYS_MS.length) throw error;
    }
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

export async function testTelegramConnection(): Promise<{ ok: boolean; botName?: string; error?: string }> {
  const token = BOT_TOKEN();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };

  try {
    const res  = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const json = await res.json() as any;
    if (!json.ok) return { ok: false, error: json.description ?? "Unknown error" };
    return { ok: true, botName: json.result?.username ?? "unknown" };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}
