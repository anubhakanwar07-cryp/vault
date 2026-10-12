import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/lib/db/client';
import { achievements, projects, roles } from '@/lib/db/schema';
import type { AchievementRecord } from './types';

/** Loads full AchievementRecords (achievement + project + role) for the given ids, inside an RLS transaction. */
export async function loadRecords(tx: Tx, ids: string[]): Promise<AchievementRecord[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ a: achievements, p: projects, r: roles })
    .from(achievements)
    .leftJoin(projects, eq(projects.id, achievements.projectId))
    .leftJoin(roles, eq(roles.id, achievements.roleId))
    .where(and(inArray(achievements.id, ids), eq(achievements.isArchived, false)));
  return rows.map(({ a, p, r }) => ({
    id: a.id,
    situation: a.situation,
    action: a.action,
    result: a.result,
    metricValue: a.metricValue,
    metricConfidence: a.metricConfidence,
    skills: a.skills,
    tools: a.tools,
    functionTags: a.functionTags,
    domainTags: a.domainTags,
    senioritySignals: a.senioritySignals,
    rawNotes: a.rawNotes,
    project: p
      ? {
          id: p.id,
          name: p.name,
          oneLiner: p.oneLiner,
          ownership: p.ownership,
          proofUrl: p.proofUrl,
          isSideProject: p.isSideProject,
          startDate: p.startDate,
          endDate: p.endDate,
        }
      : null,
    role: r
      ? {
          id: r.id,
          title: r.title,
          company: r.company,
          location: r.location,
          startDate: r.startDate,
          endDate: r.endDate,
        }
      : null,
  }));
}
