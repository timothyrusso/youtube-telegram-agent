import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractPdf, pdfUpdateAsText } from '../agent/lib/pdf.ts';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('turns a PDF upload into a text note with its file id, keeping the caption', () => {
  const update = {
    update_id: 1,
    message: {
      message_id: 5,
      chat: { id: 9, type: 'private' },
      from: { id: 9 },
      caption: 'breve per favore',
      document: { file_id: 'ABC123', file_name: 'Report "Q3".pdf', mime_type: 'application/pdf', file_size: 204_800 },
    },
  };
  const rewritten = pdfUpdateAsText(update) as { update_id: number; message: Record<string, unknown> };
  assert.equal(rewritten.update_id, 1);
  assert.equal(rewritten.message.document, undefined);
  assert.equal(rewritten.message.caption, undefined);
  assert.equal(rewritten.message.text, 'breve per favore\n\n[PDF document "Report  Q3 .pdf", 200 KB, file_id: ABC123]');
  assert.deepEqual(rewritten.message.chat, { id: 9, type: 'private' });
});

test('recognises a PDF by file name when the MIME type is missing', () => {
  const rewritten = pdfUpdateAsText({ message: { document: { file_id: 'X', file_name: 'notes.PDF' } } });
  assert.ok(rewritten);
});

test('leaves other updates alone', () => {
  assert.equal(pdfUpdateAsText({ message: { text: 'https://youtu.be/abc' } }), null);
  assert.equal(pdfUpdateAsText({ message: { document: { file_id: 'X', file_name: 'a.docx', mime_type: 'application/msword' } } }), null);
  assert.equal(pdfUpdateAsText(null), null);
});

test('extracts the text layer of a PDF', async () => {
  const pdf = await extractPdf(fixture('text.pdf'));
  assert.equal(pdf.pages, 1);
  assert.equal(pdf.truncated, false);
  assert.match(pdf.text, /^Building Reliable Software/);
  assert.match(pdf.text, /Paragraph 5 explains/);
});

test('rejects a PDF without readable text', async () => {
  await assert.rejects(extractPdf(fixture('almost-empty.pdf')), /no readable text/);
});

test('rejects bytes that are not a PDF', async () => {
  await assert.rejects(extractPdf(new TextEncoder().encode('not a pdf')), /could not be opened/);
});
