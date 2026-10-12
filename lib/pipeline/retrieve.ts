import 'server-only';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { achievements, projects, roles } from '@/lib/db/schema';
import { defaultEmbedder, type Embedder } from '@/lib/embeddings';
import type { ParsedJD } from '@/lib/llm/schemas/jd';
import { loadRecords } from './records';
import type { AchievementRecord } from './types';

export const TOP_K = 25;
export const RECENT_K = 3;
export const MAX_CANDIDATES = 35;

/** SPEC §7.4 query: role_title + core_problems + must-have reqs + top 10 keywords. */
export function retrievalQuery(jd: ParsedJD): string {
  const topKeywords = [...jd.keywords]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((k) => k.term);
  return [
    jd.role_title,
    ...jd.core_problems,
    ...jd.must_haves.map((m) => m.req),
    topKeywords.join(', '),
  ].join('. ');
}

/** Keyword terms (and synonyms) that a must-have mentions — used for exact skill/tool matches. */
export function mustHaveTerms(jd: ParsedJD): string[] {
  const reqText = jd.must_haves.map((m) => m.req.toLowerCase()).join(' | ');
  const terms = new Set<string>();
  for (const k of jd.keywords) {
    const all = [k.term, ...k.synonyms];
    if (all.some((t) => reqText.includes(t.toLowerCase())))
      all.forEach((t) => terms.add(t.toLowerCase()));
  }
  return [...terms];
}

export async function retrieve(
  userId: string,
  jd: ParsedJD,
  embedder: Embedder = defaultEmbedder(),
): Promise<AchievementRecord[]> {
  const [queryVec] = await embedder.embed([retrievalQuery(jd)]);
  const vec = `[${queryVec!.join(',')}]`;
  const terms = mustHaveTerms(jd);

  return withUser(userId, async (tx) => {
    const active = eq(achievements.isArchived, false);
    const similar = await tx
      .select({ id: achievements.id })
      .from(achievements)
      .where(and(active, isNotNull(achievements.embedding)))
      .orderBy(sql`${achievements.embedding} <=> ${vec}::vector`)
      .limit(TOP_K);

    // Most recent work: newest role first (side projects by their own start date), then newest entry.
    const recent = await tx
      .select({ id: achievements.id })
      .from(achievements)
      .leftJoin(roles, eq(roles.id, achievements.roleId))
      .leftJoin(projects, eq(projects.id, achievements.projectId))
      .where(active)
      .orderBy(
        desc(sql`coalesce(${roles.startDate}, ${projects.startDate}, '1900-01-01')`),
        desc(achievements.createdAt),
      )
      .limit(RECENT_K);

    const exact = terms.length
      ? await tx
          .select({ id: achievements.id })
          .from(achievements)
          .where(
            and(
              active,
              sql`exists (select 1 from unnest(${achievements.skills} || ${achievements.tools}) t
                          where lower(t) = any(array[${sql.join(
                            terms.map((t) => sql`${t}`),
                            sql`, `,
                          )}]::text[]))`,
            ),
          )
      : [];

    const ids: string[] = [];
    for (const { id } of [...similar, ...recent, ...exact]) {
      if (!ids.includes(id)) ids.push(id);
      if (ids.length >= MAX_CANDIDATES) break;
    }
    const records = await loadRecords(tx, ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    return records.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  });
}
