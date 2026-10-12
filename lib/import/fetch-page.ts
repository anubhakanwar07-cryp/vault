import 'server-only';
import { lookup } from 'node:dns/promises';
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

async function fetchHtml(
  start: string,
  opts: FetchOptions,
): Promise<{ url: string; html: string }> {
  let current = (await assertPublicUrl(start, opts)).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    }).catch((err: unknown) => {
      throw new FetchPageError(`fetch ${current}: ${String(err)}`, 'That site didn’t respond.');
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = (
        await assertPublicUrl(new URL(res.headers.get('location')!, current).toString(), opts)
      ).toString();
      continue;
    }
    if (!res.ok) {
      throw new FetchPageError(
        `status ${res.status} ${current}`,
        `That site refused the request (HTTP ${res.status}).`,
      );
    }
    const type = res.headers.get('content-type') ?? '';
    if (!/html|xml|text\/plain/i.test(type)) {
      throw new FetchPageError(`type ${type}`, 'That link isn’t a web page.');
    }
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new FetchPageError('too large', 'That page is too large to read.');
    const html = await res.text();
    return { url: current, html: html.slice(0, MAX_BYTES) };
  }
  throw new FetchPageError('too many redirects', 'That link redirects too many times.');
}

/** Chrome executable for local rendering. Vercel uses @sparticuz/chromium (added with PDF export). */
function chromePath(): string | undefined {
  return (
    process.env.CHROME_PATH ??
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'linux'
        ? '/usr/bin/google-chrome'
        : undefined)
  );
}

/** Renders a JavaScript-built page in headless Chrome and returns its final HTML. */
async function renderHtml(url: string): Promise<string> {
  const executablePath = chromePath();
  if (!executablePath) throw new FetchPageError('no chrome', 'This site needs a browser to read.');
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    // Block requests to private networks from inside the rendered page too.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const host = new URL(req.url()).hostname;
      if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(host)) void req.abort();
      else void req.continue();
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
      finalHtml = await renderHtml(url);
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
