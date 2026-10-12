import { z } from 'zod';

export const rewriteOutput = z.object({ bullet: z.string().trim().min(10) });

export const headlineSummaryOutput = z.object({
  headline: z.string().trim().min(3),
  summary: z.string().trim().min(10),
  source_achievement_ids: z.array(z.string()).default([]),
});

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
