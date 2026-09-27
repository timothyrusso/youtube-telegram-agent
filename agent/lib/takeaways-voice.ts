// Reads a summary's "Key takeaways" aloud as a Telegram voice note (OpenAI text-to-speech).

// OpenAI recommends marin or cedar for quality; override with OPENAI_TTS_VOICE.
const defaultVoice = 'marin';
// Keeps a clip around 30–60 s, and the cost to cents.
const maxCharacters = 900;

/** The lines after the "Key takeaways" heading, as plain sentences; null when there is none. */
export function takeawaysFrom(summary: string): string | null {
  const lines = summary.split('\n');
  const heading = lines.findIndex((line) => /key takeaways/i.test(line));
  if (heading === -1) return null;
  const points = lines
    .slice(heading + 1)
    .map((line) => line.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, '').replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').trim())
    .filter(Boolean)
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`));
  if (!points.length) return null;
  let text = 'Key takeaways.';
  for (const point of points) {
    if (text.length + point.length + 1 > maxCharacters) break;
    text += ` ${point}`;
  }
  return text;
}

async function speak(text: string): Promise<Uint8Array> {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: process.env.OPENAI_TTS_VOICE ?? defaultVoice,
      input: text,
      instructions: 'Speak clearly and warmly, like a friendly podcast host summing up an episode.',
      // Opus in an Ogg container is what Telegram voice notes use.
      response_format: 'opus',
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`OpenAI speech failed with status ${response.status}: ${await response.text()}`);
  return new Uint8Array(await response.arrayBuffer());
}

// ctx.telegram.request only sends JSON, so the audio goes up as multipart form data.
async function sendVoice(chatId: string, audio: Uint8Array, apiBaseUrl: string, messageThreadId?: number) {
  const form = new FormData();
  form.set('chat_id', chatId);
  if (messageThreadId !== undefined) form.set('message_thread_id', String(messageThreadId));
  form.set('caption', '🎧 Key takeaways');
  form.set('voice', new Blob([audio], { type: 'audio/ogg' }), 'takeaways.ogg');
  const response = await fetch(`${apiBaseUrl}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVoice`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`sendVoice failed with status ${response.status}: ${await response.text()}`);
}

/** Speak the summary's key takeaways and send them as a voice note. Needs OPENAI_API_KEY. */
export async function sendTakeawaysVoice(
  summary: string,
  chat: { chatId: string; messageThreadId?: number },
  apiBaseUrl = 'https://api.telegram.org',
): Promise<boolean> {
  if (!process.env.OPENAI_API_KEY) return false;
  const text = takeawaysFrom(summary);
  if (!text) return false;
  await sendVoice(chat.chatId, await speak(text), apiBaseUrl, chat.messageThreadId);
  return true;
}
