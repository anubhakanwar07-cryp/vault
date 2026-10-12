import 'server-only';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withUser } from '@/lib/db/client';
import { styleRules, userEdits } from '@/lib/db/schema';
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

async function rewriteEditCount(userId: string): Promise<number> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(userEdits)
      .where(
        and(
          eq(userEdits.editKind, 'rewrite'),
          isNotNull(userEdits.before),
          isNotNull(userEdits.after),
        ),
      ),
  );
  return row?.n ?? 0;
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

  const existing = await withUser(userId, (tx) =>
    tx
      .select({
        id: styleRules.id,
        rule: styleRules.rule,
        evidenceCount: styleRules.evidenceCount,
        active: styleRules.active,
      })
      .from(styleRules),
  );
  const { inserts, updates } = mergeRules(existing, out.rules);
  await withUser(userId, async (tx) => {
    if (inserts.length)
      await tx.insert(styleRules).values(inserts.map((r) => ({ userId, ...r, active: true })));
    for (const u of updates)
      await tx
        .update(styleRules)
        .set({ evidenceCount: u.evidenceCount })
        .where(eq(styleRules.id, u.id));
  });
  return { inserted: inserts.length, updated: updates.length };
}

/** Called after each user edit: derives rules on every DERIVE_EVERY-th real rewrite. Never throws. */
export async function maybeDeriveStyleRules(userId: string): Promise<void> {
  try {
    const n = await rewriteEditCount(userId);
    if (n > 0 && n % DERIVE_EVERY === 0) await deriveStyleRules(userId);
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
