import 'server-only';
import pLimit from 'p-limit';
import { callLLM } from '@/lib/llm/client';
import * as prompt from '@/lib/llm/prompts/verifyClaims';
import { verifyOutput } from '@/lib/llm/schemas/pipeline';
import { rewriteBullet, safeFallback, sourceRecordForPrompt, type RewriteContext } from './rewrite';
import type { AchievementRecord } from './types';
import { verifyBullet, type VerifyContext } from './verify-code';

export const MAX_VERIFY_RETRIES = 2;

export type LineToCheck = { lineId: string; text: string; sources: AchievementRecord[] };

export const VERIFY_BATCH_SIZE = 5;
export const NO_VERDICT = 'The fact-checker returned no verdict for this line.';
export const CHECK_UNAVAILABLE = 'Fact-check unavailable.';

async function verifyBatch(
  ctx: Pick<RewriteContext, 'userId' | 'pipelineRunId'>,
  lines: LineToCheck[],
): Promise<{ failures: Record<string, string[]>; missing: LineToCheck[] }> {
  const out = await callLLM({
    stage: 'verify',
    tier: 'fast',
    temperature: 0,
    // A little reasoning makes the auditor far more consistent; it's cheap on the fast tier.
    reasoningEffort: 'low',
    system: prompt.system,
    user: prompt.buildUser(
      lines.map((l) => ({
        line_id: l.lineId,
        text: l.text,
        source_records: l.sources.map(sourceRecordForPrompt),
      })),
    ),
    schema: verifyOutput,
    promptVersion: prompt.version,
    userId: ctx.userId,
    pipelineRunId: ctx.pipelineRunId,
    maxTokens: 4000,
  });
  const failures: Record<string, string[]> = {};
  const judged = new Set<string>();
  const known = new Set(lines.map((l) => l.lineId));
  for (const r of out.results) {
    // A line with no claims wasn't actually checked — never count it as supported.
    if (!known.has(r.line_id) || r.claims.length === 0) continue;
    judged.add(r.line_id);
    const bad = r.claims.filter((c) => c.verdict === 'unsupported');
    if (bad.length)
      failures[r.line_id] = bad.map((c) => `“${c.claim}” — ${c.why || 'not in the source'}`);
  }
  return { failures, missing: lines.filter((l) => !judged.has(l.lineId)) };
}

/**
 * SPEC §9.5: fast-tier fact-check, in small batches so one truncated reply can't sink every line.
 * A line the auditor skips is re-checked once; if it's still unjudged it fails with NO_VERDICT.
 * A batch whose call fails is retried once; if it fails again its lines fail with CHECK_UNAVAILABLE.
 */
export async function verifyClaimsLLM(
  ctx: Pick<RewriteContext, 'userId' | 'pipelineRunId'>,
  lines: LineToCheck[],
): Promise<Record<string, string[]>> {
  const failures: Record<string, string[]> = {};
  const runBatches = async (todo: LineToCheck[], final: boolean): Promise<LineToCheck[]> => {
    const batches: LineToCheck[][] = [];
    for (let i = 0; i < todo.length; i += VERIFY_BATCH_SIZE)
      batches.push(todo.slice(i, i + VERIFY_BATCH_SIZE));
    const results = await Promise.all(
      batches.map((b) =>
        verifyBatch(ctx, b).catch((err: unknown) => {
          console.error('[verify] fact-check batch failed', err);
          if (final) for (const l of b) failures[l.lineId] = [CHECK_UNAVAILABLE];
          return { failures: {}, missing: final ? [] : b };
        }),
      ),
    );
    for (const r of results) Object.assign(failures, r.failures);
    return results.flatMap((r) => r.missing);
  };
  const missing = await runBatches(lines, false);
  if (missing.length) {
    const stillMissing = await runBatches(missing, true);
    for (const l of stillMissing) failures[l.lineId] ??= [NO_VERDICT];
  }
  return failures;
}

export type BulletOutcome = {
  achievementId: string;
  text: string;
  generatedText: string;
  verified: boolean;
  fallback: boolean;
  attempts: { text: string; reasons: string[] }[];
  keywordsUsed: string[];
};

export type RewriteHooks = {
  /** Test hook (SPEC §14 Phase 4): mutate a model output before verification. */
  corruptRewrite?: (achievementId: string, attempt: number, text: string) => string;
};

/**
 * Stages 6–7 for bullets: rewrite → code verify → LLM verify, feeding failures back to rewrite
 * up to MAX_VERIFY_RETRIES times, then the safe verbatim fallback (SPEC §7.8).
 */
export async function rewriteAndVerifyBullets(opts: {
  ctx: RewriteContext;
  records: AchievementRecord[];
  verifyCtx: VerifyContext;
  hooks?: RewriteHooks;
  concurrency?: number;
  extra?: Record<string, { avoidVerbs?: string[]; critique?: string }>;
  /** Tier for rewrites. 'fast' suits light edits such as swapping the lead verb. */
  tier?: 'fast' | 'strong';
}): Promise<Record<string, BulletOutcome>> {
  const limit = pLimit(opts.concurrency ?? 5);
  const outcomes: Record<string, BulletOutcome> = {};
  let pending = opts.records.map((r) => ({ record: r, reasons: [] as string[] }));

  for (let attempt = 0; attempt <= MAX_VERIFY_RETRIES && pending.length > 0; attempt++) {
    // 1) Rewrite everything pending, in parallel.
    const drafts = await Promise.all(
      pending.map(({ record, reasons }) =>
        limit(async () => {
          try {
            const out = await rewriteBullet(
              opts.ctx,
              record,
              {
                retryReasons: reasons.length ? reasons : undefined,
                ...(opts.extra?.[record.id] ?? {}),
              },
              opts.tier,
            );
            const text = opts.hooks?.corruptRewrite?.(record.id, attempt, out.bullet) ?? out.bullet;
            return { record, text, keywords: [] as string[], error: null as string | null };
          } catch (err) {
            return {
              record,
              text: '',
              keywords: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      ),
    );

    // 2) Code checks first (cheap, deterministic).
    const codeFailures: Record<string, string[]> = {};
    for (const d of drafts) {
      const o = (outcomes[d.record.id] ??= {
        achievementId: d.record.id,
        text: '',
        generatedText: '',
        verified: false,
        fallback: false,
        attempts: [],
        keywordsUsed: [],
      });
      const reasons = d.error
        ? [`Generation failed: ${d.error}`]
        : verifyBullet(d.text, d.record, opts.verifyCtx);
      if (reasons.length) codeFailures[d.record.id] = reasons;
      o.attempts.push({ text: d.text, reasons });
      o.text = d.text;
      o.generatedText = d.text;
      o.keywordsUsed = d.keywords;
    }

    // 3) LLM fact-check on lines that passed the code checks (separate call from the writer).
    const passedCode = drafts.filter((d) => !codeFailures[d.record.id]);
    const llmFailures = await verifyClaimsLLM(
      opts.ctx,
      passedCode.map((d) => ({ lineId: d.record.id, text: d.text, sources: [d.record] })),
    );

    const next: typeof pending = [];
    for (const d of drafts) {
      const reasons = codeFailures[d.record.id] ?? llmFailures[d.record.id] ?? [];
      const o = outcomes[d.record.id]!;
      o.attempts.at(-1)!.reasons = reasons;
      if (reasons.length === 0) o.verified = true;
      else next.push({ record: d.record, reasons });
    }
    pending = next;
  }

  // 4) Anything still failing gets the verbatim fallback, flagged in the match report.
  for (const { record } of pending) {
    const o = outcomes[record.id]!;
    o.text = safeFallback(record);
    // Never keep a draft that failed verification as the "generated" text.
    o.generatedText = o.text;
    o.verified = false;
    o.fallback = true;
    o.keywordsUsed = [];
  }
  return outcomes;
}
