// startRun: concurrent requests for one job claim exactly one run; the daily limit holds; stale
// "running" rows are closed. No LLM calls.
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { adminDb } from '@/lib/db/client';
import { jobs, pipelineRuns } from '@/lib/db/schema';
import { startRun, STALE_RUN_MS } from '@/lib/pipeline/run';
import { ensureTestUser } from './helpers';

let userId: string;
let jobId: string;

beforeAll(async () => {
  userId = await ensureTestUser('runs-test@example.com');
  await adminDb().delete(pipelineRuns).where(eq(pipelineRuns.userId, userId));
  const [job] = await adminDb()
    .insert(jobs)
    .values({ userId, jdText: 'Test JD', roleTitle: 'PM' })
    .returning({ id: jobs.id });
  jobId = job!.id;
});

afterAll(async () => {
  await adminDb().delete(pipelineRuns).where(eq(pipelineRuns.userId, userId));
  await adminDb().delete(jobs).where(eq(jobs.userId, userId));
});

it('lets only one of several concurrent requests start a run', async () => {
  const results = await Promise.all([1, 2, 3, 4].map(() => startRun(userId, jobId, 30)));
  expect(results.filter((r) => r.kind === 'started')).toHaveLength(1);
  expect(results.filter((r) => r.kind === 'follow')).toHaveLength(3);
  const ids = new Set(results.map((r) => (r.kind === 'limit' ? null : r.pipelineRunId)));
  expect(ids.size).toBe(1);
});

it('closes a stale running row and starts a fresh run', async () => {
  await adminDb()
    .update(pipelineRuns)
    .set({ createdAt: new Date(Date.now() - STALE_RUN_MS - 60_000) })
    .where(eq(pipelineRuns.userId, userId));
  const r = await startRun(userId, jobId, 30);
  expect(r.kind).toBe('started');
  const stale = await adminDb()
    .select()
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.userId, userId), eq(pipelineRuns.status, 'failed')));
  expect(stale).toHaveLength(1);
});

it('enforces the daily limit', async () => {
  await adminDb()
    .update(pipelineRuns)
    .set({ status: 'done' })
    .where(eq(pipelineRuns.userId, userId));
  expect((await startRun(userId, jobId, 2)).kind).toBe('limit');
});
