// Holds the MP3 parts of one audio between workflow steps. Each part is spoken in its own step,
// so the bytes cannot travel in memory; they wait in a private Vercel Blob store until the last
// step joins them, and are deleted right after.
import { del, get, put } from '@vercel/blob';

export function partPath(callId: string, index: number): string {
  return `audio-parts/${callId.replace(/[^\w-]/g, '_')}/${String(index).padStart(3, '0')}.mp3`;
}

export async function savePart(pathname: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  // A retried step writes the same path again, so overwriting is expected.
  await put(pathname, Buffer.from(bytes), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'audio/mpeg',
  });
}

export async function loadPart(pathname: string): Promise<Uint8Array<ArrayBuffer>> {
  const result = await get(pathname, { access: 'private', useCache: false });
  if (result?.statusCode !== 200) throw new Error(`Audio part ${pathname} is missing from storage.`);
  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

export async function deleteParts(pathnames: string[]): Promise<void> {
  if (pathnames.length) await del(pathnames);
}
