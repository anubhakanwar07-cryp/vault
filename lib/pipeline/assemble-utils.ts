// Pure helpers for Stage 8 (SPEC §7.7–7.8).
import { keywordCoverage, mentionsKeyword, type KeywordLike } from '@/lib/keywords/coverage';
import type { ParsedJD } from '@/lib/llm/schemas/jd';
import type { MatchReport } from '@/lib/resume/types';
import type { AchievementRecord, Requirement, Selection } from './types';

export const MAX_SKILLS = 12;
export const MAX_EXTRAS = 3;

/**
 * Skills section: only skills/tools already in the vault. Ordered by (appears in JD keywords, by
 * keyword weight) then (frequency in selected bullets). Vault skills that neither match the JD nor
 * appear in a selected bullet are left out.
 */
export function orderSkills(
  vaultSkills: string[],
  selected: AchievementRecord[],
  keywords: (KeywordLike & { weight: number })[],
): string[] {
  const freq = new Map<string, number>();
  for (const r of selected)
    for (const s of new Set([...r.skills, ...r.tools]))
      freq.set(s.toLowerCase(), (freq.get(s.toLowerCase()) ?? 0) + 1);
  const canonical = new Map<string, string>();
  for (const s of vaultSkills)
    if (!canonical.has(s.toLowerCase())) canonical.set(s.toLowerCase(), s);

  const jdWeight = (s: string) =>
    Math.max(
      0,
      ...keywords
        .filter((k) => [k.term, ...k.synonyms].some((t) => t.toLowerCase() === s.toLowerCase()))
        .map((k) => k.weight),
    );

  return [...canonical.entries()]
    .map(([key, name]) => ({ name, jd: jdWeight(name), f: freq.get(key) ?? 0 }))
    .filter((x) => x.jd > 0 || x.f > 0)
    .sort((a, b) => b.jd - a.jd || b.f - a.f || a.name.localeCompare(b.name))
    .slice(0, MAX_SKILLS)
    .map((x) => x.name);
}

export type ExtraLike = {
  kind: string | null;
  title: string | null;
  issuer: string | null;
  date: string | null;
  description: string | null;
  tags: string[];
};

/** Extras whose tags/title/description match JD keywords, max 3 (SPEC §7.7). */
export function pickExtras<T extends ExtraLike>(extras: T[], keywords: KeywordLike[]): T[] {
  return extras
    .map((x) => {
      const text = [x.title, x.description, ...x.tags].filter(Boolean).join(' | ');
      return {
        x,
        hits: keywords.filter(
          (k) =>
            mentionsKeyword(text, k) ||
            x.tags.some(
              (t) =>
                mentionsKeyword(t, k) ||
                [k.term, ...k.synonyms].some((s) => s.toLowerCase() === t.toLowerCase()),
            ),
        ).length,
      };
    })
    .filter((e) => e.hits > 0)
    .sort((a, b) => b.hits - a.hits || (b.x.date ?? '').localeCompare(a.x.date ?? ''))
    .slice(0, MAX_EXTRAS)
    .map((e) => e.x);
}

/** credit per requirement: best ≥ 2 → 1, best = 1 → 0.5, else 0. SPEC-QUESTION: §7.8 says "weighted" only. */
export function weightedCoverage(rows: { weight: number; bestScore: number }[]): number {
  const total = rows.reduce((s, r) => s + r.weight, 0);
  if (total === 0) return 100;
  const got = rows.reduce(
    (s, r) => s + r.weight * (r.bestScore >= 2 ? 1 : r.bestScore === 1 ? 0.5 : 0),
    0,
  );
  return Math.round((got / total) * 100);
}

export function buildMatchReport(opts: {
  jd: ParsedJD;
  requirements: Requirement[];
  selection: Selection;
  bulletIdByAchievement: Record<string, string>;
  lines: { id: string; text: string }[];
  knockoutWarnings: string[];
  fallbackBullets: string[];
}): MatchReport {
  const row = (r: Requirement) => {
    const c = opts.selection.coverage[r.id] ?? { bestScore: 0, achievementId: null };
    return {
      reqId: r.id,
      req: r.req,
      weight: r.weight,
      bestScore: c.bestScore,
      coveredBy: c.achievementId ? (opts.bulletIdByAchievement[c.achievementId] ?? null) : null,
    };
  };
  const must = opts.requirements.filter((r) => r.kind === 'must').map(row);
  const nice = opts.requirements.filter((r) => r.kind === 'nice').map(row);
  return {
    mustHaveCoverage: must,
    niceToHaveCoverage: nice,
    coveragePercent: weightedCoverage(must),
    keywords: keywordCoverage(opts.jd.keywords, opts.lines),
    gaps: must
      .filter((m) => m.bestScore < 2)
      .map((m) => ({
        reqId: m.reqId,
        req: m.req,
        suggestion:
          m.bestScore === 1
            ? `Only weak evidence for “${m.req}”. If you’ve done more of this, add it to your vault — or speak to it in a cover letter.`
            : `No evidence yet for “${m.req}”. Add it to your vault if you’ve done it, or address it in a cover letter.`,
      })),
    knockoutWarnings: opts.knockoutWarnings,
    fallbackBullets: opts.fallbackBullets,
  };
}

/** "Mon YYYY" for the template and plain-text rendering. */
export function monthYear(d: string | null): string {
  if (!d) return 'Present';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    Number(d.slice(5, 7)) - 1
  ];
  return `${m} ${d.slice(0, 4)}`;
}
