// Deterministic verification (SPEC §7.8). Pure — no I/O, no LLM. A non-empty result means the line fails.
import { numbersIn } from '@/lib/import/source-check';
import { mentions, mentionsKeyword, termRegex, type KeywordLike } from '@/lib/keywords/coverage';
import { AMBIGUOUS_TECH_TERMS, TECH_TERMS } from '@/lib/keywords/tech-terms';
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True if `term` names a tool in `text`. Ambiguous names must match exact casing and stand alone. */
export function mentionsTech(text: string, term: string): boolean {
  if (!AMBIGUOUS_TECH_TERMS.has(term)) return mentions(text, term);
  return new RegExp(`(?<![\\p{L}\\p{N}&/'-])${escapeRe(term)}(?![\\p{L}\\p{N}&/'-])`, 'u').test(
    text,
  );
}

/** Removes tool names so version numbers ("GPT-4", "GA4") never count as facts or permit them. */
function withoutToolNames(text: string, tools: string[]): string {
  let out = text;
  for (const t of tools)
    if (/\d/.test(t)) out = out.replace(new RegExp(termRegex(t).source, 'giu'), ' ');
  return out;
}

const UNIT_ALIASES: [RegExp, string, number][] = [
  [/^(%|percent|pct)$/i, '%', 1],
  [/^(x|×|times|fold)$/i, 'x', 1],
  [/^(k|thousand)$/i, '', 1e3],
  [/^(m|mn|mm|million)$/i, '', 1e6],
  [/^(b|bn|billion)$/i, '', 1e9],
  [/^(cr|crores?)$/i, '', 1e7],
  [/^(l|lakhs?|lac)$/i, '', 1e5],
];
const NUMBER_WITH_UNIT =
  /([$€£₹]|\b(?:usd|inr|rs\.?)\s?)?(\d+(?:\.\d+)?)(?:\s?(%|×|percent|pct|times|-?fold|thousand|million|billion|crores?|lakhs?|lac|mn|mm|bn|cr|[xkmbl])(?![\p{L}\p{N}]))?/giu;

/** `value` has magnitude suffixes applied ("2K" → 2000); `unit` is "%", "x" or "". */
export type NumberToken = { label: string; value: number; unit: string; currency: boolean };

/** Number tokens with unit and currency: "$1.2M" → { value: 1200000, unit: "", currency: true }. */
export function numberTokens(s: string): NumberToken[] {
  const clean = s.replace(/(\d),(?=\d{3}\b)/g, '$1');
  const out: NumberToken[] = [];
  for (const m of clean.matchAll(NUMBER_WITH_UNIT)) {
    const raw = (m[3] ?? '').replace(/^-/, '');
    const [, unit, mult] = UNIT_ALIASES.find(([re]) => re.test(raw)) ?? [null, '', 1];
    out.push({
      label: m[0].trim(),
      value: Math.round(Number(m[2]) * mult * 1000) / 1000,
      unit,
      currency: Boolean(m[1]),
    });
  }
  return out;
}

// Spelled-out quantities the digit check can't see. Each must appear in the source (as the word, a
// related form, or its digit) before a bullet may use it.
const COUNT_WORDS: Record<string, string> = {
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  fifteen: '15',
  twenty: '20',
  fifty: '50',
  hundred: '100',
};
const MULTIPLIERS: [RegExp, string][] = [
  [/\b(doubl(?:e|ed|es|ing)|twofold|two-fold)\b/i, '2'],
  [/\b(tripl(?:e|ed|es|ing)|threefold|three-fold)\b/i, '3'],
  [/\b(quadrupl(?:e|ed|es|ing)|fourfold|four-fold)\b/i, '4'],
  [/\b(halv(?:e|ed|es|ing)|in half)\b/i, 'half'],
];
const MAGNITUDES = /\b(dozens?|hundreds|thousands|millions|billions|lakhs|crores)\b/gi;

function wordNumberCheck(text: string, source: string): string[] {
  const srcNums = new Set(numbersIn(source));
  const bad: string[] = [];
  for (const [word, digit] of Object.entries(COUNT_WORDS)) {
    const re = new RegExp(`\\b${word}\\b`, 'i');
    if (re.test(text) && !re.test(source) && !srcNums.has(digit)) bad.push(word);
  }
  for (const [re, n] of MULTIPLIERS) {
    const hit = text.match(re);
    if (!hit || re.test(source)) continue;
    const asMultiple =
      n !== 'half' && numberTokens(source).some((t) => t.value === Number(n) && t.unit === 'x');
    const asHalf = n === 'half' && /\b50\s?%/.test(source);
    if (!asMultiple && !asHalf) bad.push(hit[0]);
  }
  for (const m of text.matchAll(MAGNITUDES)) {
    const stem = m[0].toLowerCase().replace(/s$/, '');
    if (!new RegExp(`\\b${stem}`, 'i').test(source)) bad.push(m[0]);
  }
  return bad.length ? [`Says "${bad.join('", "')}", which isn't in the source record.`] : [];
}

function numberCheck(text: string, source: string): string[] {
  const src = numberTokens(source);
  const extra = new Set<string>();
  for (const t of numberTokens(text)) {
    const same = src.filter((s) => s.value === t.value);
    const ok =
      same.length > 0 &&
      (!t.unit || same.some((s) => s.unit === t.unit)) &&
      (!t.currency || same.some((s) => s.currency));
    if (!ok) extra.add(t.label);
  }
  return extra.size ? [`Mentions ${[...extra].join(', ')}, which isn't in the source record.`] : [];
}

/** True if every occurrence of `n` in `text` has a hedge word or "~" just before it. */
function hedgedEverywhere(n: string, text: string): boolean {
  const re = new RegExp(`(.{0,12})(?<![\\d.])${escapeRe(n)}(?![\\d])`, 'g');
  const hits = [...text.matchAll(re)];
  return hits.length > 0 && hits.every((m) => HEDGE.test(m[1] ?? ''));
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

  const allTools = [...new Set([...TECH_TERMS, ...ctx.vaultTools, ...r.tools, ...r.skills])];
  const numText = withoutToolNames(text, allTools);
  const numSrc = withoutToolNames(src, allTools);
  reasons.push(...numberCheck(numText, numSrc));
  reasons.push(...wordNumberCheck(numText, numSrc));

  const recordTerms = new Set([...r.tools, ...r.skills].map((t) => t.toLowerCase()));
  const named = [...new Set([...TECH_TERMS, ...ctx.vaultTools])].filter((t) =>
    mentionsTech(text, t),
  );
  const unsupported = named.filter((t) => !recordTerms.has(t.toLowerCase()) && !mentions(src, t));
  if (unsupported.length)
    reasons.push(`Names ${unsupported.join(', ')}, which this achievement doesn't use.`);

  if (r.metricConfidence === 'estimate' && r.metricValue) {
    const metricNums = numbersIn(r.metricValue);
    const used = [...new Set(numbersIn(numText))].filter((n) => metricNums.includes(n));
    if (used.some((n) => !hedgedEverywhere(n, numText))) {
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
