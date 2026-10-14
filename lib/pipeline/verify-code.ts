// Deterministic verification (SPEC §7.8). Pure — no I/O, no LLM. A non-empty result means the line fails.
import { numbersIn } from '@/lib/import/source-check';
import { mentions, mentionsKeyword, type KeywordLike } from '@/lib/keywords/coverage';
import { TECH_TERMS } from '@/lib/keywords/tech-terms';
import type { AchievementRecord } from './types';

export const BANNED_PHRASES = [
  'responsible for',
  'helped with',
  'various',
  'leveraged',
  'spearheaded',
  'synergy',
  'passionate',
  'dynamic',
  'results-driven',
  'go-getter',
  'detail-oriented',
  'worked on',
] as const;

const HEDGE = /(~|≈|\bapprox|\babout\b|\bnearly\b|\baround\b|\broughly\b|\balmost\b)/i;
export const MAX_KEYWORD_SUBSTITUTIONS = 2;

/** All text in a record that a bullet may draw facts from (SPEC §7.8 + project ownership for team sizes, §8.9). */
export function sourceText(r: AchievementRecord): string {
  return [
    r.situation,
    r.action,
    r.result,
    r.metricValue,
    r.rawNotes,
    r.project?.ownership,
    r.project?.name,
    r.project?.oneLiner,
    r.skills.join(', '),
    r.tools.join(', '),
  ]
    .filter(Boolean)
    .join('\n');
}

export type VerifyContext = {
  /** Every tool in the user's vault — naming one in the wrong bullet is a fabrication. */
  vaultTools: string[];
  jdKeywords: KeywordLike[];
  targetCompany: string | null;
};

export function bannedPhrasesIn(text: string): string[] {
  return BANNED_PHRASES.filter((p) => mentions(text, p));
}

function numberCheck(text: string, source: string): string[] {
  const allowed = new Set(numbersIn(source));
  const extra = [...new Set(numbersIn(text))].filter((n) => !allowed.has(n));
  return extra.length ? [`Mentions ${extra.join(', ')}, which isn't in the source record.`] : [];
}

function companyCheck(text: string, ctx: VerifyContext, ownCompanies: string[]): string[] {
  const c = ctx.targetCompany?.trim();
  if (!c || c.length < 3 || ownCompanies.some((o) => o.toLowerCase() === c.toLowerCase()))
    return [];
  return mentions(text, c) ? [`Names the target company (${c}).`] : [];
}

/** Code-level checks for one bullet against its achievement record. */
export function verifyBullet(text: string, r: AchievementRecord, ctx: VerifyContext): string[] {
  const reasons: string[] = [];
  const src = sourceText(r);

  reasons.push(...numberCheck(text, src));

  const recordTerms = new Set([...r.tools, ...r.skills].map((t) => t.toLowerCase()));
  const named = [...new Set([...TECH_TERMS, ...ctx.vaultTools])].filter((t) => mentions(text, t));
  const unsupported = named.filter((t) => !recordTerms.has(t.toLowerCase()) && !mentions(src, t));
  if (unsupported.length)
    reasons.push(`Names ${unsupported.join(', ')}, which this achievement doesn't use.`);

  if (r.metricConfidence === 'estimate' && r.metricValue) {
    const metricNums = numbersIn(r.metricValue);
    if (numbersIn(text).some((n) => metricNums.includes(n)) && !HEDGE.test(text)) {
      reasons.push(`The metric is an estimate; keep a hedge such as "~" or "about".`);
    }
  }

  const banned = bannedPhrasesIn(text);
  if (banned.length) reasons.push(`Uses banned phrase(s): ${banned.join(', ')}.`);

  const substituted = ctx.jdKeywords.filter(
    (k) => mentionsKeyword(text, k) && !mentionsKeyword(src, k),
  );
  if (substituted.length > MAX_KEYWORD_SUBSTITUTIONS) {
    reasons.push(
      `Uses ${substituted.length} JD keywords not in the source (${substituted.map((k) => k.term).join(', ')}); max ${MAX_KEYWORD_SUBSTITUTIONS}.`,
    );
  }

  reasons.push(...companyCheck(text, ctx, r.role ? [r.role.company] : []));
  return reasons;
}

/** First word of a bullet, lowercased — for the "each verb at most twice" rule (SPEC §8.10). */
export function leadVerb(text: string): string {
  return (text.trim().match(/^[A-Za-z-]+/)?.[0] ?? '').toLowerCase();
}
