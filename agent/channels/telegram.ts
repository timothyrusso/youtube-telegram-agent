import { timingSafeEqual } from 'node:crypto';
import { telegramChannel } from 'eve/channels/telegram';
import { allowedSender } from '../lib/allowlist.js';
import { pdfUpdateAsText } from '../lib/pdf.js';
import { plainText } from '../lib/plain-text.js';
import { sendTakeawaysVoice } from '../lib/takeaways-voice.js';

// Points the channel and sendVoice at a mock Bot API for local tests.
const apiBaseUrl = process.env.TELEGRAM_API_BASE_URL;

// The turn in which create_audio_summary posted audio; that turn gets no extra voice note.
type AudioTurnState = { audioTurnId?: string | null };

const channel = telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  ...(apiBaseUrl ? { api: { apiBaseUrl } } : {}),
  events: {
    async 'action.result'(data, channel) {
      const { result } = data;
      if (result.kind === 'tool-result' && result.toolName === 'create_audio_summary' && !result.isError) {
        (channel.state as AudioTurnState).audioTurnId = data.turnId;
      }
    },
    // Eve's default reply without Markdown symbols, then the summary's key takeaways as a voice
    // note. A failed voice note is logged and skipped: the text summary has already arrived.
    async 'message.completed'(data, channel) {
      if (data.finishReason === 'tool-calls' || !data.message) return;
      const summary = plainText(data.message);
      await channel.telegram.post(summary);
      if ((channel.state as AudioTurnState).audioTurnId === data.turnId) return;
      try {
        await channel.telegram.startTyping('record_voice');
        await sendTakeawaysVoice(summary, channel.telegram, apiBaseUrl);
      } catch (error) {
        console.error('Takeaways voice note failed', error);
      }
    },
  },
});

const startCommand = new RegExp(`^/start(?:@${process.env.TELEGRAM_BOT_USERNAME ?? ''})?$`, 'i');

function fromTelegram(request: Request): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN ?? '';
  const received = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  return expected.length > 0 && received.length === expected.length &&
    timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

// A private chat is one long session, so /start alone would keep the old history (and, after a
// deploy, the old version while a question is pending). Retire that session first: /start then
// opens a fresh one on the current deployment. The onMessage hook cannot do this, it runs
// without session operations, so it happens in the webhook route.
const [webhook] = channel.routes;
if (webhook?.transport !== 'http') throw new Error('telegram channel: expected the webhook route');
channel.routes = [{
  ...webhook,
  async handler(request, args) {
    if (fromTelegram(request)) {
      const update = await request.clone().json().catch(() => null);
      // Acknowledge strangers with 200 so Telegram doesn't retry, and drop the update.
      if (!allowedSender(update)) return new Response(null, { status: 200 });
      const message = update?.message;
      if (message?.chat?.type === 'private' && startCommand.test(String(message.text ?? '').trim())) {
        // Private-chat continuation address: `<chatId>:<topic>:<conversation>`, both empty.
        await args.from(`${message.chat.id}::`).reset({ reason: 'User sent /start' })
          .catch((error: unknown) => console.warn('telegram /start reset failed', error));
      }
      // A PDF reaches the agent as a text note with its file id; read_pdf fetches the text.
      const pdfUpdate = pdfUpdateAsText(update);
      if (pdfUpdate) {
        const headers = new Headers(request.headers);
        headers.delete('content-length');
        return webhook.handler(new Request(request.url, { method: 'POST', headers, body: JSON.stringify(pdfUpdate) }), args);
      }
    }
    return webhook.handler(request, args);
  },
}];

export default channel;
