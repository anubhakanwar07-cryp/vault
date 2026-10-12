// Pure helpers for turning web pages into plain text. No network here — see fetch-page.ts.
import { isIP } from 'node:net';
import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

/** True for loopback, private, link-local, CGNAT, multicast and unspecified addresses (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
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
