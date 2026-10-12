import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { withUser } from '@/lib/db/client';
import { pipelineRuns, resumes } from '@/lib/db/schema';
import { PipelineError, runTailorPipeline } from '@/lib/pipeline/run';
import type { ProgressEvent, StageName } from '@/lib/pipeline/types';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const maxDuration = 120;

/** SPEC §14 Phase 7: max 30 tailor runs per user per day. */
export const DAILY_RUN_LIMIT = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_MESSAGES: Partial<Record<StageName, string>> = {
  retrieve: 'Matching your work…',
  score: 'Weighing your evidence…',
  select: 'Picking achievements…',
  rewrite: 'Writing bullets…',
  verify: 'Fact-checking…',
  assemble: 'Laying out your page…',
  recruiter_sim: 'Reading it like a recruiter…',
};

/**
 * SSE progress for the tailoring pipeline (SPEC §7). Events: { stage, status, message, resumeId? }.
 * If a run for this job is already in progress (a reload, or React dev double-mount), the stream
 * attaches to it and reports its result instead of starting a second run.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/tailor/[jobId]/stream'>) {
  const { jobId } = await ctx.params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!UUID.test(jobId)) return new Response('Not found', { status: 404 });

  const [active] = await withUser(user.id, (tx) =>
    tx
      .select({ id: pipelineRuns.id })
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.jobId, jobId),
          eq(pipelineRuns.status, 'running'),
          gt(pipelineRuns.createdAt, new Date(Date.now() - 2 * 60_000)),
        ),
      )
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(1),
  );
  const [{ n } = { n: 0 }] = await withUser(user.id, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pipelineRuns)
      .where(gt(pipelineRuns.createdAt, new Date(Date.now() - 24 * 3600_000))),
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      // The pipeline must finish even if the browser goes away, so sending never throws.
      const send = (e: ProgressEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          open = false;
        }
      };
      const close = () => {
        if (!open) return;
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      if (active) {
        await followExistingRun(user.id, active.id, send);
        return close();
      }
      if (n >= DAILY_RUN_LIMIT) {
        send({
          stage: 'done',
          status: 'error',
          message: `You’ve tailored ${DAILY_RUN_LIMIT} resumes in the last 24 hours — that’s the daily limit. Try again tomorrow.`,
        });
        return close();
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
        close();
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

/** Polls an in-progress run and relays its stage, then its result. */
async function followExistingRun(userId: string, runId: string, send: (e: ProgressEvent) => void) {
  let lastStage = '';
  for (let i = 0; i < 75; i++) {
    const [run] = await withUser(userId, (tx) =>
      tx
        .select({ status: pipelineRuns.status, stage: pipelineRuns.stage })
        .from(pipelineRuns)
        .where(eq(pipelineRuns.id, runId)),
    );
    if (!run) break;
    if (run.stage && run.stage !== lastStage && run.status === 'running') {
      lastStage = run.stage;
      send({
        stage: run.stage as StageName,
        status: 'start',
        message: STAGE_MESSAGES[run.stage as StageName] ?? 'Working…',
      });
    }
    if (run.status === 'done') {
      const [r] = await withUser(userId, (tx) =>
        tx.select({ id: resumes.id }).from(resumes).where(eq(resumes.pipelineRunId, runId)),
      );
      if (r) return send({ stage: 'done', status: 'done', message: 'Done', resumeId: r.id });
    }
    if (run.status === 'failed') {
      return send({
        stage: 'done',
        status: 'error',
        message: 'Something went wrong while tailoring. Please try again.',
      });
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
  send({
    stage: 'done',
    status: 'error',
    message: 'This is taking longer than expected. Refresh in a minute.',
  });
}
