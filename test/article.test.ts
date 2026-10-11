import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractArticle, minArticleCharacters } from '../agent/lib/article.ts';
import { assertPublicHost, isPrivateAddress, parsePublicUrl } from '../agent/lib/safe-fetch.ts';

const paragraph = (n: number) =>
  `<p>Paragraph ${n} explains an important idea about building reliable software, with enough words to read like a real article body.</p>`;

const page = `<!doctype html><html lang="en"><head><title>How we ship | Example Blog</title>
<meta name="author" content="Ada Lovelace"></head><body>
<nav><a href="/">Home</a><a href="/about">About</a></nav>
<article><h1>How we ship</h1>${Array.from({ length: 12 }, (_, i) => paragraph(i)).join('')}</article>
<footer>Cookie settings · Subscribe to our newsletter</footer></body></html>`;

test('extracts the article body with paragraph breaks, without navigation', () => {
  const article = extractArticle(page);
  assert.ok(article);
  assert.match(article.title, /How we ship/);
  assert.equal(article.language, 'en');
  assert.match(article.text, /Paragraph 0 explains/);
  assert.match(article.text, /Paragraph 11 explains/);
  assert.match(article.text, /\n\nParagraph 1 /);
  assert.doesNotMatch(article.text, /Cookie settings/);
});

test('returns null for a page with no real article', () => {
  const stub = '<html><body><p>Please enable JavaScript.</p></body></html>';
  assert.equal(extractArticle(stub), null);
  assert.ok(minArticleCharacters > 'Please enable JavaScript.'.length);
});

test('flags private and special addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('accepts ordinary article links', () => {
  assert.equal(parsePublicUrl(' https://blog.example.com/post?id=1 ').hostname, 'blog.example.com');
});

test('rejects unsafe links before any request', () => {
  for (const url of ['ftp://example.com/file', 'http://localhost:3000', 'http://user:pw@example.com', 'https://example.com:8443/x', 'http://intranet/', 'http://printer.local/', 'not a url']) {
    assert.throws(() => parsePublicUrl(url), undefined, url);
  }
});

test('refuses literal private IPs and cloud metadata endpoints', async () => {
  await assert.rejects(assertPublicHost(new URL('http://169.254.169.254/latest/meta-data')), /private address/);
  await assert.rejects(assertPublicHost(new URL('http://[::1]/')), /private address/);
});

test('keeps <br> breaks and joins hard-wrapped source lines', () => {
  const body = Array.from({ length: 8 }, (_, i) => `Line ${i} of an essay written with\nhard wraps in the source, like old personal sites.`).join('<br><br>');
  const article = extractArticle(`<html><body><div id="essay"><font>July 2023<br><br>${body}</font></div></body></html>`);
  assert.ok(article);
  assert.match(article.text, /^July 2023\n\nLine 0 of an essay written with hard wraps/);
});
