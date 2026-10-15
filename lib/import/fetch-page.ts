import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { launchBrowser } from '@/lib/browser';
import { htmlToText, isPrivateAddress, pickProjectLinks, type PageText } from './page-text';

const TIMEOUT_MS = 12_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MIN_USEFUL_TEXT = 300;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

export class FetchPageError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
    this.name = 'FetchPageError';
  }
}

export type FetchOptions = { allowPrivate?: boolean; render?: boolean };

/** Rejects non-http(s) URLs and hosts that resolve to private networks (SSRF guard, SPEC §16). */
export async function assertPublicUrl(raw: string, opts: FetchOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim().match(/^https?:\/\//i) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new FetchPageError(`bad url ${raw}`, 'That doesn’t look like a valid link.');
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new FetchPageError(
      `bad protocol ${url.protocol}`,
      'Only http and https links are supported.',
    );
  }
  if (opts.allowPrivate) return url;
  const addrs = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addrs.length === 0)
    throw new FetchPageError(`dns ${url.hostname}`, 'We couldn’t find that website.');
  if (addrs.some((a) => isPrivateAddress(a.address))) {
    throw new FetchPageError(
      `private ${url.hostname}`,
      'That link points to a private network address.',
    );
  }
  return url;
}

/**
 * DNS lookup for outgoing sockets that refuses private addresses. Because the socket connects to the
 * address this returns, a host can't pass the check and then re-resolve somewhere internal.
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as unknown as LookupAddress[];
      const bad = !allowPrivate && list.some((a) => isPrivateAddress(a.address));
      if (bad || list.length === 0) {
        return callback(
          Object.assign(new Error(`private address for ${hostname}`), { code: 'EPRIVATE' }),
          '',
          0,
        );
      }
      if (options.all) return callback(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

function request(url: URL, allowPrivate: boolean): Promise<IncomingMessage> {
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.get(
      url,
      {
        lookup: guardedLookup(allowPrivate),
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Reads at most MAX_BYTES of the (decompressed) body, then stops the download. */
async function readCapped(res: IncomingMessage): Promise<string> {
  const enc = (res.headers['content-encoding'] ?? '').toLowerCase();
  let body: Readable = res;
  if (enc === 'gzip' || enc === 'x-gzip') body = res.pipe(zlib.createGunzip());
  else if (enc === 'deflate') body = res.pipe(zlib.createInflate());
  else if (enc === 'br') body = res.pipe(zlib.createBrotliDecompress());
  const chunks: Buffer[] = [];
  let size = 0;
  const deadline = setTimeout(() => res.destroy(new Error('timeout')), TIMEOUT_MS);
  try {
    for await (const chunk of body) {
      const buf = chunk as Buffer;
      chunks.push(buf);
      size += buf.length;
      if (size >= MAX_BYTES) break;
    }
  } finally {
    clearTimeout(deadline);
    res.destroy();
  }
  return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8');
}

async function fetchHtml(
  start: string,
  opts: FetchOptions,
): Promise<{ url: string; html: string }> {
  let current = await assertPublicUrl(start, opts);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await request(current, Boolean(opts.allowPrivate)).catch((err: unknown) => {
      if ((err as { code?: string }).code === 'EPRIVATE') {
        throw new FetchPageError(
          `private ${current.hostname}`,
          'That link points to a private network address.',
        );
      }
      throw new FetchPageError(`fetch ${current}: ${String(err)}`, 'That site didn’t respond.');
    });
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status >= 300 && status < 400 && location) {
      res.destroy();
      current = await assertPublicUrl(new URL(location, current).toString(), opts);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new FetchPageError(
        `status ${status} ${current}`,
        `That site refused the request (HTTP ${status}).`,
      );
    }
    const type = res.headers['content-type'] ?? '';
    if (!/html|xml|text\/plain/i.test(type)) {
      res.destroy();
      throw new FetchPageError(`type ${type}`, 'That link isn’t a web page.');
    }
    const len = Number(res.headers['content-length'] ?? 0);
    if (len > MAX_BYTES) {
      res.destroy();
      throw new FetchPageError('too large', 'That page is too large to read.');
    }
    return { url: current.toString(), html: await readCapped(res) };
  }
  throw new FetchPageError('too many redirects', 'That link redirects too many times.');
}

/** True if a request made by the rendered page may go out: http(s) to public hosts, or local data. */
async function allowedFromPage(
  raw: string,
  cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (!/^https?:$/.test(url.protocol)) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let ok = cache.get(host);
  if (!ok) {
    ok = lookup(host, { all: true })
      .then((addrs) => addrs.length > 0 && !addrs.some((a) => isPrivateAddress(a.address)))
      .catch(() => false);
    cache.set(host, ok);
  }
  return ok;
}

/** Renders a JavaScript-built page in headless Chrome and returns its final HTML. */
async function renderHtml(url: string, opts: FetchOptions): Promise<string> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    // Every request the page makes (scripts, XHR, redirects) gets the same DNS-based check.
    await page.setRequestInterception(true);
    const cache = new Map<string, Promise<boolean>>();
    page.on('request', (req) => {
      const check = opts.allowPrivate ? Promise.resolve(true) : allowedFromPage(req.url(), cache);
      void check.then((ok) => (ok ? req.continue() : req.abort('blockedbyclient')));
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

/** One page as plain text; falls back to headless rendering when static HTML has too little text. */
export async function fetchPageText(
  raw: string,
  opts: FetchOptions = {},
): Promise<PageText & { html: string }> {
  const { url, html } = await fetchHtml(raw, opts);
  let page = htmlToText(html, url);
  let finalHtml = html;
  if (page.text.length < MIN_USEFUL_TEXT && opts.render !== false) {
    try {
      finalHtml = await renderHtml(url, opts);
      const rendered = htmlToText(finalHtml, url);
      if (rendered.text.length > page.text.length) page = rendered;
    } catch (err) {
      console.warn('[fetch-page] render fallback failed', err);
    }
  }
  return { ...page, html: finalHtml };
}

export const MAX_PORTFOLIO_TEXT = 30_000;

/** A portfolio home page plus up to `maxPages` same-site project pages, concatenated. */
export async function fetchPortfolio(
  raw: string,
  opts: FetchOptions & { maxPages?: number } = {},
): Promise<{ url: string; title: string; text: string; pages: string[] }> {
  const home = await fetchPageText(raw, opts);
  const links = pickProjectLinks(home.html, home.url, opts.maxPages ?? 10);
  const parts = [`## Page: ${home.url}\n${home.text}`];
  const pages = [home.url];

  for (let i = 0; i < links.length; i += 4) {
    const batch = await Promise.allSettled(
      links.slice(i, i + 4).map((l) => fetchPageText(l, { ...opts, render: false })),
    );
    for (const r of batch) {
      if (r.status === 'fulfilled' && r.value.text.length > 100) {
        parts.push(`## Page: ${r.value.url}\n${r.value.text}`);
        pages.push(r.value.url);
      }
    }
    if (parts.join('\n\n').length > MAX_PORTFOLIO_TEXT) break;
  }

  const text = parts.join('\n\n').slice(0, MAX_PORTFOLIO_TEXT);
  if (text.length < MIN_USEFUL_TEXT) {
    throw new FetchPageError(
      `too little text from ${home.url}`,
      'We couldn’t read much from that site. Paste the text of your projects into “Write a brief” instead.',
    );
  }
  return { url: home.url, title: home.title, text, pages };
}
