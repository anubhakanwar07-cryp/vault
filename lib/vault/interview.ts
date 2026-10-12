import 'server-only';

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withUser, type Tx } from '@/lib/db/client';
import { getProjectWithAchievements } from '@/lib/db/queries/vault';
import { achievements, projects } from '@/lib/db/schema';
import { checkAchievement, normaliseSource, type ImportFlag } from '@/lib/import/source-check';
import { callLLM } from '@/lib/llm/client';
import * as interviewer from '@/lib/llm/prompts/vaultInterviewer';
import {
  chatMessage,
  interviewerOutput,
  proposedAchievement,
  type ProposedAchievement,
} from '@/lib/llm/schemas/interviewer';
import { achievementInput } from '@/lib/llm/schemas/vault';
import { refreshAchievements } from '@/lib/vault/embed';

export type TurnResult =
  | { done: false; question: string }
  | { done: true; proposals: ProposedAchievement[]; flags: ImportFlag[] };

export async function runInterviewTurn(
  userId: string,
  projectId: string,
  rawMessages: unknown,
  finish: boolean,
): Promise<TurnResult> {
  const messages = z.array(chatMessage).max(40).parse(rawMessages);
  const data = await getProjectWithAchievements(userId, z.uuid().parse(projectId));
  if (!data) throw new Error('Project not found');

  const { project, role, achievements: existing } = data;
  const projectCtx = {
    name: project.name,
    one_liner: project.oneLiner,
    ownership: project.ownership,
    role: role ? `${role.title} at ${role.company}` : 'side project',
  };
  const existingCtx = existing.map((a) => ({
    id: a.id,
    situation: a.situation,
    action: a.action,
    result: a.result,
    metric_value: a.metricValue,
    metric_confidence: a.metricConfidence,
    skills: a.skills,
    tools: a.tools,
  }));

  const out = await callLLM({
    stage: 'interviewer',
    tier: 'strong',
    system: interviewer.system,
    user: interviewer.buildUser({ project: projectCtx, existing: existingCtx, messages, finish }),
    schema: interviewerOutput,
    promptVersion: interviewer.version,
    userId,
    temperature: 0.4,
    maxTokens: 8000,
    timeoutMs: 90_000,
  });
  if (!out.done) return { done: false, question: out.question };

  // Hard rule (§6.4): the model never supplies numbers. Every number must come from the
  // candidate's own answers or the existing records.
  const source = normaliseSource(
    [
      ...messages.filter((m) => m.role === 'user').map((m) => m.content),
      JSON.stringify(existingCtx),
      JSON.stringify(projectCtx),
    ].join('\n'),
  );
  const validIds = new Set(existing.map((a) => a.id));
  const flags: ImportFlag[] = [];
  const proposals = out.achievements.map((a, i) => {
    const checked = checkAchievement(a, source, `achievements.${i}`, flags);
    return {
      ...checked,
      existing_id: a.existing_id && validIds.has(a.existing_id) ? a.existing_id : null,
    };
  });
  return { done: true, proposals, flags };
}

/** Writes accepted proposals (new or updates within this project) and refreshes their embeddings. */
export async function acceptProposals(userId: string, projectId: string, rawProposals: unknown) {
  const pid = z.uuid().parse(projectId);
  const proposals = z.array(proposedAchievement).parse(rawProposals);
  if (proposals.length === 0) return { ids: [] as string[], embeddingError: null };

  const ids = await withUser(userId, async (tx) => {
    const project = await getProjectRoleId(tx, pid);
    const out: string[] = [];
    for (const p of proposals) {
      const values = achievementInput.parse({
        projectId: pid,
        situation: p.situation,
        action: p.action,
        result: p.result,
        metricValue: p.metric_value,
        metricConfidence: p.metric_confidence,
        skills: p.skills,
        tools: p.tools,
        functionTags: p.function_tags,
        domainTags: p.domain_tags,
        senioritySignals: p.seniority_signals,
      });
      if (p.existing_id) {
        const [row] = await tx
          .update(achievements)
          .set({ ...values, roleId: project.roleId })
          .where(and(eq(achievements.id, p.existing_id), eq(achievements.projectId, pid)))
          .returning({ id: achievements.id });
        if (row) out.push(row.id);
      } else {
        const [row] = await tx
          .insert(achievements)
          .values({ userId, ...values, roleId: project.roleId })
          .returning({ id: achievements.id });
        out.push(row!.id);
      }
    }
    return out;
  });

  const { embeddingError } = await refreshAchievements(userId, ids);
  return { ids, embeddingError };
}

async function getProjectRoleId(tx: Tx, projectId: string) {
  const [p] = await tx
    .select({ roleId: projects.roleId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!p) throw new Error('Project not found');
  return p;
}
