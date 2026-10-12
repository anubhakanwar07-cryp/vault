import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { achievements, projects, roles } from '@/lib/db/schema';
import { buildEmbeddingText, defaultEmbedder, type Embedder } from '@/lib/embeddings';
import { completenessScore } from './completeness';

export type RefreshResult = { updated: number; embeddingError: string | null };

/**
 * Recomputes completeness_score and the embedding for the given achievements (SPEC §6.3, §6.5).
 * Completeness is always written; if the embedding call fails the old embedding is cleared so
 * stale vectors never describe edited text, and the error is returned for the UI to surface.
 */
export async function refreshAchievements(
  userId: string,
  ids: string[],
  embedder: Embedder = defaultEmbedder(),
): Promise<RefreshResult> {
  if (ids.length === 0) return { updated: 0, embeddingError: null };

  const rows = await withUser(userId, (tx) =>
    tx
      .select({ a: achievements, p: projects, r: roles })
      .from(achievements)
      .leftJoin(projects, eq(projects.id, achievements.projectId))
      .leftJoin(roles, eq(roles.id, achievements.roleId))
      .where(inArray(achievements.id, ids)),
  );

  const texts = rows.map(({ a, p, r }) =>
    buildEmbeddingText({
      action: a.action,
      result: a.result,
      skills: a.skills,
      tools: a.tools,
      functionTags: a.functionTags,
      domainTags: a.domainTags,
      project: p ? { name: p.name, oneLiner: p.oneLiner } : null,
      role: r ? { title: r.title, company: r.company } : null,
    }),
  );

  let vectors: number[][] | null = null;
  let embeddingError: string | null = null;
  try {
    vectors = await embedder.embed(texts);
  } catch (err) {
    embeddingError = err instanceof Error ? err.message : String(err);
    console.error('[vault] embedding failed', err);
  }

  await withUser(userId, async (tx) => {
    for (const [i, { a, p }] of rows.entries()) {
      const score = completenessScore({ ...a, projectProofUrl: p?.proofUrl ?? null });
      await tx
        .update(achievements)
        .set({ completenessScore: score, embedding: vectors ? vectors[i]! : null })
        .where(eq(achievements.id, a.id));
    }
  });

  return { updated: rows.length, embeddingError };
}
