import 'server-only';
import type { Browser } from 'puppeteer-core';

/** Local Chrome for dev; @sparticuz/chromium on serverless (Vercel/Lambda). */
export async function launchBrowser(): Promise<Browser> {
  const puppeteer = await import('puppeteer-core');
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      headless: true,
    });
  }
  const executablePath =
    process.env.CHROME_PATH ??
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome');
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
}
