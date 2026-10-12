import { and, eq, gt } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { withUser } from '@/lib/db/client';
import { pipelineRuns } from '@/lib/db/schema';
import { PipelineError, runTailorPipeline } from '@/lib/pipeline/run';
import type { ProgressEvent } from '@/lib/pipeline/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SSE progress for the tailoring pipeline (SPEC §7). Events: { stage, status, message, resumeId? }. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/tailor/[jobId]/stream'>) {
  const { jobId } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(jobId)) return new Response('Not found', { status: 404 });

  // One run per job at a time (EventSource reconnects must not start a second pipeline).
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
  const active = await withUser(user.id, (tx) =>
    tx
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.jobId, jobId),
          eq(pipelineRuns.status, 'running'),
          gt(pipelineRuns.createdAt, twoMinutesAgo),
        ),
      ),
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ProgressEvent) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      if (active.length > 0) {
        send({
          stage: 'done',
          status: 'error',
          message: 'This job is already being tailored. Give it a minute and refresh.',
        });
        controller.close();
        return;
      }
      try {
        await runTailorPipeline({ userId: user.id, jobId, onEvent: send });
      } catch (err) {
        console.error('[tailor] pipeline failed', err);
        send({
          stage: 'done',
          status: 'error',
          message:
            err instanceof PipelineError
              ? err.userMessage
              : 'Something went wrong while tailoring. Please try again.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
