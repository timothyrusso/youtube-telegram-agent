import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedSender } from '../agent/lib/allowlist.ts';
import { audioFileName, channelPostUrl } from '../agent/lib/channel-audio.ts';

test('builds a safe dated file name', () => {
  const date = new Date('2026-10-11T12:00:00Z');
  assert.equal(audioFileName('Perché React Native? Weekly #42', date), '2026-10-11-perche-react-native-weekly-42.mp3');
  assert.equal(audioFileName('🎧🎧', date), '2026-10-11-audio-summary.mp3');
});

test('links private channel posts and skips other id formats', () => {
  assert.equal(channelPostUrl('-1001234567890', 7), 'https://t.me/c/1234567890/7');
  assert.equal(channelPostUrl('@public_channel', 7), null);
});

test('allows everyone when no allowlist is set', () => {
  assert.equal(allowedSender({ message: { from: { id: 1 } } }, undefined), true);
});

test('allows only listed senders, for messages and button presses', () => {
  const list = '111, 222';
  assert.equal(allowedSender({ message: { from: { id: 222 } } }, list), true);
  assert.equal(allowedSender({ callback_query: { from: { id: 111 } } }, list), true);
  assert.equal(allowedSender({ message: { from: { id: 333 } } }, list), false);
  assert.equal(allowedSender({ edited_message: {} }, list), false);
  assert.equal(allowedSender(null, list), false);
});
