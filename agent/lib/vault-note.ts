// Keeps the Italian script of each audio as a note in the owner's Obsidian vault on GitHub, so it can
// be searched and linked later. The repository and folder are fixed server-side; the token only has
// Contents access to that one repository. Each audio adds a new file and never touches others, so
// writing straight to main does not clash with Obsidian mobile sync.
import { kebabSlug } from './channel-audio.js';

export interface VaultNote {
  title: string;
  sourceUrl?: string;
  script: string;
  duration: string;
  postUrl: string | null;
}

/** The note's date in the owner's time zone, as YYYY-MM-DD. */
export function romeDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(date);
}

/** The vault names notes in lowercase kebab-case, such as `2026-10-28-design-whatsapp.md`. */
export function noteFileName(title: string, day: string, suffix?: string | number): string {
  return `${day}-${kebabSlug(title) || 'audio'}${suffix === undefined ? '' : `-${suffix}`}.md`;
}

/** The note in the vault's convention: frontmatter the Bases plugin can query, then the script. */
export function noteMarkdown(note: VaultNote, day: string): string {
  const frontmatter = [
    'type: reference',
    'area: learning',
    'status: active',
    `updated: ${day}`,
    'tags: [audio]',
    ...(note.sourceUrl ? [`source: ${JSON.stringify(note.sourceUrl)}`] : []),
    `duration: ${JSON.stringify(note.duration)}`,
    ...(note.postUrl ? [`audio: ${JSON.stringify(note.postUrl)}`] : []),
  ];
  const body = note.script.trim().replace(/\n{3,}/g, '\n\n');
  return `---\n${frontmatter.join('\n')}\n---\n\n# ${note.title}\n\n${body}\n`;
}

function contentsUrl(repo: string, path: string): string {
  return `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function github(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
}

/**
 * Commits the note to the vault and returns its path, or null when no token is configured.
 * Safe to retry: a file that already holds this audio's link counts as saved; a different note
 * with the same name gets the post id appended instead of being overwritten.
 */
export async function saveVaultNote(note: VaultNote, now = new Date()): Promise<string | null> {
  const token = process.env.GITHUB_NOTES_TOKEN?.trim();
  if (!token) return null;
  const repo = process.env.GITHUB_NOTES_REPO?.trim() || 'timothyrusso/test';
  const folder = process.env.GITHUB_NOTES_FOLDER?.trim() || '04-learning/audio';
  const day = romeDate(now);
  const content = noteMarkdown(note, day);

  let path = `${folder}/${noteFileName(note.title, day)}`;
  const existing = await github(`${contentsUrl(repo, path)}?ref=main`, token);
  if (existing.ok) {
    const file = (await existing.json()) as { content?: string };
    const text = Buffer.from(file.content ?? '', 'base64').toString('utf8');
    if (note.postUrl && text.includes(note.postUrl)) return path;
    path = `${folder}/${noteFileName(note.title, day, note.postUrl?.split('/').pop() ?? now.getTime())}`;
  } else if (existing.status !== 404) {
    throw new Error(`Reading the vault failed with status ${existing.status}.`);
  }

  const response = await github(contentsUrl(repo, path), token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Add audio note: ${note.title}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: 'main',
    }),
  });
  // 422 means the file appeared meanwhile, which only a retry of this same save does.
  if (!response.ok && response.status !== 422) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(`Saving the note to the vault failed with status ${response.status}: ${body?.message ?? 'no message'}`);
  }
  return path;
}
