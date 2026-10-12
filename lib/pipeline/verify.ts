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

/** SPEC §9.5: one fast-tier call over many lines; returns unsupported claims per line id. */
export async function verifyClaimsLLM(
  ctx: Pick<RewriteContext, 'userId' | 'pipelineRunId'>,
  lines: LineToCheck[],
): Promise<Record<string, string[]>> {
  if (lines.length === 0) return {};
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
  const known = new Set(lines.map((l) => l.lineId));
  for (const r of out.results) {
    if (!known.has(r.line_id)) continue;
    const bad = r.claims.filter((c) => c.verdict === 'unsupported');
    if (bad.length)
      failures[r.line_id] = bad.map((c) => `“${c.claim}” — ${c.why || 'not in the source'}`);
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
  const limit = pLimit(opts.concurrency ?? 8);
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
    ).catch((err: unknown) => {
      // If the auditor itself fails, don't silently pass: treat as unverified and retry.
      console.error('[verify] LLM verification failed', err);
      return Object.fromEntries(
        passedCode.map((d) => [d.record.id, ['Fact-check unavailable; retrying.']]),
      );
    });

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
    o.verified = false;
    o.fallback = true;
    o.keywordsUsed = [];
  }
  return outcomes;
}
