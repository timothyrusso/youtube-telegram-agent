// The durable steps behind create_audio_summary. They live apart from the tool because the
// workflow body may not import Node.js APIs; only these step functions may.
import { audioChannelId, sendAudioToChannel } from './channel-audio.js';
import { deleteParts, loadPart, partPath, savePart } from './audio-parts.js';
import { joinMp3 } from './mp3.js';
import { plainText } from './plain-text.js';
import { speak, splitScript } from './speech.js';
import { saveVaultNote } from './vault-note.js';

// About 35 minutes of speech: bounds the TTS cost and keeps the MP3 under Telegram's 50 MB limit.
const MAX_SCRIPT_CHARACTERS = 30_000;

const narration =
  'Speak in Italian with natural Italian pronunciation, clearly and warmly, like a friendly podcast host ' +
  'explaining the episode to a curious listener. Pronounce English technical terms the way Italian ' +
  'speakers in tech do. Keep a steady pace and the same voice throughout.';

/** Leftover symbols a listener should never hear: Markdown, bullets, transcript timestamps, URLs. */
function speakable(script: string): string {
  return plainText(script)
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*•\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.round(totalSeconds);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface AudioRequest {
  title: string;
  sourceUrl?: string;
  script: string;
}

/** Checks the configuration and the script, then cuts it into the parts to speak. */
export async function prepareParts(script: string, callId: string): Promise<{ parts: string[]; pathnames: string[] }> {
  'use step';
  if (!process.env.OPENAI_API_KEY) throw new Error('Audio summaries need OPENAI_API_KEY, which is not configured.');
  if (!audioChannelId()) throw new Error('Audio summaries need EVE_AUDIO_CHANNEL_ID, which is not configured.');
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Audio summaries need BLOB_READ_WRITE_TOKEN, which is not configured.');
  const text = speakable(script);
  if (text.length > MAX_SCRIPT_CHARACTERS) {
    throw new Error(
      `The script is ${text.length} characters; the limit is ${MAX_SCRIPT_CHARACTERS} (about 35 minutes). ` +
        'For a summary, write a shorter one; for a full reading, tell the user the content is too long instead.',
    );
  }
  const parts = splitScript(text);
  return { parts, pathnames: parts.map((_, index) => partPath(callId, index)) };
}

/** Speaks one part and stores its MP3 for the final step. */
export async function speakPart(pathname: string, index: number, total: number, text: string): Promise<string> {
  'use step';
  try {
    await savePart(pathname, await speak(text, { format: 'mp3', instructions: narration }));
  } catch (error) {
    throw new Error(`Speech for part ${index + 1} of ${total}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return pathname;
}

/** Joins the stored parts into one MP3, posts it to the channel and removes the parts. */
export async function joinAndPost(pathnames: string[], request: Omit<AudioRequest, 'script'>, characters: number) {
  'use step';
  const started = Date.now();
  const chunks = [];
  for (const pathname of pathnames) chunks.push(await loadPart(pathname));
  const audio = joinMp3(chunks);
  const post = await sendAudioToChannel({
    bytes: audio.bytes,
    title: request.title,
    durationSeconds: audio.durationSeconds,
    sourceUrl: request.sourceUrl,
  });
  await deleteParts(pathnames).catch((error: unknown) => console.warn('Could not delete audio parts', { error: String(error) }));
  // Usage log for personal cost monitoring; never the script itself.
  console.info('Audio summary delivered', {
    characters,
    chunks: chunks.length,
    durationSeconds: Math.round(audio.durationSeconds),
    megabytes: Number((audio.bytes.length / 1024 / 1024).toFixed(2)),
    joinAndUploadMs: Date.now() - started,
  });
  return {
    delivered: true,
    title: request.title,
    duration: formatDuration(audio.durationSeconds),
    postUrl: post.postUrl,
    messageId: post.messageId,
  };
}

/**
 * Keeps the script heard in the audio as a note in the owner's vault. The audio is already
 * delivered, so a failure here is logged and reported, never thrown.
 */
export async function saveNote(request: AudioRequest, duration: string, postUrl: string | null): Promise<string | null> {
  'use step';
  try {
    const path = await saveVaultNote({ ...request, script: speakable(request.script), duration, postUrl });
    if (path) console.info('Audio note saved to the vault', { path });
    return path;
  } catch (error) {
    console.warn('Could not save the audio note to the vault', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function discardParts(pathnames: string[]): Promise<void> {
  'use step';
  await deleteParts(pathnames).catch(() => undefined);
}

