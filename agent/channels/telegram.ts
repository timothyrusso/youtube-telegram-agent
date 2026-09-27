import { telegramChannel } from 'eve/channels/telegram';
import { sendTakeawaysVoice } from '../lib/takeaways-voice.js';

// Points the channel and sendVoice at a mock Bot API for local tests.
const apiBaseUrl = process.env.TELEGRAM_API_BASE_URL;

export default telegramChannel({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  ...(apiBaseUrl ? { api: { apiBaseUrl } } : {}),
  events: {
    // Eve's default reply, then the summary's key takeaways as a voice note. A failed voice
    // note is logged and skipped: the text summary has already arrived.
    async 'message.completed'(data, channel) {
      if (data.finishReason === 'tool-calls' || !data.message) return;
      await channel.telegram.post(data.message);
      try {
        await channel.telegram.startTyping('record_voice');
        await sendTakeawaysVoice(data.message, channel.telegram, apiBaseUrl);
      } catch (error) {
        console.error('Takeaways voice note failed', error);
      }
    },
  },
});
