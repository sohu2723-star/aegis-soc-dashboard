/**
 * Telegram Bot client — sends alert messages to a configured chat.
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from env.
 */

const BOT_TOKEN  = () => process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID    = () => process.env.TELEGRAM_CHAT_ID   ?? "";

export function telegramAvailable(): boolean {
  return Boolean(BOT_TOKEN() && CHAT_ID());
}

export async function sendTelegramMessage(text: string): Promise<void> {
  const token  = BOT_TOKEN();
  const chatId = CHAT_ID();
  if (!token || !chatId) throw new Error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
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
