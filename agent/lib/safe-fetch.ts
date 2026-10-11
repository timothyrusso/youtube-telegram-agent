// Fetches a user-supplied web page without letting the URL reach private networks (SSRF):
// only http(s) on standard ports, no credentials, and every redirect hop is resolved and
// checked before it is requested. Residual risk: fetch resolves DNS again, so a hostile DNS
// server could still swap addresses between the check and the request (DNS rebinding).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const maxRedirects = 5;
const maxBytes = 3 * 1024 * 1024;
const timeoutMs = 15_000;

function ipv4Private(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast/reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** True for loopback, private, link-local, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return ipv4Private(address);
  if (version !== 6) return true;
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return ipv4Private(mapped[1]);
  return (
    lower === '::' || lower === '::1' ||
    /^f[cd]/.test(lower) || // unique local fc00::/7
    /^fe[89ab]/.test(lower) || // link-local fe80::/10
    /^ff/.test(lower) || // multicast
    lower.startsWith('64:ff9b:') // NAT64 can reach IPv4 private ranges
  );
}

/** Parses a user-supplied link, accepting only public-looking http(s) URLs. */
export function parsePublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Send a valid http or https link.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https links are supported.');
  if (url.username || url.password) throw new Error('Links with embedded credentials are not supported.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Links on non-standard ports are not supported.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || /\.(localhost|local|internal|home|lan)$/.test(host) || (!host.includes('.') && !isIP(host))) {
    throw new Error('That link points to a private address.');
  }
  return url;
}

/** Resolves the URL's host and refuses it when any address is private. */
export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error('That link points to a private address.');
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      break; // Keep what fits: the article body is usually near the top.
    }
    parts.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(parts));
}

/** GETs a public page, following at most five redirects and checking every hop. */
export async function fetchPublicPage(input: string): Promise<FetchedPage> {
  let url = parsePublicUrl(input);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; ; hop++) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: {
        // A browser-like agent: many blogs refuse obvious bots.
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'en,it;q=0.8',
      },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= maxRedirects) throw new Error('The link redirects too many times.');
      url = parsePublicUrl(new URL(location, url).toString());
      continue;
    }
    return {
      url: url.toString(),
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await readCapped(response),
    };
  }
}
