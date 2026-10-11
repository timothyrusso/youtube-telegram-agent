// Joins MP3 chunks (one per text-to-speech call) into a single file with a correct length.
// Plain concatenation plays, but each chunk starts with its own ID3 tag and Xing/Info frame, and
// players trust the first one: the joined file would report only the first chunk's duration and
// seek wrongly. So every chunk is reduced to its bare audio frames, and one fresh Xing frame
// describing the whole file goes in front. Dependency-free so tests can import it directly.

const BITRATES_KBPS = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

export interface FrameHeader {
  /** Raw version bits: 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5. */
  version: number;
  bitrateIndex: number;
  sampleRate: number;
  mono: boolean;
  /** Frame length in bytes, header included. */
  length: number;
  samplesPerFrame: number;
  /** Bytes of Layer III side information after the 4-byte header (and CRC, if any). */
  sideInfoOffset: number;
}

/** Parses a Layer III frame header at `offset`; null when the bytes there are not one. */
export function parseFrameHeader(bytes: Uint8Array, offset: number): FrameHeader | null {
  if (offset + 4 > bytes.length) return null;
  const [b0, b1, b2, b3] = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  const bitrateIndex = b2 >> 4;
  const sampleRateIndex = (b2 >> 2) & 3;
  if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }
  const mpeg1 = version === 3;
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const bitrate = (mpeg1 ? BITRATES_KBPS.mpeg1 : BITRATES_KBPS.mpeg2)[bitrateIndex] * 1000;
  const padding = (b2 >> 1) & 1;
  const mono = (b3 >> 6) === 3;
  const hasCrc = (b1 & 1) === 0;
  const length = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  const sideInfo = mpeg1 ? (mono ? 17 : 32) : mono ? 9 : 17;
  return {
    version,
    bitrateIndex,
    sampleRate,
    mono,
    length,
    samplesPerFrame: mpeg1 ? 1152 : 576,
    sideInfoOffset: 4 + (hasCrc ? 2 : 0) + sideInfo,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** True for the Xing/Info or VBRI metadata frame encoders put first; it holds no audio. */
function isMetadataFrame(bytes: Uint8Array, offset: number, header: FrameHeader): boolean {
  const tag = ascii(bytes, offset + header.sideInfoOffset, 4);
  return tag === 'Xing' || tag === 'Info' || ascii(bytes, offset + 36, 4) === 'VBRI';
}

/** The audio region of one MP3 file: after any ID3v2 tag, before any ID3v1 tag. */
function audioRegion(bytes: Uint8Array): [number, number] {
  let start = 0;
  if (bytes.length >= 10 && ascii(bytes, 0, 3) === 'ID3') {
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const hasFooter = (bytes[5] & 0x10) !== 0;
    start = 10 + size + (hasFooter ? 10 : 0);
  }
  let end = bytes.length;
  if (end - start >= 128 && ascii(bytes, end - 128, 3) === 'TAG') end -= 128;
  return [start, end];
}

interface AudioFrames {
  frames: Uint8Array[];
  first: FrameHeader;
}

/** Every audio frame of one MP3 file, skipping tags, metadata frames and stray bytes. */
export function audioFrames(bytes: Uint8Array): AudioFrames {
  const [start, end] = audioRegion(bytes);
  const frames: Uint8Array[] = [];
  let first: FrameHeader | null = null;
  let offset = start;
  while (offset < end) {
    const header = parseFrameHeader(bytes, offset);
    if (!header || offset + header.length > end) {
      offset += 1; // Not a frame here (junk or a truncated tail): resynchronise.
      continue;
    }
    if (first && (header.version !== first.version || header.sampleRate !== first.sampleRate)) {
      throw new Error('MP3 chunk changes sample rate mid-stream.');
    }
    if (!(frames.length === 0 && isMetadataFrame(bytes, offset, header))) {
      first ??= header;
      frames.push(bytes.subarray(offset, offset + header.length));
    }
    offset += header.length;
  }
  if (!first) throw new Error('MP3 chunk contains no audio frames.');
  return { frames, first };
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset).setUint32(offset, value);
}

/** A Xing (or, for constant bitrate, Info) frame recording the joined file's frame and byte count. */
function xingFrame(template: Uint8Array, header: FrameHeader, frameCount: number, audioBytes: number, cbr: boolean) {
  const frame = new Uint8Array(header.length);
  frame.set(template.subarray(0, 4));
  frame[1] |= 1; // No CRC, so the Xing tag sits right after the side information.
  frame[2] &= ~0x02; // No padding byte: the length below is the unpadded one.
  const unpadded = parseFrameHeader(frame, 0);
  if (!unpadded) throw new Error('Could not build the MP3 length header.');
  const sized = unpadded.length === frame.length ? frame : frame.subarray(0, unpadded.length);
  const at = unpadded.sideInfoOffset;
  if (at + 16 > sized.length) throw new Error('MP3 frames are too small for a length header.');
  sized.set([...(cbr ? 'Info' : 'Xing')].map((char) => char.charCodeAt(0)), at);
  writeUint32(sized, at + 4, 0x3); // Flags: frame count and byte count present.
  writeUint32(sized, at + 8, frameCount);
  writeUint32(sized, at + 12, audioBytes + sized.length);
  return sized;
}

export interface JoinedMp3 {
  bytes: Uint8Array<ArrayBuffer>;
  durationSeconds: number;
  frameCount: number;
}

/** Joins MP3 chunks recorded with the same settings into one file with a correct Xing header. */
export function joinMp3(chunks: readonly Uint8Array[]): JoinedMp3 {
  if (chunks.length === 0) throw new Error('No MP3 chunks to join.');
  const parsed = chunks.map(audioFrames);
  const { first } = parsed[0];
  if (parsed.some((chunk) => chunk.first.version !== first.version || chunk.first.sampleRate !== first.sampleRate)) {
    throw new Error('MP3 chunks were recorded with different sample rates.');
  }
  const frames = parsed.flatMap((chunk) => chunk.frames);
  const audioBytes = frames.reduce((total, frame) => total + frame.length, 0);
  const cbr = frames.every((frame) => frame[2] >> 4 === first.bitrateIndex);
  const header = xingFrame(frames[0], first, frames.length, audioBytes, cbr);

  const bytes = new Uint8Array(header.length + audioBytes);
  bytes.set(header);
  let offset = header.length;
  for (const frame of frames) {
    bytes.set(frame, offset);
    offset += frame.length;
  }
  return {
    bytes,
    durationSeconds: (frames.length * first.samplesPerFrame) / first.sampleRate,
    frameCount: frames.length,
  };
}
