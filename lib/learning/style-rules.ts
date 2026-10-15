import 'server-only';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withUser } from '@/lib/db/client';
import { llmRuns, styleRules, userEdits } from '@/lib/db/schema';
import { callLLM } from '@/lib/llm/client';
import * as prompt from '@/lib/llm/prompts/deriveStyleRules';
import { editsForPrompt } from './edit-diff';
import { mergeRules } from './merge-rules';

export const DERIVE_EVERY = 5;

const output = z.object({
  rules: z
    .array(z.object({ rule: z.string(), evidence_count: z.coerce.number().int().min(0) }))
    .default([]),
});

/**
 * Real rewrite edits made since rules were last derived successfully (a valid style_rules LLM
 * run). Counting from that marker means no derivation is skipped when edits land close together,
 * and a failed derivation is retried on the next edit.
 */
async function editsSinceLastDerivation(userId: string): Promise<number> {
  return withUser(userId, async (tx) => {
    const [last] = await tx
      .select({ at: llmRuns.createdAt })
      .from(llmRuns)
      .where(and(eq(llmRuns.stage, 'style_rules'), eq(llmRuns.zodValid, true)))
      .orderBy(desc(llmRuns.createdAt))
      .limit(1);
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(userEdits)
      .where(
        and(
          eq(userEdits.editKind, 'rewrite'),
          isNotNull(userEdits.before),
          isNotNull(userEdits.after),
          last?.at ? gt(userEdits.createdAt, last.at) : undefined,
        ),
      );
    return row?.n ?? 0;
  });
}

/** Derives rules from the latest edits and merges them into style_rules (SPEC §9.9). */
export async function deriveStyleRules(
  userId: string,
): Promise<{ inserted: number; updated: number }> {
  const recent = await withUser(userId, (tx) =>
    tx
      .select({ before: userEdits.before, after: userEdits.after })
      .from(userEdits)
      .where(
        and(
          eq(userEdits.editKind, 'rewrite'),
          isNotNull(userEdits.before),
          isNotNull(userEdits.after),
        ),
      )
      .orderBy(desc(userEdits.createdAt))
      .limit(30),
  );
  const edits = editsForPrompt(recent.map((e) => ({ before: e.before!, after: e.after! })));
  if (edits.length < 2) return { inserted: 0, updated: 0 };

  const out = await callLLM({
    stage: 'style_rules',
    tier: 'fast',
    temperature: 0.2,
    system: prompt.system,
    user: prompt.buildUser(edits),
    schema: output,
    promptVersion: prompt.version,
    userId,
    maxTokens: 1500,
  });

  // Merge under a per-user lock, reading current rules inside it, so two derivations that finish
  // together can't both insert the same rule.
  return withUser(userId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'style-rules:' + userId}))`);
    const existing = await tx
      .select({
        id: styleRules.id,
        rule: styleRules.rule,
        evidenceCount: styleRules.evidenceCount,
        active: styleRules.active,
      })
      .from(styleRules);
    const { inserts, updates } = mergeRules(existing, out.rules);
    if (inserts.length)
      await tx.insert(styleRules).values(inserts.map((r) => ({ userId, ...r, active: true })));
    for (const u of updates)
      await tx
        .update(styleRules)
        .set({ evidenceCount: u.evidenceCount })
        .where(eq(styleRules.id, u.id));
    return { inserted: inserts.length, updated: updates.length };
  });
}

/** Called after each user edit: derives rules once DERIVE_EVERY new real rewrites exist. Never throws. */
export async function maybeDeriveStyleRules(userId: string): Promise<void> {
  try {
    if ((await editsSinceLastDerivation(userId)) >= DERIVE_EVERY) await deriveStyleRules(userId);
  } catch (err) {
    console.error('[learning] style rule derivation failed', err);
  }
}

export async function listStyleRules(userId: string) {
  return withUser(userId, (tx) =>
    tx.select().from(styleRules).orderBy(desc(styleRules.evidenceCount)),
  );
}

export async function setStyleRuleActive(userId: string, id: string, active: boolean) {
  await withUser(userId, (tx) =>
    tx.update(styleRules).set({ active }).where(eq(styleRules.id, id)),
  );
}

export async function deleteStyleRule(userId: string, id: string) {
  await withUser(userId, (tx) => tx.delete(styleRules).where(eq(styleRules.id, id)));
}
