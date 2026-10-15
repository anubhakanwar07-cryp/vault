// Pure helpers for turning web pages into plain text. No network here — see fetch-page.ts.
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Expands an IPv6 address to 8 groups of 16-bit numbers (handles "::" and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]!;
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const [a = 0, b = 0, c = 0, d = 0] = v4[1]!.split('.').map(Number);
    s =
      s.slice(0, -v4[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array<string>(Math.max(fill, 0)).fill('0'), ...t].map((g) =>
    parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

const v4From = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * True for loopback, private, link-local, CGNAT, documentation, benchmarking, multicast and
 * unspecified addresses, including IPv4 embedded in IPv6 (mapped, NAT64, 6to4). SSRF guard.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
    if (g.slice(0, 7).every((x) => x === 0) && (g7 === 0 || g7 === 1)) return true; // :: and ::1
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0))
      return isPrivateV4(v4From(g6, g7)); // ::ffff:a.b.c.d and ::a.b.c.d
    if (g0 === 0x64 && g1 === 0xff9b) return isPrivateV4(v4From(g6, g7)); // NAT64
    if (g0 === 0x2002) return isPrivateV4(v4From(g1, g2)); // 6to4
    if (g0 === 0x2001 && g1 === 0xdb8) return true; // documentation
    return (
      (g0 & 0xfe00) === 0xfc00 ||
      (g0 & 0xffc0) === 0xfe80 ||
      (g0 & 0xffc0) === 0xfec0 ||
      g0 >= 0xff00
    );
  }
  return true; // not an IP at all — refuse
}

export type PageText = { url: string; title: string; text: string };

const quietConsole = () => {
  const vc = new VirtualConsole();
  vc.on('error', () => {}); // jsdom CSS parse noise
  return vc;
};

/** Main readable text of an HTML document. Scripts never run (jsdom default). */
export function htmlToText(html: string, url: string): PageText {
  const dom = new JSDOM(html, { url, virtualConsole: quietConsole() });
  const doc = dom.window.document;
  const title = doc.title?.trim() ?? '';
  const article = new Readability(doc.cloneNode(true) as Document).parse();
  let text = article?.textContent ?? '';
  // Portfolios are often card grids that Readability drops; fall back to the whole body.
  if (text.trim().length < 200) {
    doc.querySelectorAll('script,style,noscript,svg,nav,footer').forEach((el) => el.remove());
    text = doc.body?.textContent ?? '';
  }
  return { url, title: article?.title?.trim() || title, text: tidy(text) };
}

export function tidy(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const PROJECTISH = /(project|work|case|portfolio|stud(y|ies)|product|build|ship|experience|about)/i;
const SKIP =
  /\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4|mov|css|js|ico)(\?|$)|\/(login|signin|signup|cart|tag|category|privacy|terms)(\/|$)/i;

/**
 * Same-site links worth following from a portfolio page: project/case-study pages first.
 * Returns absolute URLs without fragments, deduped, capped at `max`.
 */
export function pickProjectLinks(html: string, baseUrl: string, max = 10): string[] {
  const base = new URL(baseUrl);
  const dom = new JSDOM(html, { url: baseUrl, virtualConsole: quietConsole() });
  const seen = new Set<string>([normalise(base)]);
  const scored: { url: string; score: number }[] = [];

  for (const a of dom.window.document.querySelectorAll('a[href]')) {
    let u: URL;
    try {
      u = new URL(a.getAttribute('href') ?? '', base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.hostname !== base.hostname || SKIP.test(u.pathname))
      continue;
    u.hash = '';
    const key = normalise(u);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = `${u.pathname} ${a.textContent ?? ''}`;
    const depth = u.pathname.split('/').filter(Boolean).length;
    const score = (PROJECTISH.test(label) ? 2 : 0) + (depth >= 2 ? 1 : 0) - (depth === 0 ? 5 : 0);
    if (score >= 0) scored.push({ url: u.toString(), score });
  }
  return scored
    .sort((x, y) => y.score - x.score)
    .slice(0, max)
    .map((s) => s.url);
}

function normalise(u: URL): string {
  return `${u.hostname}${u.pathname.replace(/\/$/, '')}${u.search}`;
}
