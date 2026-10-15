import type { NextRequest } from 'next/server';
import { getJob } from '@/lib/db/queries/jobs';
import { getResume } from '@/lib/db/queries/resumes';
import { renderDocx } from '@/lib/export/docx';
import { contentDisposition, exportFilename, unicodeFilename } from '@/lib/export/filename';
import { renderPdf } from '@/lib/export/pdf';
import { uploadUserFile } from '@/lib/storage';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/**
 * GET /api/export/[resumeId]?format=pdf|docx. Read-only: the editor marks the version final (a
 * server action, so it can't be triggered cross-site) before it downloads (SPEC §10).
 */
export async function GET(req: NextRequest, ctx: RouteContext<'/api/export/[resumeId]'>) {
  const { resumeId } = await ctx.params;
  const format = req.nextUrl.searchParams.get('format') === 'docx' ? 'docx' : 'pdf';
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(resumeId)) return new Response('Not found', { status: 404 });

  const resume = await getResume(user.id, resumeId);
  if (!resume) return new Response('Not found', { status: 404 });
  const job = resume.jobId ? await getJob(user.id, resume.jobId) : null;

  let bytes: Uint8Array;
  try {
    bytes = format === 'pdf' ? await renderPdf(resume.content) : await renderDocx(resume.content);
  } catch (err) {
    console.error('[export] render failed', err);
    return new Response('Export failed. Please try again.', { status: 500 });
  }
  const args = [
    resume.content.header.name,
    job?.company ?? null,
    job?.roleTitle ?? null,
    format,
  ] as const;
  const filename = exportFilename(...args);

  // Keep a private copy of exactly what was sent (best-effort).
  await uploadUserFile(user.id, 'exports', filename, new Uint8Array(bytes), TYPES[format]).catch(
    (err: unknown) => console.error('[export] storage copy failed', err),
  );

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': TYPES[format],
      'content-disposition': contentDisposition(filename, unicodeFilename(...args)),
      'cache-control': 'no-store',
    },
  });
}
