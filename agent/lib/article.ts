// Reads the main text of a public article: fetch it directly and extract it with Readability,
// or, when the site blocks datacenter traffic or renders with JavaScript, ask a reader service.
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { fetchPublicPage, parsePublicUrl } from './safe-fetch.js';

// Below this the "article" is usually a cookie wall, a paywall teaser or an error page.
export const minArticleCharacters = 500;
// About 15k tokens: plenty for a summary, bounded for cost.
export const maxArticleCharacters = 60_000;

const blockSelector = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figcaption, tr';
const PARAGRAPH = '';
const LINE = '';

export interface Article {
  title: string;
  author: string | null;
  site: string | null;
  language: string | null;
  text: string;
  truncated: boolean;
  via: 'direct' | 'reader';
}

function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function capped(text: string): { text: string; truncated: boolean } {
  if (text.length <= maxArticleCharacters) return { text, truncated: false };
  const cut = text.lastIndexOf('\n\n', maxArticleCharacters);
  return { text: text.slice(0, cut > maxArticleCharacters / 2 ? cut : maxArticleCharacters), truncated: true };
}

/** Extracts the readable article from a page's HTML; null when there is no real article. */
export function extractArticle(html: string): Omit<Article, 'via' | 'truncated'> | null {
  const { document } = parseHTML(html);
  const language = document.documentElement?.getAttribute('lang') || null;
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed?.content) return null;

  // Readability's textContent loses paragraph breaks and keeps the source's hard line wraps.
  // Mark real breaks (blocks, <br>) with private-use characters, collapse all other whitespace,
  // then turn the marks back into newlines.
  const { document: cleaned } = parseHTML(`<!doctype html><html><body>${parsed.content}</body></html>`);
  for (const block of cleaned.querySelectorAll(blockSelector)) {
    // Both ends: Readability can nest a paragraph right after loose text ("July 2023<p>...").
    block.prepend(PARAGRAPH);
    block.append(PARAGRAPH);
  }
  for (const br of cleaned.querySelectorAll('br')) br.replaceWith(LINE);
  const text = tidy(
    (cleaned.body.textContent ?? '')
      .replace(/[\s ]+/g, ' ')
      .replaceAll(PARAGRAPH, '\n\n')
      .replaceAll(LINE, '\n'),
  );
  if (text.length < minArticleCharacters) return null;

  return {
    title: tidy(parsed.title ?? '') || 'Untitled article',
    author: parsed.byline ? tidy(parsed.byline) : null,
    site: parsed.siteName ? tidy(parsed.siteName) : null,
    language: parsed.lang || language,
    text,
  };
}

/** Jina Reader renders the page (JavaScript included) on its side and returns plain text. */
async function readThroughService(url: string): Promise<Omit<Article, 'via' | 'truncated'> | null> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: 'application/json', 'X-Return-Format': 'text' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    data?: { title?: string; text?: string; content?: string; metadata?: { lang?: string } };
  } | null;
  const text = tidy(body?.data?.text ?? body?.data?.content ?? '');
  if (text.length < minArticleCharacters) return null;
  return {
    title: tidy(body?.data?.title ?? '') || 'Untitled article',
    author: null,
    site: null,
    language: body?.data?.metadata?.lang || null,
    text,
  };
}

function readerFallbackEnabled() {
  return process.env.ARTICLE_READER_FALLBACK !== 'off';
}

/** The article at `input`, or an error that explains in plain words why it couldn't be read. */
export async function readArticle(input: string): Promise<Article> {
  const url = parsePublicUrl(input).toString();
  let direct: Omit<Article, 'via' | 'truncated'> | null = null;
  try {
    const page = await fetchPublicPage(url);
    if (page.status >= 200 && page.status < 300 && /html/i.test(page.contentType)) direct = extractArticle(page.body);
  } catch (error) {
    // Unsafe or malformed links stop here; network trouble falls through to the reader.
    if (error instanceof Error && /private address|not supported|valid http/.test(error.message)) throw error;
    console.warn('Direct article fetch failed', { message: error instanceof Error ? error.message : String(error) });
  }
  if (direct) return { ...direct, ...capped(direct.text), via: 'direct' };

  if (readerFallbackEnabled()) {
    const viaReader = await readThroughService(url).catch(() => null);
    if (viaReader) return { ...viaReader, ...capped(viaReader.text), via: 'reader' };
  }
  throw new Error(
    'Could not read this page. It may be behind a paywall or login, block automated access, or not be an article.',
  );
}
