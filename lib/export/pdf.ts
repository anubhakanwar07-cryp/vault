import 'server-only';
import { launchBrowser } from '@/lib/browser';
import type { ResumeDoc } from '@/lib/resume/types';
import { RESUME_CSS, resumeBodyHtml } from './template';

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Full standalone HTML for the resume — the same template as the preview (SPEC §11). */
export function resumeHtml(doc: ResumeDoc): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.header.name)}</title>
<style>@page { size: Letter; margin: 0 } html, body { margin: 0; background: #fff }
${RESUME_CSS}</style></head><body>${resumeBodyHtml(doc)}</body></html>`;
}

/** Real, selectable-text PDF via headless Chrome. */
export async function renderPdf(doc: ResumeDoc): Promise<Uint8Array> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // The document is fully self-contained: block all network access.
    await page.setRequestInterception(true);
    page.on(
      'request',
      (req) => void (req.url().startsWith('data:') ? req.continue() : req.abort()),
    );
    await page.setContent(resumeHtml(doc), { waitUntil: 'load' });
    return await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
