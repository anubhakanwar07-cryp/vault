import 'server-only';
import pLimit from 'p-limit';
import { z } from 'zod';
import { callLLM } from '@/lib/llm/client';
import * as prompt from '@/lib/llm/prompts/scoreEvidence';
import type { AchievementRecord, EvidenceMatrix, Requirement, Score } from './types';

export const BATCH_SIZE = 8;

const output = z.object({
  scores: z.array(
    z.object({
      achievement_id: z.string(),
      req_id: z.string(),
      score: z.coerce.number().int().min(0).max(3),
      reason: z.string().default(''),
    }),
  ),
});

/** Stage 4 (SPEC §7.5): achievement × requirement scores, batched 8 per call in parallel. */
export async function scoreEvidence(opts: {
  userId: string;
  pipelineRunId?: string;
  requirements: Requirement[];
  records: AchievementRecord[];
  concurrency?: number;
}): Promise<EvidenceMatrix> {
  const reqs = opts.requirements.map((r) => ({ id: r.id, req: r.req }));
  const validReqs = new Set(reqs.map((r) => r.id));
  const batches: AchievementRecord[][] = [];
  for (let i = 0; i < opts.records.length; i += BATCH_SIZE)
    batches.push(opts.records.slice(i, i + BATCH_SIZE));

  const limit = pLimit(opts.concurrency ?? 5);
  const matrix: EvidenceMatrix = {};
  for (const r of opts.records) matrix[r.id] = {};

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        // Short local ids keep the prompt small and stop the model inventing UUIDs.
        const local = new Map(batch.map((r, i) => [`a${i + 1}`, r.id]));
        const out = await callLLM({
          stage: 'score',
          tier: 'fast',
          system: prompt.system,
          user: prompt.buildUser({
            requirements: reqs,
            achievements: batch.map((r, i) => ({
              id: `a${i + 1}`,
              action: r.action,
              result: r.result,
              metric_value: r.metricValue,
              skills: r.skills,
              tools: r.tools,
              function_tags: r.functionTags,
              domain_tags: r.domainTags,
              project_name: r.project?.name ?? null,
              role_title: r.role?.title ?? null,
            })),
          }),
          schema: output,
          promptVersion: prompt.version,
          userId: opts.userId,
          pipelineRunId: opts.pipelineRunId,
          maxTokens: 4000,
        });
        for (const s of out.scores) {
          const id = local.get(s.achievement_id);
          if (!id || !validReqs.has(s.req_id) || s.score < 1) continue;
          matrix[id]![s.req_id] = { score: s.score as Score, reason: s.reason };
        }
      }),
    ),
  );
  return matrix;
}
