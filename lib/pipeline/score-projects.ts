import 'server-only';
import pLimit from 'p-limit';
import { callLLM } from '@/lib/llm/client';
import * as prompt from '@/lib/llm/prompts/scoreProjects';
import type { ParsedJD } from '@/lib/llm/schemas/jd';
import { scoreProjectsOutput } from '@/lib/llm/schemas/pipeline';
import { requirementsOf, type AchievementRecord, type ProjectScores } from './types';

/** Projects per call. Most vaults fit in one call, which keeps scores calibrated against each other. */
export const PROJECT_BATCH_SIZE = 20;

/** Groups records by project id (records without a project are left out). */
export function byProject(records: AchievementRecord[]): Map<string, AchievementRecord[]> {
  const out = new Map<string, AchievementRecord[]>();
  for (const r of records) {
    if (!r.project) continue;
    out.set(r.project.id, [...(out.get(r.project.id) ?? []), r]);
  }
  return out;
}

function forPrompt(id: string, recs: AchievementRecord[]): prompt.ProjectForScoring {
  const p = recs[0]!.project!;
  const role = recs[0]!.role;
  return {
    id,
    name: p.name,
    one_liner: p.oneLiner,
    ownership: p.ownership,
    context: role ? `${role.title} at ${role.company}` : 'side project',
    achievements: recs.map((r) => ({
      situation: r.situation,
      action: r.action,
      result: r.result,
      metric_value: r.metricValue,
      skills: r.skills,
      tools: r.tools,
    })),
  };
}

/**
 * Stage 4a ("score_projects"): scores every project in the vault as a whole against the JD — what the
 * work functionally proves, not word overlap. Projects the model leaves out score 0.
 */
export async function scoreProjects(opts: {
  userId: string;
  pipelineRunId?: string;
  jd: ParsedJD;
  records: AchievementRecord[];
  signal?: AbortSignal;
}): Promise<ProjectScores> {
  const requirements = requirementsOf(opts.jd);
  const validReqs = new Set(requirements.map((r) => r.id));
  const groups = [...byProject(opts.records).entries()].sort(([a], [b]) => a.localeCompare(b));
  const batches: [string, AchievementRecord[]][][] = [];
  for (let i = 0; i < groups.length; i += PROJECT_BATCH_SIZE)
    batches.push(groups.slice(i, i + PROJECT_BATCH_SIZE));

  const scores: ProjectScores = {};
  for (const [id] of groups) scores[id] = { score: 0, requirementsProven: [], reason: '' };

  const limit = pLimit(3);
  const settled = await Promise.allSettled(
    batches.map((batch) =>
      limit(async () => {
        // Short local ids keep the prompt small and stop the model inventing UUIDs.
        const local = new Map(batch.map(([id], i) => [`p${i + 1}`, id]));
        const out = await callLLM({
          stage: 'score_projects',
          tier: 'fast',
          temperature: 0,
          // A little reasoning makes functional (not lexical) judgements far more consistent.
          reasoningEffort: 'low',
          system: prompt.system,
          user: prompt.buildUser({
            roleTitle: opts.jd.role_title,
            coreProblems: opts.jd.core_problems,
            requirements: requirements.map((r) => ({ id: r.id, req: r.req, kind: r.kind })),
            projects: batch.map(([, recs], i) => forPrompt(`p${i + 1}`, recs)),
          }),
          schema: scoreProjectsOutput,
          promptVersion: prompt.version,
          userId: opts.userId,
          pipelineRunId: opts.pipelineRunId,
          signal: opts.signal,
          maxTokens: 3000,
        });
        for (const p of out.projects) {
          const id = local.get(p.project_id);
          if (!id) continue;
          scores[id] = {
            score: p.score,
            requirementsProven: [...new Set(p.requirements_proven.filter((r) => validReqs.has(r)))],
            reason: p.reason,
          };
        }
      }),
    ),
  );
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  return scores;
}
