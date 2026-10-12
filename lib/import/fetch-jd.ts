import 'server-only';
import { FetchPageError, fetchPageText, type FetchOptions } from './fetch-page';

const MIN_JD_TEXT = 400;

/** JD by URL (SPEC §7.2): main text of one page, or a FetchPageError telling the user to paste. */
export async function fetchJD(
  url: string,
  opts: FetchOptions = {},
): Promise<{ url: string; title: string; text: string }> {
  const page = await fetchPageText(url, opts);
  if (page.text.length < MIN_JD_TEXT) {
    throw new FetchPageError(
      `jd too short (${page.text.length}) at ${page.url}`,
      'We couldn’t find the job description on that page (some job sites block automated reading). Paste the text instead.',
    );
  }
  return { url: page.url, title: page.title, text: page.text };
}

export { FetchPageError };
