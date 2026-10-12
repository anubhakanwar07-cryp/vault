import { z } from 'zod';

// Shared shapes for vault entities: used by forms, server actions, and LLM outputs (import/interviewer).

const optionalText = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional()
  .transform((v) => v ?? null);

/** ISO date (YYYY-MM-DD). Accepts YYYY-MM and normalises to the 1st of the month. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use YYYY-MM or YYYY-MM-DD')
  .transform((s) => (s.length === 7 ? `${s}-01` : s));
const optionalDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

/** '' (an unselected <select>) or undefined → null. */
const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v);
const nullableUuid = z.preprocess(emptyToNull, z.uuid().nullable());
const nullableEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(emptyToNull, z.enum(values).nullable());

const tagList = z
  .array(z.string())
  .default([])
  .transform((xs) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]);

export const METRIC_CONFIDENCE = ['exact', 'estimate', 'none'] as const;
export const EMPLOYMENT_TYPES = ['full-time', 'intern', 'contract', 'freelance'] as const;
export const FUNCTION_TAGS = [
  'ai-ml',
  'growth',
  'research',
  'ops',
  'zero-to-one',
  'design',
  'data',
  'gtm',
] as const;
export const EXTRA_KINDS = [
  'award',
  'certification',
  'leadership',
  'publication',
  'other',
] as const;
export const ROLE_FAMILIES = [
  'ai_pm',
  'pm',
  'growth',
  'engineering',
  'data',
  'design',
  'analyst',
  'ops',
  'other',
] as const;

export const roleInput = z.object({
  company: z.string().trim().min(1, 'Company is required'),
  title: z.string().trim().min(1, 'Title is required'),
  location: optionalText,
  startDate: isoDate,
  endDate: optionalDate,
  employmentType: nullableEnum(EMPLOYMENT_TYPES),
  companyContext: optionalText,
});
export type RoleInput = z.input<typeof roleInput>;

export const projectInput = z.object({
  roleId: nullableUuid,
  name: z.string().trim().min(1, 'Name is required'),
  oneLiner: optionalText,
  ownership: optionalText,
  proofUrl: optionalText,
  isSideProject: z.boolean().default(false),
  startDate: optionalDate,
  endDate: optionalDate,
});
export type ProjectInput = z.input<typeof projectInput>;

export const achievementInput = z.object({
  projectId: nullableUuid,
  situation: optionalText,
  action: z.string().trim().min(1, 'Describe what you did'),
  result: optionalText,
  metricValue: optionalText,
  metricConfidence: z.preprocess(
    (v) => (v === '' || v == null ? 'none' : v),
    z.enum(METRIC_CONFIDENCE),
  ),
  skills: tagList,
  tools: tagList,
  functionTags: tagList,
  domainTags: tagList,
  senioritySignals: tagList,
  rawNotes: optionalText,
});
export type AchievementInput = z.input<typeof achievementInput>;

export const educationInput = z.object({
  institution: optionalText,
  degree: optionalText,
  field: optionalText,
  startDate: optionalDate,
  endDate: optionalDate,
  grade: optionalText,
  highlights: tagList,
});
export type EducationInput = z.input<typeof educationInput>;

export const extraInput = z.object({
  kind: nullableEnum(EXTRA_KINDS),
  title: optionalText,
  issuer: optionalText,
  date: optionalDate,
  description: optionalText,
  tags: tagList,
});
export type ExtraInput = z.input<typeof extraInput>;

export const profileInput = z.object({
  fullName: z.string().trim().min(1, 'Name is required'),
  email: optionalText,
  phone: optionalText,
  location: optionalText,
  links: z
    .array(z.object({ label: z.string().trim().min(1), url: z.string().trim().min(1) }))
    .default([]),
  targetRoleFamilies: z.array(z.enum(ROLE_FAMILIES)).default([]),
  baseSummary: optionalText,
});
export type ProfileInput = z.input<typeof profileInput>;
