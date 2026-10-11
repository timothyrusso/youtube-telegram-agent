// OpenAI text-to-speech, shared by the takeaways voice note and the long audio summaries.

// OpenAI recommends marin or cedar for quality; override with OPENAI_TTS_VOICE.
const defaultVoice = 'marin';
// The speech endpoint accepts at most 4,096 characters per request; stay well below it.
export const maxChunkCharacters = 3_500;
const concurrency = 3;

export interface SpeakOptions {
  format: 'opus' | 'mp3';
  instructions: string;
  signal?: AbortSignal;
}

/** One speech request. Retries once on a rate limit or server error. */
export async function speak(text: string, { format, instructions, signal }: SpeakOptions): Promise<Uint8Array<ArrayBuffer>> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
        voice: process.env.OPENAI_TTS_VOICE ?? defaultVoice,
        input: text,
        instructions,
        response_format: format,
      }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`OpenAI speech failed with status ${response.status}: ${await response.text()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Splits a script into chunks of at most `max` characters, at paragraph breaks when possible,
 * then at sentence ends, and only as a last resort at spaces. Order is preserved.
 */
export function splitScript(script: string, max = maxChunkCharacters): string[] {
  const sentences = script
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .flatMap((paragraph) => {
      const parts = paragraph.replace(/\s+/g, ' ').trim().match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [];
      const trimmed = parts.map((part) => part.trim()).filter(Boolean);
      // Mark the paragraph's end so chunking prefers to break there.
      if (trimmed.length) trimmed[trimmed.length - 1] += '\n\n';
      return trimmed;
    })
    .flatMap((sentence) => (sentence.length <= max ? [sentence] : splitAtSpaces(sentence, max)));

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const joined = current ? `${current}${current.endsWith('\n\n') ? '' : ' '}${sentence}` : sentence;
    if (joined.trimEnd().length > max && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = joined;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function splitAtSpaces(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > 0 ? cut : max;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Runs `task` over `items` with at most `limit` in flight, keeping results in input order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Speaks a long script as MP3 chunks, in order. Any failed chunk fails the whole script. */
export function speakScript(script: string, instructions: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>[]> {
  return mapWithConcurrency(splitScript(script), concurrency, (chunk) =>
    speak(chunk, { format: 'mp3', instructions, signal }),
  );
}
