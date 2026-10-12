import { z } from 'zod';
import { EXTRA_KINDS, METRIC_CONFIDENCE } from './vault';

// Output of the importResume prompt (SPEC §9.8). Lenient on optional fields so a sparse
// resume validates; strictness about facts is enforced afterwards in lib/import/source-check.ts.

const str = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));
const strList = z
  .array(z.string())
  .nullable()
  .optional()
  .transform((xs) => (xs ?? []).map((x) => x.trim()).filter(Boolean));
const date = z
  .string()
  .nullable()
  .optional()
  .transform((v) => {
    const m = v?.trim().match(/^(\d{4})(?:-(\d{2}))?/);
    return m ? `${m[1]}-${m[2] ?? '01'}` : null;
  });

export const importedAchievement = z.object({
  situation: str,
  action: z.string().trim().min(1),
  result: str,
  metric_value: str,
  metric_confidence: z.enum(METRIC_CONFIDENCE).catch('none'),
  skills: strList,
  tools: strList,
  function_tags: strList,
  domain_tags: strList,
  seniority_signals: strList,
});

const optionalId = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const importedProject = z.object({
  existing_project_id: optionalId,
  name: z.string().trim().min(1),
  one_liner: str,
  ownership: str,
  proof_url: str,
  start_date: date,
  end_date: date,
  achievements: z.array(importedAchievement).default([]),
});

export const importedRole = z.object({
  existing_role_id: optionalId,
  company: z.string().trim().min(1),
  title: z.string().trim().min(1),
  location: str,
  start_date: date,
  end_date: date,
  is_current: z.boolean().nullable().optional(),
  employment_type: z.enum(['full-time', 'intern', 'contract', 'freelance']).nullable().catch(null),
  company_context: str,
  projects: z.array(importedProject).default([]),
});

export const importResumeOutput = z.object({
  profile: z
    .object({
      full_name: str,
      email: str,
      phone: str,
      location: str,
      links: z
        .array(z.object({ label: z.string(), url: z.string() }))
        .nullable()
        .optional()
        .transform((v) => v ?? []),
    })
    .default({ full_name: null, email: null, phone: null, location: null, links: [] }),
  roles: z.array(importedRole).default([]),
  side_projects: z.array(importedProject).default([]),
  education: z
    .array(
      z.object({
        institution: str,
        degree: str,
        field: str,
        start_date: date,
        end_date: date,
        grade: str,
        highlights: strList,
      }),
    )
    .default([]),
  extras: z
    .array(
      z.object({
        kind: z.enum(EXTRA_KINDS).nullable().catch('other'),
        title: str,
        issuer: str,
        date: date,
        description: str,
      }),
    )
    .default([]),
  skills: strList,
});

export type ImportResumeOutput = z.output<typeof importResumeOutput>;
export type ImportedRole = ImportResumeOutput['roles'][number];
export type ImportedProject = ImportedRole['projects'][number];
export type ImportedAchievement = ImportedProject['achievements'][number];
