import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapWithConcurrency, splitScript } from '../agent/lib/speech.ts';

test('keeps a short script in one chunk', () => {
  assert.deepEqual(splitScript('Hello there. How are you?'), ['Hello there. How are you?']);
});

test('splits at sentence ends without exceeding the limit or losing text', () => {
  const script = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const chunks = splitScript(script, 120);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 120));
  assert.ok(chunks.every((c) => c.endsWith('.')));
  assert.equal(chunks.join(' '), script);
});

test('prefers paragraph breaks', () => {
  const chunks = splitScript('First paragraph here.\n\nSecond paragraph here.', 30);
  assert.deepEqual(chunks, ['First paragraph here.', 'Second paragraph here.']);
});

test('cuts an over-long sentence at spaces', () => {
  const sentence = `${'word '.repeat(100).trim()}.`;
  const chunks = splitScript(sentence, 50);
  assert.ok(chunks.every((c) => c.length <= 50));
  assert.equal(chunks.join(' '), sentence);
});

test('runs tasks with bounded concurrency and keeps input order', async () => {
  let inFlight = 0;
  let peak = 0;
  const results = await mapWithConcurrency([30, 10, 20, 5, 15], 2, async (ms, i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    return i;
  });
  assert.deepEqual(results, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
});
