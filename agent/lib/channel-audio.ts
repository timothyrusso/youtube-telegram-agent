// Posts a finished MP3 to the owner's private Telegram audio channel with sendAudio, so it shows
// in Telegram's music player (not as a voice note). The channel is fixed server-side through
// EVE_AUDIO_CHANNEL_ID; the model never chooses where audio goes.

// Bots may upload files up to 50 MB.
export const maxAudioBytes = 50 * 1024 * 1024;
const maxCaptionCharacters = 1_024;

export interface ChannelAudio {
  bytes: Uint8Array<ArrayBuffer>;
  title: string;
  durationSeconds: number;
  sourceUrl?: string;
}

export interface ChannelPost {
  messageId: number;
  /** Link that opens the post for channel members, when Telegram's id format allows one. */
  postUrl: string | null;
}

/** A filesystem- and Telegram-safe file name such as `2026-10-11-react-native-weekly.mp3`. */
export function audioFileName(title: string, date = new Date()): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return `${date.toISOString().slice(0, 10)}-${slug || 'audio-summary'}.mp3`;
}

/** Private channel ids look like -1001234567890; members open posts at t.me/c/1234567890/<id>. */
export function channelPostUrl(channelId: string, messageId: number): string | null {
  const match = /^-100(\d+)$/.exec(channelId);
  return match ? `https://t.me/c/${match[1]}/${messageId}` : null;
}

export function audioChannelId(): string | null {
  return process.env.EVE_AUDIO_CHANNEL_ID?.trim() || null;
}

/** Uploads the MP3 to the audio channel and returns the post once Telegram confirms it. */
export async function sendAudioToChannel(audio: ChannelAudio): Promise<ChannelPost> {
  const channelId = audioChannelId();
  if (!channelId) throw new Error('EVE_AUDIO_CHANNEL_ID is not set.');
  if (audio.bytes.length > maxAudioBytes) {
    throw new Error(`The audio is ${(audio.bytes.length / 1024 / 1024).toFixed(1)} MB, over Telegram's 50 MB bot upload limit.`);
  }
  const apiBaseUrl = process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org';
  const caption = (audio.sourceUrl ? `🎧 ${audio.title}\n${audio.sourceUrl}` : `🎧 ${audio.title}`).slice(0, maxCaptionCharacters);

  for (let attempt = 1; ; attempt++) {
    const form = new FormData();
    form.set('chat_id', channelId);
    form.set('title', audio.title.slice(0, 128));
    form.set('performer', 'Eve');
    form.set('duration', String(Math.round(audio.durationSeconds)));
    form.set('caption', caption);
    form.set('audio', new Blob([audio.bytes], { type: 'audio/mpeg' }), audioFileName(audio.title));

    let response: Response;
    try {
      response = await fetch(`${apiBaseUrl}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendAudio`, {
        method: 'POST',
        body: form,
        // Large episodes (20+ MB) can take a while to upload.
        signal: AbortSignal.timeout(300_000),
      });
    } catch (error) {
      throw new Error(`Uploading the audio to Telegram failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
      result?: { message_id?: number };
      description?: string;
      parameters?: { retry_after?: number };
    } | null;

    const messageId = body?.result?.message_id;
    if (response.ok && body?.ok && typeof messageId === 'number') {
      return { messageId, postUrl: channelPostUrl(channelId, messageId) };
    }
    // One retry on a rate limit (honouring retry_after, capped) or a Telegram server error.
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`sendAudio failed with status ${response.status}: ${body?.description ?? 'no description'}`);
    }
    const waitSeconds = Math.min(body?.parameters?.retry_after ?? 2, 30);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1_000));
  }
}
