// PDF documents sent to the bot: the webhook turns the upload into a text note carrying the
// Telegram file id (so Eve never stages the file in a sandbox or re-sends its bytes to the model),
// and the read_pdf tool downloads it and extracts the text.
import { extractText, getDocumentProxy, getMeta } from 'unpdf';
import { capped } from './article.js';

// Bots can download files up to 20 MB with getFile.
export const maxPdfBytes = 20 * 1024 * 1024;
// Fewer characters than this usually means a scanned PDF with no text layer.
const minPdfCharacters = 200;

interface TelegramDocument {
  file_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

function isPdf(document: TelegramDocument): boolean {
  return document.mime_type === 'application/pdf' || /\.pdf$/i.test(document.file_name ?? '');
}

/**
 * When the update carries a PDF document, returns a copy whose message is plain text naming the
 * file and its id (any caption kept in front); otherwise null.
 */
export function pdfUpdateAsText(update: unknown): Record<string, unknown> | null {
  const u = update as { message?: Record<string, unknown> & { document?: TelegramDocument; caption?: string } } | null;
  const message = u?.message;
  const document = message?.document;
  if (!message || !document?.file_id || !isPdf(document)) return null;
  const { document: _document, caption, ...rest } = message;
  const name = (document.file_name ?? 'document.pdf').replace(/["\n\r]/g, ' ');
  const size = document.file_size ? `, ${Math.ceil(document.file_size / 1024)} KB` : '';
  const note = `[PDF document "${name}"${size}, file_id: ${document.file_id}]`;
  return { ...u, message: { ...rest, text: caption ? `${caption}\n\n${note}` : note } };
}

async function downloadTelegramFile(fileId: string): Promise<Uint8Array> {
  const base = process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org';
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const info = await fetch(`${base}/bot${token}/getFile?${new URLSearchParams({ file_id: fileId })}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await info.json().catch(() => null)) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
    description?: string;
  } | null;
  if (!body?.ok || !body.result?.file_path) {
    throw new Error(`Telegram could not provide the file: ${body?.description ?? `status ${info.status}`}. Files over 20 MB cannot be downloaded by bots.`);
  }
  if ((body.result.file_size ?? 0) > maxPdfBytes) throw new Error('The PDF is over the 20 MB limit for bots.');
  const file = await fetch(`${base}/file/bot${token}/${body.result.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!file.ok) throw new Error(`Downloading the PDF failed with status ${file.status}.`);
  return new Uint8Array(await file.arrayBuffer());
}

export interface PdfText {
  title: string | null;
  pages: number;
  text: string;
  truncated: boolean;
}

/** The text layer of a PDF, capped like articles; throws for scanned or empty PDFs. */
export async function extractPdf(bytes: Uint8Array): Promise<PdfText> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new Error('This file could not be opened as a PDF. It may be damaged or password-protected.');
  }
  const [{ totalPages, text }, meta] = await Promise.all([
    extractText(pdf, { mergePages: false }),
    getMeta(pdf).catch(() => null),
  ]);
  const joined = text
    .map((page) => page.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
    .filter(Boolean)
    .join('\n\n');
  if (joined.length < minPdfCharacters) {
    throw new Error('This PDF has no readable text; it is probably scanned images, which I cannot read yet.');
  }
  const rawTitle = (meta?.info as { Title?: unknown } | undefined)?.Title;
  const title = typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : null;
  return { title, pages: totalPages, ...capped(joined) };
}

export async function readTelegramPdf(fileId: string): Promise<PdfText> {
  return extractPdf(await downloadTelegramFile(fileId));
}
