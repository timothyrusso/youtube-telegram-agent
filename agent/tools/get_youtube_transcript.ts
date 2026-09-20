import { defineTool } from 'eve/tools';
import { never } from 'eve/tools/approval';
import { fetchTranscript as fetchYouTubeTranscript } from 'youtube-transcript-plus';
import { z } from 'zod';

const MAX_TRANSCRIPT_CHARACTERS = 700_000;
const PARAGRAPH_SECONDS = 60;

interface TranscriptSegment {
  text: string;
  duration: number;
  offset: number;
  lang: string;
}

interface SupadataResponse {
  content?: Array<{
    text: string;
    duration: number;
    offset: number;
    lang: string;
  }>;
  lang?: string;
}

async function fetchSupadataTranscript(url: string, apiKey: string) {
  const query = new URLSearchParams({ url, mode: 'native' });
  const response = await fetch(`https://api.supadata.ai/v1/transcript?${query}`, {
    headers: { 'x-api-key': apiKey },
  });
  const body = (await response.json()) as SupadataResponse;

  if (response.status === 206 || !response.ok || !Array.isArray(body.content)) {
    throw new Error(`Supadata native transcript request failed with status ${response.status}.`);
  }
  if (body.content.length === 0) throw new Error('No captions are available for this video.');

  return {
    segments: body.content.map((segment): TranscriptSegment => ({
      ...segment,
      offset: segment.offset / 1_000,
      duration: segment.duration / 1_000,
      lang: segment.lang || body.lang || 'unknown',
    })),
  };
}

async function fetchVideoMetadata(url: string) {
  const query = new URLSearchParams({ url, format: 'json' });
  const response = await fetch(`https://www.youtube.com/oembed?${query}`);
  if (!response.ok) return { title: '', author: '' };

  const body = (await response.json()) as { title?: string; author_name?: string };
  return { title: body.title ?? '', author: body.author_name ?? '' };
}

function formatTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return hours > 0
    ? [hours, minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':')
    : [minutes, remainder].map((part) => String(part).padStart(2, '0')).join(':');
}

function parseYouTubeVideoId(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Send a valid YouTube video URL.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  let videoId: string | null = null;

  if (hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com'
  ) {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(url.pathname)) {
      videoId = url.pathname.split('/').filter(Boolean)[1] ?? null;
    }
  }

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new Error('The link must point to a valid YouTube video.');
  }

  return videoId;
}

export default defineTool({
  approval: never(),
  description:
    'Fetch the captions, timestamps, and metadata for a public YouTube video so its content can be summarized.',
  inputSchema: z.object({
    url: z.string().min(1).describe('A full YouTube video URL supplied by the user.'),
  }),
  label: {
    start: () => 'Reading the YouTube transcript',
  },
  async execute({ url }) {
    const videoId = parseYouTubeVideoId(url);
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      const supadataApiKey = process.env.SUPADATA_API_KEY;
      const localResult = supadataApiKey
        ? null
        : await fetchYouTubeTranscript(videoId, {
            retries: 2,
            retryDelay: 750,
            videoDetails: true,
          });
      const hostedResult = supadataApiKey
        ? await fetchSupadataTranscript(canonicalUrl, supadataApiKey)
        : null;
      const segments = hostedResult?.segments ?? localResult?.segments ?? [];

      if (segments.length === 0) {
        throw new Error('No captions are available for this video.');
      }

      const paragraphs: string[] = [];
      let paragraphStart = segments[0].offset;
      let paragraphText: string[] = [];

      for (const segment of segments) {
        if (segment.offset - paragraphStart >= PARAGRAPH_SECONDS && paragraphText.length > 0) {
          paragraphs.push(`[${formatTimestamp(paragraphStart)}] ${paragraphText.join(' ')}`);
          paragraphStart = segment.offset;
          paragraphText = [];
        }
        paragraphText.push(segment.text.replace(/\s+/g, ' ').trim());
      }

      if (paragraphText.length > 0) {
        paragraphs.push(`[${formatTimestamp(paragraphStart)}] ${paragraphText.join(' ')}`);
      }

      const transcript = paragraphs.join('\n\n');
      if (transcript.length > MAX_TRANSCRIPT_CHARACTERS) {
        throw new Error('This transcript is too long to summarize safely. Try a shorter video.');
      }

      const metadata = localResult?.videoDetails ?? (await fetchVideoMetadata(canonicalUrl));
      const durationSeconds = localResult?.videoDetails.lengthSeconds ?? Math.ceil(
        Math.max(...segments.map((segment) => segment.offset + segment.duration)),
      );

      return {
        videoId,
        canonicalUrl,
        title: metadata.title,
        creator: metadata.author,
        durationSeconds,
        duration: formatTimestamp(durationSeconds),
        transcriptLanguage: segments[0].lang,
        transcript,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('too long')) throw error;
      console.error('YouTube transcript retrieval failed', {
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        'Could not retrieve captions for this video. It may be private, unavailable, age-restricted, or missing captions.',
      );
    }
  },
});
