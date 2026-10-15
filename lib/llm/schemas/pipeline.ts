import { z } from 'zod';

export const rewriteOutput = z.object({ bullet: z.string().trim().min(10) });

export const scoreProjectsOutput = z.object({
  projects: z.array(
    z.object({
      project_id: z.string(),
      score: z.coerce
        .number()
        .catch(0)
        .transform((n) => Math.min(10, Math.max(0, Math.round(n)))),
      requirements_proven: z.array(z.string()).default([]),
      reason: z.string().trim().default(''),
    }),
  ),
});
export type ScoreProjectsOutput = z.output<typeof scoreProjectsOutput>;

export const verifyOutput = z.object({
  results: z.array(
    z.object({
      line_id: z.string(),
      claims: z
        .array(
          z.object({
            claim: z.string(),
            verdict: z.enum(['supported', 'unsupported']).catch('unsupported'),
            why: z.string().default(''),
          }),
        )
        .default([]),
    }),
  ),
});

export const recruiterSimOutput = z.object({
  ten_second_impression: z.string(),
  shortlist: z.boolean(),
  score: z.coerce.number().min(1).max(10),
  strongest_line: z.string(),
  weakest_line: z.string(),
  weakest_line_critique: z.string(),
  missing_for_this_role: z.array(z.string()).default([]),
  would_ask_in_interview: z.array(z.string()).default([]),
});
export type RecruiterSim = z.output<typeof recruiterSimOutput>;
