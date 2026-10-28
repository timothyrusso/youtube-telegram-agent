import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { noteFileName, noteMarkdown, romeDate, saveVaultNote } from '../agent/lib/vault-note.ts';

const note = {
  title: 'Design WhatsApp: guida (integrale)',
  sourceUrl: 'https://example.com/a',
  script: 'Primo paragrafo.\n\n\n\nSecondo paragrafo.',
  duration: '32:22',
  postUrl: 'https://t.me/c/3927967772/43',
};
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GITHUB_NOTES_TOKEN;
});

test('dates notes in the Rome time zone', () => {
  assert.equal(romeDate(new Date('2026-10-27T23:30:00Z')), '2026-10-28');
});

test('builds a file name Obsidian accepts', () => {
  assert.equal(noteFileName(note.title, '2026-10-28'), '2026-10-28 Design WhatsApp guida (integrale).md');
  assert.equal(noteFileName('#[]', '2026-10-28', 43), '2026-10-28 Audio (43).md');
});

test('writes the vault frontmatter, then the script', () => {
  assert.equal(
    noteMarkdown(note, '2026-10-28'),
    '---\ntype: reference\narea: learning\nstatus: active\nupdated: 2026-10-28\ntags: [audio]\n' +
      'source: "https://example.com/a"\nduration: "32:22"\naudio: "https://t.me/c/3927967772/43"\n---\n\n' +
      '# Design WhatsApp: guida (integrale)\n\nPrimo paragrafo.\n\nSecondo paragrafo.\n',
  );
});

test('skips the save when no token is configured', async () => {
  globalThis.fetch = () => assert.fail('no request expected');
  assert.equal(await saveVaultNote(note), null);
});

test('creates a new note on main', async () => {
  process.env.GITHUB_NOTES_TOKEN = 'test-token';
  const calls: { url: string; method: string; body?: { branch: string; content: string } }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response('{}', { status: init.method === 'PUT' ? 201 : 404 });
  }) as typeof fetch;
  const path = await saveVaultNote(note, new Date('2026-10-28T10:00:00Z'));
  assert.equal(path, '04 Learning/Audio/2026-10-28 Design WhatsApp guida (integrale).md');
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /\/repos\/timothyrusso\/test\/contents\/04%20Learning\/Audio\/2026-10-28%20Design/);
  assert.equal(calls[1].body?.branch, 'main');
  assert.match(Buffer.from(calls[1].body!.content, 'base64').toString(), /Secondo paragrafo/);
});

test('treats a note already holding this audio as saved, and renames on a clash', async () => {
  process.env.GITHUB_NOTES_TOKEN = 'test-token';
  const existing = (text: string) => new Response(JSON.stringify({ content: Buffer.from(text).toString('base64') }));
  globalThis.fetch = (async () => existing(`audio: "${note.postUrl}"`)) as typeof fetch;
  assert.equal(await saveVaultNote(note), `04 Learning/Audio/${noteFileName(note.title, romeDate())}`);

  const methods: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
    methods.push(init.method ?? 'GET');
    return init.method === 'PUT' ? new Response('{}', { status: 201 }) : existing('another note');
  }) as typeof fetch;
  assert.match((await saveVaultNote(note))!, / \(43\)\.md$/);
  assert.deepEqual(methods, ['GET', 'PUT']);
});
