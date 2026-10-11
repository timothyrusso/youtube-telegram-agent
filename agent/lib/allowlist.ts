// Comma-separated Telegram user ids allowed to use the bot (every request can spend OpenAI
// credit). When TELEGRAM_ALLOWED_USER_IDS is unset, anyone can, as before.
export function allowedSender(update: unknown, allowlist = process.env.TELEGRAM_ALLOWED_USER_IDS): boolean {
  const allowed = (allowlist ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!allowed.length) return true;
  const u = update as { message?: { from?: { id?: unknown } }; callback_query?: { from?: { id?: unknown } } } | null;
  const from = u?.message?.from?.id ?? u?.callback_query?.from?.id;
  return from !== undefined && allowed.includes(String(from));
}
