import { z } from 'zod';
import { ROLE_FAMILIES } from './vault';

// ParsedJD (SPEC §9.1). Used for the model output, the confirm-screen edits, and jobs.parsed.

export const SENIORITIES = ['intern', 'junior', 'mid', 'senior', 'lead'] as const;
export const COMPANY_STAGES = ['seed', 'early', 'growth', 'late', 'enterprise', 'unknown'] as const;
export const EVIDENCE_TYPES = ['skill', 'outcome', 'domain', 'credential'] as const;

const clampInt = (min: number, max: number) =>
  z.coerce
    .number()
    .catch(min)
    .transform((n) => Math.min(max, Math.max(min, Math.round(n))));

const text = z.string().trim().min(1);

export const mustHave = z.object({
  id: z.string().trim().min(1),
  req: text,
  weight: clampInt(1, 5),
  evidence_type: z.enum(EVIDENCE_TYPES).catch('skill'),
});
export const niceToHave = z.object({
  id: z.string().trim().min(1),
  req: text,
  weight: clampInt(1, 3),
});
export const keyword = z.object({
  term: text,
  synonyms: z
    .array(z.string())
    .default([])
    .transform((xs) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]),
  weight: clampInt(1, 5),
});

/** Re-numbers ids (m1, m2… / n1, n2…) so they're unique and stable for the evidence matrix. */
function renumber<T extends { id: string }>(prefix: string) {
  return (xs: T[]) => xs.map((x, i) => ({ ...x, id: `${prefix}${i + 1}` }));
}

export const parsedJD = z.object({
  role_title: text,
  company: z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  role_family: z.enum(ROLE_FAMILIES).catch('other'),
  seniority: z.enum(SENIORITIES).catch('mid'),
  company_stage: z.enum(COMPANY_STAGES).catch('unknown'),
  core_problems: z
    .array(z.string())
    .transform((xs) =>
      xs
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 3),
    )
    .pipe(z.array(text).min(1, 'At least one core problem')),
  must_haves: z.array(mustHave).min(1, 'At least one must-have').transform(renumber('m')),
  nice_to_haves: z.array(niceToHave).default([]).transform(renumber('n')),
  keywords: z
    .array(keyword)
    .default([])
    .transform((ks) => {
      const seen = new Set<string>();
      return ks.filter((k) => !seen.has(k.term.toLowerCase()) && seen.add(k.term.toLowerCase()));
    }),
  knockouts: z
    .array(z.string())
    .default([])
    .transform((xs) => xs.map((x) => x.trim()).filter(Boolean)),
  tone: z.string().trim().default(''),
});

export type ParsedJD = z.output<typeof parsedJD>;
export type MustHave = ParsedJD['must_haves'][number];
export type NiceToHave = ParsedJD['nice_to_haves'][number];
export type Keyword = ParsedJD['keywords'][number];
