import type { NextRequest } from 'next/server';
import { getJob } from '@/lib/db/queries/jobs';
import { getResume } from '@/lib/db/queries/resumes';
import { renderDocx } from '@/lib/export/docx';
import { exportFilename } from '@/lib/export/filename';
import { renderPdf } from '@/lib/export/pdf';
import { markFinal } from '@/lib/resume/editor';
import { uploadUserFile } from '@/lib/storage';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

/** GET /api/export/[resumeId]?format=pdf|docx — exporting freezes this version as final (SPEC §10). */
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

  const bytes =
    format === 'pdf' ? await renderPdf(resume.content) : await renderDocx(resume.content);
  const filename = exportFilename(
    resume.content.header.name,
    job?.company ?? null,
    job?.roleTitle ?? null,
    format,
  );

  await markFinal(user.id, resumeId);
  // Keep a private copy of exactly what was sent (best-effort).
  await uploadUserFile(user.id, 'exports', filename, new Uint8Array(bytes), TYPES[format]).catch(
    (err: unknown) => console.error('[export] storage copy failed', err),
  );

  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': TYPES[format],
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
