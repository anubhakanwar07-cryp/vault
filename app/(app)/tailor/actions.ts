'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { createJob, getJob, saveJobParse, setJobParse } from '@/lib/db/queries/jobs';
import { FetchPageError, fetchJD } from '@/lib/import/fetch-jd';
import { parsedJD } from '@/lib/llm/schemas/jd';
import { MAX_JD_TEXT, parseJD } from '@/lib/pipeline/parse-jd';

const MIN_JD = 200;

export type CreateJobResult = { jobId: string };

export async function createJobAction(
  formData: FormData,
): Promise<ActionResult<CreateJobResult> & { fallbackToPaste?: boolean }> {
  const user = await requireUser();
  const mode = z.enum(['paste', 'url']).parse(formData.get('mode'));

  let jdText = '';
  let sourceUrl: string | null = null;
  if (mode === 'url') {
    const url = String(formData.get('url') ?? '').trim();
    if (!url) return { ok: false, error: 'Paste the job link.' };
    try {
      const page = await fetchJD(url);
      jdText = page.text;
      sourceUrl = page.url;
    } catch (err) {
      if (err instanceof FetchPageError)
        return { ok: false, error: err.userMessage, fallbackToPaste: true };
      console.error('[tailor] JD fetch failed', err);
      return {
        ok: false,
        error: 'We couldn’t read that page. Paste the job description instead.',
        fallbackToPaste: true,
      };
    }
  } else {
    jdText = String(formData.get('text') ?? '').trim();
    sourceUrl = String(formData.get('sourceUrl') ?? '').trim() || null;
    if (jdText.length < MIN_JD)
      return { ok: false, error: 'That looks too short to be a full job description.' };
  }

  jdText = jdText.slice(0, MAX_JD_TEXT);
  const jobId = await createJob(user.id, { jdText, sourceUrl });
  try {
    const parsed = await parseJD(user.id, jdText);
    await setJobParse(user.id, jobId, parsed);
  } catch (err) {
    console.error('[tailor] parseJD failed', err);
    return {
      ok: false,
      error: 'We couldn’t read the requirements from that job description. Please try again.',
    };
  }
  revalidatePath('/tailor/new');
  return { ok: true, data: { jobId } };
}

export async function saveJobParseAction(
  jobId: string,
  raw: unknown,
  confirm: boolean,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const id = z.uuid().parse(jobId);
  const parsed = parsedJD.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  if (!(await getJob(user.id, id))) return { ok: false, error: 'Job not found.' };
  await saveJobParse(user.id, id, parsed.data, confirm);
  revalidatePath(`/tailor/${id}/confirm`);
  return { ok: true, data: id };
}
