import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { OsaError } from '../../kernel/src/contracts.js';
function privateAddress(address: string) {
  if (isIP(address) !== 4) return true;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function validPublicUrl(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new OsaError('INVALID_URL', 'Nieprawidłowy adres strony.');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    isIP(u.hostname) ||
    !u.hostname.includes('.') ||
    /(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname)
  )
    throw new OsaError(
      'PRIVATE_URL',
      'Wymagany publiczny adres HTTPS bez danych logowania.',
    );
  return u;
}
export async function readPublicPage(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ text: string; title: string; url: string }> {
  if (redirects > 3)
    throw new OsaError('REDIRECT_LIMIT', 'Zbyt wiele przekierowań.');
  const url = validPublicUrl(value);
  const addresses = await lookup(url.hostname, { all: true });
  const ipv4 = addresses.filter((a) => a.family === 4);
  if (!ipv4.length || ipv4.some((a) => privateAddress(a.address)))
    throw new OsaError(
      'PRIVATE_URL',
      'Adres nie prowadzi do dozwolonej publicznej strony.',
    );
  const address = ipv4[0]!.address;
  const response = await new Promise<{
    status: number;
    location?: string;
    type: string;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        signal,
        timeout: 10000,
        headers: {
          'User-Agent': 'OSA-SourceReader/0.1',
          Accept: 'text/html,text/plain',
          'Accept-Encoding': 'identity',
        },
        lookup: (_hostname, _options, cb) => cb(null, address, 4),
      },
      (res) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1048576) {
            req.destroy(
              new OsaError('SOURCE_TOO_LARGE', 'Strona przekracza 1 MB.'),
            );
          } else chunks.push(chunk);
        });
        res.on('end', () =>
          resolve({
            status: res.statusCode || 500,
            location: res.headers.location,
            type: String(res.headers['content-type'] || ''),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () =>
      req.destroy(
        new OsaError(
          'SOURCE_TIMEOUT',
          'Odczyt strony przekroczył limit.',
          502,
          true,
        ),
      ),
    );
    req.on('error', reject);
    req.end();
  });
  if (response.status >= 300 && response.status < 400 && response.location)
    return readPublicPage(
      new URL(response.location, url).href,
      signal,
      redirects + 1,
    );
  if (response.status >= 400)
    throw new OsaError(
      'SOURCE_FAILED',
      `Strona zwróciła HTTP ${response.status}.`,
      502,
    );
  if (!/text\/(html|plain)/.test(response.type))
    throw new OsaError('SOURCE_TYPE', 'Obsługujemy strony HTML i tekstowe.');
  const title =
    response.body
      .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]*>/g, '')
      .trim() || url.hostname;
  const cleaned = response.body
    .replace(/<(script|style|nav)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20000);
  if (!cleaned) throw new OsaError('SOURCE_EMPTY', 'Brak treści do analizy.');
  return { text: cleaned, title, url: url.href };
}
