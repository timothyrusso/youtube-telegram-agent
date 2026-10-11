import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioFrames, joinMp3, parseFrameHeader } from '../agent/lib/mp3.ts';

// MPEG-2 Layer III, 64 kbps, 24 kHz, mono, no CRC: 192-byte frames of 576 samples.
const HEADER = [0xff, 0xf3, 0x84, 0xc0];
const FRAME_LENGTH = 192;

function frame(fill: number): Uint8Array {
  const bytes = new Uint8Array(FRAME_LENGTH).fill(fill);
  bytes.set(HEADER);
  return bytes;
}

function infoFrame(): Uint8Array {
  const bytes = frame(0);
  bytes.set([...'Info'].map((c) => c.charCodeAt(0)), 4 + 9);
  return bytes;
}

function id3Tag(): Uint8Array {
  // 10-byte header declaring a 20-byte body.
  return new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(7)]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function chunk(frames: number, fill: number): Uint8Array {
  return concat(id3Tag(), infoFrame(), ...Array.from({ length: frames }, () => frame(fill)));
}

test('parses a Layer III frame header', () => {
  const header = parseFrameHeader(frame(1), 0);
  assert.equal(header?.length, FRAME_LENGTH);
  assert.equal(header?.sampleRate, 24_000);
  assert.equal(header?.samplesPerFrame, 576);
  assert.equal(header?.sideInfoOffset, 13);
});

test('rejects bytes that are not a frame header', () => {
  assert.equal(parseFrameHeader(new Uint8Array([0x49, 0x44, 0x33, 0]), 0), null);
});

test('skips the ID3 tag and the Info frame, keeping only audio frames', () => {
  const { frames } = audioFrames(chunk(4, 1));
  assert.equal(frames.length, 4);
  assert.ok(frames.every((f) => f[4] === 1));
});

test('resynchronises past stray bytes', () => {
  const { frames } = audioFrames(concat(frame(1), new Uint8Array([1, 2, 3]), frame(2)));
  assert.equal(frames.length, 2);
});

test('joins chunks in order behind one header covering the whole file', () => {
  const joined = joinMp3([chunk(10, 1), chunk(5, 2)]);
  assert.equal(joined.frameCount, 15);
  assert.equal(joined.durationSeconds, (15 * 576) / 24_000);

  const view = new DataView(joined.bytes.buffer);
  const tag = String.fromCharCode(...joined.bytes.subarray(13, 17));
  assert.equal(tag, 'Info'); // Every frame has the same bitrate.
  assert.equal(view.getUint32(17), 3);
  assert.equal(view.getUint32(21), 15);
  assert.equal(view.getUint32(25), joined.bytes.length);
  assert.equal(joined.bytes.length, 16 * FRAME_LENGTH);

  // The first chunk's frames come before the second chunk's.
  assert.equal(joined.bytes[FRAME_LENGTH + 4], 1);
  assert.equal(joined.bytes[11 * FRAME_LENGTH + 4], 2);
});

test('fails on a chunk without audio', () => {
  assert.throws(() => joinMp3([id3Tag()]), /no audio frames/);
});
