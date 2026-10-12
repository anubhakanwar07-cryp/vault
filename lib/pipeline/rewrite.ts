import 'server-only';
import { similarity } from '@/lib/import/merge';
import { callLLM } from '@/lib/llm/client';
import * as headlinePrompt from '@/lib/llm/prompts/headlineSummary';
import * as rewritePrompt from '@/lib/llm/prompts/rewriteBullet';
import type { ParsedJD } from '@/lib/llm/schemas/jd';
import { headlineSummaryOutput, rewriteOutput } from '@/lib/llm/schemas/pipeline';
import type { AchievementRecord, EvidenceMatrix, Requirement } from './types';

export type RewriteContext = {
  userId: string;
  pipelineRunId?: string;
  jd: ParsedJD;
  requirements: Requirement[];
  matrix: EvidenceMatrix;
  styleRules: string[];
};

/** Drops null/empty fields so prompts carry only facts that exist. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(
      ([, v]) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0),
    ),
  ) as Partial<T>;
}

/** The record as the model sees it (SPEC §9.3 SOURCE RECORD). */
export function sourceRecordForPrompt(r: AchievementRecord) {
  return compact({
    situation: r.situation,
    action: r.action,
    result: r.result,
    metric_value: r.metricValue,
    metric_confidence: r.metricConfidence,
    skills: r.skills,
    tools: r.tools,
    seniority_signals: r.senioritySignals,
    raw_notes: r.rawNotes,
    project: r.project
      ? compact({
          name: r.project.name,
          one_liner: r.project.oneLiner,
          ownership: r.project.ownership,
        })
      : null,
    role: r.role ? { title: r.role.title, company: r.role.company } : null,
  });
}

/** The JD keywords worth offering for one bullet: those near its evidence first, then the heaviest. */
export function keywordsForBullet(
  r: AchievementRecord,
  jd: ParsedJD,
  provenReqs: string[],
  max = 12,
) {
  const text = [r.action, r.result, r.situation, ...r.skills, ...r.tools, ...provenReqs]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const near = (k: ParsedJD['keywords'][number]) =>
    [k.term, ...k.synonyms].some((t) => text.includes(t.toLowerCase()));
  return [...jd.keywords]
    .sort((a, b) => Number(near(b)) - Number(near(a)) || b.weight - a.weight)
    .slice(0, max)
    .map((k) => ({ term: k.term, synonyms: k.synonyms.slice(0, 3) }));
}

/** The JD core problem this achievement speaks to most (word overlap with the record + what it proves). */
export function bestCoreProblem(r: AchievementRecord, jd: ParsedJD, provenReqs: string[]): string {
  const text = [r.situation, r.action, r.result, ...r.skills, ...r.tools, ...provenReqs]
    .filter(Boolean)
    .join(' ');
  let best = jd.core_problems[0] ?? jd.role_title;
  let bestSim = -1;
  for (const p of jd.core_problems) {
    const s = similarity(p, text);
    if (s > bestSim) {
      bestSim = s;
      best = p;
    }
  }
  return best;
}

export function provenRequirements(
  r: AchievementRecord,
  ctx: Pick<RewriteContext, 'requirements' | 'matrix'>,
) {
  return ctx.requirements.filter((q) => (ctx.matrix[r.id]?.[q.id]?.score ?? 0) >= 2);
}

/** Stage 6 (SPEC §7.7): one strong-tier call per selected achievement. */
export async function rewriteBullet(
  ctx: RewriteContext,
  r: AchievementRecord,
  extra: { retryReasons?: string[]; avoidVerbs?: string[]; critique?: string } = {},
  tier: 'fast' | 'strong' = 'strong',
) {
  const proven = provenRequirements(r, ctx);
  return callLLM({
    stage: 'rewrite',
    tier,
    temperature: 0.5,
    system: rewritePrompt.system,
    user: rewritePrompt.buildUser({
      roleTitle: ctx.jd.role_title,
      roleFamily: ctx.jd.role_family,
      seniority: ctx.jd.seniority,
      companyStage: ctx.jd.company_stage,
      tone: ctx.jd.tone,
      coreProblem: bestCoreProblem(
        r,
        ctx.jd,
        proven.map((p) => p.req),
      ),
      requirements: proven.map((p) => p.req),
      keywords: keywordsForBullet(
        r,
        ctx.jd,
        proven.map((p) => p.req),
      ),
      styleRules: ctx.styleRules,
      ...extra,
      source: sourceRecordForPrompt(r),
    }),
    schema: rewriteOutput,
    promptVersion: rewritePrompt.version,
    userId: ctx.userId,
    pipelineRunId: ctx.pipelineRunId,
    maxTokens: 400,
  });
}

export async function writeHeadlineSummary(
  ctx: RewriteContext,
  records: AchievementRecord[],
  profile: Record<string, unknown>,
  retryReasons?: string[],
) {
  return callLLM({
    stage: 'summary',
    tier: 'strong',
    temperature: 0.4,
    system: headlinePrompt.system,
    user: headlinePrompt.buildUser({
      roleTitle: ctx.jd.role_title,
      roleFamily: ctx.jd.role_family,
      seniority: ctx.jd.seniority,
      companyStage: ctx.jd.company_stage,
      profile,
      achievements: records.map((r) =>
        compact({
          id: r.id,
          action: r.action,
          result: r.result,
          metric_value: r.metricValue,
          metric_confidence: r.metricConfidence === 'none' ? null : r.metricConfidence,
          tools: r.tools,
          role: r.role ? `${r.role.title}, ${r.role.company}` : r.project?.name,
        }),
      ),
      retryReasons,
    }),
    schema: headlineSummaryOutput,
    promptVersion: headlinePrompt.version,
    userId: ctx.userId,
    pipelineRunId: ctx.pipelineRunId,
    maxTokens: 800,
  });
}

/** SPEC §7.8 fallback when a bullet fails verification twice: action + result verbatim from the vault. */
export function safeFallback(r: AchievementRecord): string {
  const action = r.action.trim().replace(/[.;\s]+$/, '');
  const result = r.result?.trim().replace(/[.;\s]+$/, '');
  if (!result) return `${action}.`;
  // Lower-case a leading capital only for ordinary words ("Merchant" → "merchant", not "UPI").
  const joined = /^[A-Z][a-z]/.test(result)
    ? `${result[0]!.toLowerCase()}${result.slice(1)}`
    : result;
  return `${action}; ${joined}.`;
}
