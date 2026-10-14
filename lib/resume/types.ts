// ResumeDoc and MatchReport (SPEC §7.8) — stored in resumes.content / resumes.match_report.
import { z } from 'zod';

const bullet = z.object({ bulletId: z.string(), text: z.string() });

export const resumeDoc = z.object({
  header: z.object({
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    location: z.string().nullable(),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  /** Unused since Phase 8 (the template has no summary); kept so older stored resumes still parse. */
  headline: z.string().default(''),
  summary: z.string().default(''),
  experience: z.array(
    z.object({
      roleId: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string(),
      end: z.string().nullable(),
      bullets: z.array(bullet),
      projects: z
        .array(
          z.object({
            name: z.string(),
            oneLiner: z.string().nullable().optional(),
            bullets: z.array(bullet),
          }),
        )
        .optional(),
    }),
  ),
  projects: z.array(
    z.object({
      projectId: z.string(),
      name: z.string(),
      url: z.string().nullable().optional(),
      start: z.string().nullable().optional(),
      end: z.string().nullable().optional(),
      bullets: z.array(bullet),
    }),
  ),
  skills: z.array(z.string()),
  /** Labelled skill lines (Phase 8). Older resumes have only the flat `skills` list. */
  skillGroups: z.array(z.object({ label: z.string(), items: z.array(z.string()) })).optional(),
  /** JD terms the template bolds where a line already contains them (SPEC §11). */
  emphasis: z.array(z.string()).optional(),
  education: z.array(
    z.object({
      institution: z.string().nullable(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      grade: z.string().nullable(),
    }),
  ),
  extras: z.array(
    z.object({
      kind: z.string().nullable(),
      title: z.string().nullable(),
      issuer: z.string().nullable(),
      date: z.string().nullable(),
      description: z.string().nullable().optional(),
    }),
  ),
});
export type ResumeDoc = z.output<typeof resumeDoc>;

const coverageRow = z.object({
  reqId: z.string(),
  req: z.string(),
  weight: z.number(),
  bestScore: z.number(),
  coveredBy: z.string().nullable(),
});

export const matchReport = z.object({
  mustHaveCoverage: z.array(coverageRow),
  niceToHaveCoverage: z.array(coverageRow),
  coveragePercent: z.number(),
  keywords: z.array(z.object({ term: z.string(), used: z.boolean(), where: z.array(z.string()) })),
  gaps: z.array(z.object({ reqId: z.string(), req: z.string(), suggestion: z.string() })),
  knockoutWarnings: z.array(z.string()),
  fallbackBullets: z.array(z.string()),
  /** Every scored candidate from the run (for Swap and per-bullet rewrites). Not in SPEC's type; additive. */
  candidates: z
    .array(
      z.object({
        achievementId: z.string(),
        value: z.number(),
        scores: z.record(z.string(), z.number()),
      }),
    )
    .default([]),
});
export type MatchReport = z.output<typeof matchReport>;

/** Every bullet in page order with its section. */
export function allBullets(
  doc: ResumeDoc,
): { bulletId: string; text: string; section: 'experience' | 'projects' }[] {
  return [
    ...doc.experience.flatMap((e) =>
      [...e.bullets, ...(e.projects ?? []).flatMap((p) => p.bullets)].map((b) => ({
        ...b,
        section: 'experience' as const,
      })),
    ),
    ...doc.projects.flatMap((p) => p.bullets.map((b) => ({ ...b, section: 'projects' as const }))),
  ];
}
