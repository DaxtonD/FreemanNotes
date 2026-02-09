import dns from 'dns/promises';
import net from 'net';
import sharp from 'sharp';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  domain: string;
};

function normalizeUrlInput(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // If user omitted scheme, assume https.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) {
    // Avoid treating something like "javascript:..." as missing scheme.
    if (s.startsWith('//')) return `https:${s}`;
    return `https://${s}`;
  }
  return s;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (net.isIP(v4) === 4) return isPrivateIpv4(v4);
  }
  return false;
}

async function assertUrlIsSafe(u: URL): Promise<void> {
  const proto = u.protocol.toLowerCase();
  if (proto !== 'http:' && proto !== 'https:') throw new Error('Only http/https URLs are allowed');

  const hostname = (u.hostname || '').toLowerCase();
  if (!hostname) throw new Error('Invalid URL hostname');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Localhost URLs are not allowed');
  }

  // Block obvious private literal IPs.
  const ipType = net.isIP(hostname);
  if (ipType === 4 && isPrivateIpv4(hostname)) throw new Error('Private IP URLs are not allowed');
  if (ipType === 6 && isPrivateIpv6(hostname)) throw new Error('Private IP URLs are not allowed');

  // Resolve DNS and block private ranges.
  // If resolution fails, disallow (safer default).
  const addrs = await dns.lookup(hostname, { all: true });
  if (!addrs || addrs.length === 0) throw new Error('URL hostname could not be resolved');
  for (const a of addrs) {
    if (a.family === 4 && isPrivateIpv4(a.address)) throw new Error('URL resolves to a private IPv4 address');
    if (a.family === 6 && isPrivateIpv6(a.address)) throw new Error('URL resolves to a private IPv6 address');
  }
}

async function readResponseTextLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = (res.body as any)?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) return buf.subarray(0, maxBytes).toString('utf8');
    return buf.toString('utf8');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    total += chunk.length;
    if (total > maxBytes) break;
  }
  const joined = Buffer.concat(chunks, Math.min(total, maxBytes));
  return joined.toString('utf8');
}

function stripTagsToText(html: string): string {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(s: string): string {
  // Minimal entity decode for common cases.
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function pickMeta(meta: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function resolveUrlMaybe(base: string, href: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function parseHtmlMetadata(html: string): {
  titleTag: string | null;
  meta: Record<string, string>;
  links: Record<string, string>;
} {
  const meta: Record<string, string> = {};
  const links: Record<string, string> = {};

  // Title
  let titleTag: string | null = null;
  try {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m && m[1]) titleTag = decodeHtmlEntities(String(m[1]).replace(/\s+/g, ' ').trim());
  } catch {}

  // Meta tags
  const metaRe = /<meta\b[^>]*>/gi;
  const attrRe = /\b([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  const metas = html.match(metaRe) || [];
  for (const tag of metas) {
    const attrs: Record<string, string> = {};
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(tag))) {
      const key = String(m[1] || '').toLowerCase();
      const val = (m[3] ?? m[4] ?? m[5] ?? '').toString();
      attrs[key] = val;
    }
    const content = (attrs['content'] || '').trim();
    if (!content) continue;
    const name = (attrs['property'] || attrs['name'] || attrs['itemprop'] || '').toLowerCase().trim();
    if (!name) continue;
    // Keep first seen (typically most relevant); don't overwrite.
    if (!(name in meta)) meta[name] = decodeHtmlEntities(content);
  }

  // Link tags (image_src, icons)
  const linkRe = /<link\b[^>]*>/gi;
  const linksFound = html.match(linkRe) || [];
  for (const tag of linksFound) {
    const attrs: Record<string, string> = {};
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(tag))) {
      const key = String(m[1] || '').toLowerCase();
      const val = (m[3] ?? m[4] ?? m[5] ?? '').toString();
      attrs[key] = val;
    }
    const rel = (attrs['rel'] || '').toLowerCase().trim();
    const href = (attrs['href'] || '').trim();
    if (!rel || !href) continue;
    if (!(rel in links)) links[rel] = href;
  }

  return { titleTag, meta, links };
}

async function fetchImageScore(imageUrl: string): Promise<{ ok: boolean; area: number; bytes: number } | null> {
  try {
    const res = await fetch(imageUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'FreemanNotes-LinkPreview/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const ct = String(res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null;

    const maxBytes = 4 * 1024 * 1024;
    const reader = (res.body as any)?.getReader?.();
    let buf: Buffer;
    if (!reader) {
      const ab = await res.arrayBuffer();
      buf = Buffer.from(ab);
      if (buf.length > maxBytes) buf = buf.subarray(0, maxBytes);
    } else {
      const chunks: Buffer[] = [];
      let total = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        chunks.push(chunk);
        total += chunk.length;
        if (total >= maxBytes) break;
      }
      buf = Buffer.concat(chunks, Math.min(total, maxBytes));
    }

    const bytes = buf.length;
    // `sharp` can throw on truncated buffers; still try.
    try {
      const meta = await sharp(buf, { failOn: 'none' }).metadata();
      const w = typeof meta.width === 'number' ? meta.width : 0;
      const h = typeof meta.height === 'number' ? meta.height : 0;
      const area = (w > 0 && h > 0) ? (w * h) : 0;
      return { ok: true, area, bytes };
    } catch {
      return { ok: true, area: 0, bytes };
    }
  } catch {
    return null;
  }
}

export async function scrapeLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const normalized = normalizeUrlInput(rawUrl);
  if (!normalized) throw new Error('URL is required');

  const initialUrl = new URL(normalized);
  await assertUrlIsSafe(initialUrl);

  const res = await fetch(initialUrl.toString(), {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'FreemanNotes-LinkPreview/1.0',
      'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`);

  const finalUrl = String((res as any).url || initialUrl.toString());
  const finalU = new URL(finalUrl);
  await assertUrlIsSafe(finalU);

  const html = await readResponseTextLimited(res as any, 1_500_000);
  const { titleTag, meta, links } = parseHtmlMetadata(html);

  const title = pickMeta(meta, ['og:title', 'twitter:title']) || titleTag || null;
  const description = pickMeta(meta, ['og:description', 'twitter:description', 'description']) || null;

  const domain = (finalU.hostname || '').replace(/^www\./i, '');

  const candidatesRaw: string[] = [];
  const addCandidate = (v: string | undefined) => {
    if (!v) return;
    const t = String(v).trim();
    if (!t) return;
    candidatesRaw.push(t);
  };

  addCandidate(meta['og:image:secure_url']);
  addCandidate(meta['og:image']);
  addCandidate(meta['og:image:url']);
  addCandidate(meta['twitter:image']);
  addCandidate(meta['twitter:image:src']);
  addCandidate(meta['image']);
  addCandidate(links['image_src']);

  const candidates = Array.from(new Set(candidatesRaw))
    .map((c) => resolveUrlMaybe(finalU.toString(), c))
    .filter((x): x is string => !!x)
    .slice(0, 6);

  let bestImageUrl: string | null = null;
  let bestScore = -1;

  for (const imgUrl of candidates.slice(0, 4)) {
    const score = await fetchImageScore(imgUrl);
    if (!score || !score.ok) continue;
    const composite = (score.area > 0 ? score.area : 0) + Math.min(score.bytes, 2_000_000) / 1000;
    if (composite > bestScore) {
      bestScore = composite;
      bestImageUrl = imgUrl;
    }
  }

  // If we couldn't score anything, fall back to first candidate.
  if (!bestImageUrl && candidates.length) bestImageUrl = candidates[0];

  // Some pages don't expose a description; derive a small snippet.
  let desc = description;
  if (!desc) {
    try {
      const text = stripTagsToText(html);
      if (text.length > 0) desc = text.slice(0, 180);
    } catch {}
  }

  return {
    url: finalU.toString(),
    title: title ? String(title).slice(0, 300) : null,
    description: desc ? String(desc).slice(0, 500) : null,
    imageUrl: bestImageUrl ? String(bestImageUrl).slice(0, 2000) : null,
    domain: domain || finalU.hostname,
  };
}
