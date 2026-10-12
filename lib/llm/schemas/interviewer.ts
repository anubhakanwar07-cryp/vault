import { z } from 'zod';
import { importedAchievement } from './import';

export const proposedAchievement = importedAchievement.extend({
  existing_id: z
    .string()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});
export type ProposedAchievement = z.output<typeof proposedAchievement>;

export const interviewerOutput = z.discriminatedUnion('done', [
  z.object({ done: z.literal(false), question: z.string().trim().min(1) }),
  z.object({ done: z.literal(true), achievements: z.array(proposedAchievement).min(1) }),
]);
export type InterviewerOutput = z.output<typeof interviewerOutput>;

export const chatMessage = z.object({
  role: z.enum(['assistant', 'user']),
  content: z.string().max(4000),
});
export type ChatMessage = z.output<typeof chatMessage>;
