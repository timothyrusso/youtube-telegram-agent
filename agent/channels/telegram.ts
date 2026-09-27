import { telegramChannel } from 'eve/channels/telegram';
import { plainText } from '../lib/plain-text.js';
import { sendTakeawaysVoice } from '../lib/takeaways-voice.js';

// Points the channel and sendVoice at a mock Bot API for local tests.
const apiBaseUrl = process.env.TELEGRAM_API_BASE_URL;

export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  ...(apiBaseUrl ? { api: { apiBaseUrl } } : {}),
  events: {
    // Eve's default reply without Markdown symbols, then the summary's key takeaways as a voice
    // note. A failed voice note is logged and skipped: the text summary has already arrived.
    async 'message.completed'(data, channel) {
      if (data.finishReason === 'tool-calls' || !data.message) return;
      const summary = plainText(data.message);
      await channel.telegram.post(summary);
      try {
        await channel.telegram.startTyping('record_voice');
        await sendTakeawaysVoice(summary, channel.telegram, apiBaseUrl);
      } catch (error) {
        console.error('Takeaways voice note failed', error);
      }
    },
  },
});
