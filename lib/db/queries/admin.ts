import 'server-only';
import { asc, desc, eq, isNull } from 'drizzle-orm';
import { authUsers } from 'drizzle-orm/supabase';
import { adminDb } from '@/lib/db/client';
import { jobs, llmRuns, pipelineRuns } from '@/lib/db/schema';

// Admin-only reads across all users (bypass RLS). Callers MUST check isAdmin() first.

export async function adminListRuns(limit = 100) {
  return adminDb()
    .select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      stage: pipelineRuns.stage,
      error: pipelineRuns.error,
      totalTokens: pipelineRuns.totalTokens,
      totalCostUsd: pipelineRuns.totalCostUsd,
      durationMs: pipelineRuns.durationMs,
      createdAt: pipelineRuns.createdAt,
      roleTitle: jobs.roleTitle,
      company: jobs.company,
      email: authUsers.email,
    })
    .from(pipelineRuns)
    .leftJoin(jobs, eq(jobs.id, pipelineRuns.jobId))
    .leftJoin(authUsers, eq(authUsers.id, pipelineRuns.userId))
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(limit);
}

export async function adminGetRun(id: string) {
  const db = adminDb();
  const [run] = await db
    .select({
      run: pipelineRuns,
      roleTitle: jobs.roleTitle,
      company: jobs.company,
      email: authUsers.email,
    })
    .from(pipelineRuns)
    .leftJoin(jobs, eq(jobs.id, pipelineRuns.jobId))
    .leftJoin(authUsers, eq(authUsers.id, pipelineRuns.userId))
    .where(eq(pipelineRuns.id, id));
  if (!run) return null;
  const calls = await db
    .select()
    .from(llmRuns)
    .where(eq(llmRuns.pipelineRunId, id))
    .orderBy(asc(llmRuns.createdAt));
  return { ...run, calls };
}

/** LLM calls outside the tailoring pipeline (import, interviewer, style rules…). */
export async function adminRecentStandaloneCalls(limit = 50) {
  return adminDb()
    .select({
      id: llmRuns.id,
      stage: llmRuns.stage,
      model: llmRuns.model,
      zodValid: llmRuns.zodValid,
      latencyMs: llmRuns.latencyMs,
      inputTokens: llmRuns.inputTokens,
      outputTokens: llmRuns.outputTokens,
      error: llmRuns.error,
      createdAt: llmRuns.createdAt,
      email: authUsers.email,
    })
    .from(llmRuns)
    .leftJoin(authUsers, eq(authUsers.id, llmRuns.userId))
    .where(isNull(llmRuns.pipelineRunId))
    .orderBy(desc(llmRuns.createdAt))
    .limit(limit);
}

export async function adminGetCall(id: string) {
  const [row] = await adminDb().select().from(llmRuns).where(eq(llmRuns.id, id));
  return row ?? null;
}
