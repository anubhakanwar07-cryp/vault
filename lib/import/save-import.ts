import 'server-only';
import { eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { achievements, education, extras, profiles, projects, roles } from '@/lib/db/schema';
import type { ImportedProject, ImportResumeOutput } from '@/lib/llm/schemas/import';
import {
  achievementInput,
  educationInput,
  extraInput,
  projectInput,
  roleInput,
} from '@/lib/llm/schemas/vault';

export type ImportCounts = {
  roles: number;
  projects: number;
  mergedProjects: number;
  achievements: number;
  education: number;
  extras: number;
};

export type SaveImportResult =
  { ok: true; achievementIds: string[]; counts: ImportCounts } | { ok: false; error: string };

const projectValues = (p: ImportedProject, roleId: string | null) =>
  projectInput.parse({
    roleId,
    name: p.name,
    oneLiner: p.one_liner,
    ownership: p.ownership,
    proofUrl: p.proof_url,
    isSideProject: roleId === null,
    startDate: p.start_date,
    endDate: p.end_date,
  });

const achievementValues = (a: ImportedProject['achievements'][number]) =>
  achievementInput.parse({
    situation: a.situation,
    action: a.action,
    result: a.result,
    metricValue: a.metric_value,
    metricConfidence: a.metric_confidence,
    skills: a.skills,
    tools: a.tools,
    functionTags: a.function_tags,
    domainTags: a.domain_tags,
    senioritySignals: a.seniority_signals,
  });

/**
 * Writes a reviewed import to the vault in one transaction. Items with existing_role_id /
 * existing_project_id are attached to those rows instead of creating duplicates.
 * Existing profile fields are never overwritten.
 */
export async function saveImport(
  userId: string,
  draft: ImportResumeOutput,
): Promise<SaveImportResult> {
  const missingStart = draft.roles.filter((r) => !r.existing_role_id && !r.start_date);
  if (missingStart.length > 0) {
    return {
      ok: false,
      error: `Add a start date for: ${missingStart.map((r) => `${r.title} at ${r.company}`).join(', ')}.`,
    };
  }

  // Validate everything up front so a bad row can't leave a half-written import.
  const roleRows = draft.roles.map((r) => ({
    existingRoleId: r.existing_role_id,
    role: r.existing_role_id
      ? null
      : roleInput.parse({
          company: r.company,
          title: r.title,
          location: r.location,
          startDate: r.start_date,
          endDate: r.end_date,
          employmentType: r.employment_type,
          companyContext: r.company_context,
        }),
    projects: r.projects.map((p) => ({ p, achs: p.achievements.map(achievementValues) })),
  }));
  const sideRows = draft.side_projects.map((p) => ({
    p,
    achs: p.achievements.map(achievementValues),
  }));
  const eduRows = draft.education.map((e) =>
    educationInput.parse({
      institution: e.institution,
      degree: e.degree,
      field: e.field,
      startDate: e.start_date,
      endDate: e.end_date,
      grade: e.grade,
      highlights: e.highlights,
    }),
  );
  const extraRows = draft.extras
    .filter((x) => x.title || x.description)
    .map((x) =>
      extraInput.parse({
        kind: x.kind,
        title: x.title,
        issuer: x.issuer,
        date: x.date,
        description: x.description,
      }),
    );

  return withUser(userId, async (tx) => {
    const achievementIds: string[] = [];
    const counts: ImportCounts = {
      roles: 0,
      projects: 0,
      mergedProjects: 0,
      achievements: 0,
      education: eduRows.length,
      extras: extraRows.length,
    };

    const insertProject = async (
      p: ImportedProject,
      achs: ReturnType<typeof achievementValues>[],
      roleId: string | null,
    ) => {
      let projectId: string;
      let projectRoleId = roleId;
      if (p.existing_project_id) {
        // RLS means we only ever see our own rows; a missing row is a stale or foreign id.
        const [existing] = await tx
          .select({ id: projects.id, roleId: projects.roleId })
          .from(projects)
          .where(eq(projects.id, p.existing_project_id));
        if (!existing) throw new Error('Project to merge into was not found');
        projectId = existing.id;
        projectRoleId = existing.roleId;
        counts.mergedProjects++;
      } else {
        const [proj] = await tx
          .insert(projects)
          .values({ userId, ...projectValues(p, roleId) })
          .returning({ id: projects.id });
        projectId = proj!.id;
        counts.projects++;
      }
      if (achs.length === 0) return;
      const rows = await tx
        .insert(achievements)
        .values(achs.map((a) => ({ userId, ...a, projectId, roleId: projectRoleId })))
        .returning({ id: achievements.id });
      achievementIds.push(...rows.map((r) => r.id));
    };

    for (const { existingRoleId, role, projects: projs } of roleRows) {
      let roleId: string;
      if (existingRoleId) {
        const [existing] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.id, existingRoleId));
        if (!existing) throw new Error('Role to merge into was not found');
        roleId = existing.id;
      } else {
        const [r] = await tx
          .insert(roles)
          .values({ userId, ...role! })
          .returning({ id: roles.id });
        roleId = r!.id;
        counts.roles++;
      }
      for (const { p, achs } of projs) await insertProject(p, achs, roleId);
    }
    for (const { p, achs } of sideRows) await insertProject(p, achs, null);
    if (eduRows.length) await tx.insert(education).values(eduRows.map((e) => ({ userId, ...e })));
    if (extraRows.length) await tx.insert(extras).values(extraRows.map((x) => ({ userId, ...x })));

    // Profile: create if missing; otherwise only fill empty fields.
    const imported = draft.profile;
    const [existing] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
    if (!existing && imported.full_name) {
      await tx.insert(profiles).values({
        userId,
        fullName: imported.full_name,
        email: imported.email,
        phone: imported.phone,
        location: imported.location,
        links: imported.links,
      });
    } else if (existing) {
      await tx
        .update(profiles)
        .set({
          email: existing.email ?? imported.email,
          phone: existing.phone ?? imported.phone,
          location: existing.location ?? imported.location,
          links: existing.links.length ? existing.links : imported.links,
        })
        .where(eq(profiles.userId, userId));
    }

    counts.achievements = achievementIds.length;
    return { ok: true as const, achievementIds, counts };
  });
}
