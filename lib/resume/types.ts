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
  headline: z.string(),
  summary: z.string(),
  experience: z.array(
    z.object({
      roleId: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string(),
      end: z.string().nullable(),
      bullets: z.array(bullet),
      projects: z.array(z.object({ name: z.string(), bullets: z.array(bullet) })).optional(),
    }),
  ),
  projects: z.array(
    z.object({
      projectId: z.string(),
      name: z.string(),
      url: z.string().nullable().optional(),
      bullets: z.array(bullet),
    }),
  ),
  skills: z.array(z.string()),
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
