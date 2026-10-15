import 'server-only';
import type { Browser, Page } from 'puppeteer-core';
import { launchBrowser } from '@/lib/browser';
import { estimateLines, LINES_PER_PAGE } from '@/lib/resume/doc-ops';
import type { ResumeDoc } from '@/lib/resume/types';
import { resumeHtml } from './pdf';

/** US Letter minus the 0.5 in top/bottom and 0.6 in side margins of the PDF, in CSS px. */
const CONTENT_WIDTH_PX = 7.3 * 96;
const CONTENT_HEIGHT_PX = 10 * 96;
/** Small allowance so sub-pixel rounding never spills a last line onto page 2. */
const SAFETY_PX = 4;

export type PageMeasurer = {
  fits: (doc: ResumeDoc) => Promise<boolean>;
  close: () => Promise<void>;
};

/**
 * Measures the rendered resume against one printed page using the same HTML as the PDF export.
 * Falls back to the line estimate if a browser can't be started.
 */
export async function openPageMeasurer(): Promise<PageMeasurer> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  try {
    browser = await launchBrowser();
    page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on(
      'request',
      (req) => void (req.url().startsWith('data:') ? req.continue() : req.abort()),
    );
    await page.emulateMediaType('print');
    await page.setViewport({ width: Math.round(CONTENT_WIDTH_PX), height: CONTENT_HEIGHT_PX });
  } catch (err) {
    console.error('[page-fit] no browser; using the line estimate', err);
    await browser?.close().catch(() => {});
    return {
      fits: async (doc) => estimateLines(doc) <= LINES_PER_PAGE,
      close: async () => {},
    };
  }
  const p = page;
  return {
    fits: async (doc) => {
      try {
        await p.setContent(resumeHtml(doc), { waitUntil: 'load' });
        const height = await p.evaluate(
          () => document.querySelector('.rt-page')?.getBoundingClientRect().height ?? 0,
        );
        return height <= CONTENT_HEIGHT_PX - SAFETY_PX;
      } catch (err) {
        console.error('[page-fit] measuring failed; using the line estimate', err);
        return estimateLines(doc) <= LINES_PER_PAGE;
      }
    },
    close: async () => {
      await browser!.close().catch(() => {});
    },
  };
}
