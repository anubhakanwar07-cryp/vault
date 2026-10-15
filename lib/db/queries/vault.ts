import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { withUser, type Tx } from '@/lib/db/client';
import {
  achievements,
  education,
  extras,
  profiles,
  projects,
  roles,
  vaultSources,
} from '@/lib/db/schema';
import type {
  achievementInput,
  educationInput,
  extraInput,
  profileInput,
  projectInput,
  roleInput,
} from '@/lib/llm/schemas/vault';
import type { z } from 'zod';

export type Role = typeof roles.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Achievement = typeof achievements.$inferSelect;
export type Education = typeof education.$inferSelect;
export type Extra = typeof extras.$inferSelect;
export type Profile = typeof profiles.$inferSelect;

export type AchievementCard = Omit<Achievement, 'embedding'> & { hasEmbedding: boolean };
export type ProjectNode = Project & { achievements: AchievementCard[] };
export type RoleNode = Role & { projects: ProjectNode[] };
export type VaultTree = {
  roles: RoleNode[];
  sideProjects: ProjectNode[];
  education: Education[];
  extras: Extra[];
};

const cardColumns = {
  id: achievements.id,
  userId: achievements.userId,
  projectId: achievements.projectId,
  roleId: achievements.roleId,
  situation: achievements.situation,
  action: achievements.action,
  result: achievements.result,
  metricValue: achievements.metricValue,
  metricConfidence: achievements.metricConfidence,
  skills: achievements.skills,
  tools: achievements.tools,
  functionTags: achievements.functionTags,
  domainTags: achievements.domainTags,
  senioritySignals: achievements.senioritySignals,
  rawNotes: achievements.rawNotes,
  completenessScore: achievements.completenessScore,
  isArchived: achievements.isArchived,
  createdAt: achievements.createdAt,
  updatedAt: achievements.updatedAt,
};

export async function getVaultTree(userId: string): Promise<VaultTree> {
  return withUser(userId, async (tx) => {
    const [roleRows, projectRows, achRows, eduRows, extraRows] = await Promise.all([
      tx.select().from(roles).orderBy(desc(roles.startDate), asc(roles.sortOrder)),
      tx.select().from(projects).orderBy(desc(projects.startDate), asc(projects.createdAt)),
      tx
        .select({ ...cardColumns, embedding: achievements.embedding })
        .from(achievements)
        .where(eq(achievements.isArchived, false))
        .orderBy(desc(achievements.completenessScore), asc(achievements.createdAt)),
      tx.select().from(education).orderBy(desc(education.endDate)),
      tx.select().from(extras).orderBy(desc(extras.date)),
    ]);

    const achByProject = new Map<string, AchievementCard[]>();
    for (const { embedding, ...a } of achRows) {
      if (!a.projectId) continue;
      const list = achByProject.get(a.projectId) ?? [];
      list.push({ ...a, hasEmbedding: embedding !== null });
      achByProject.set(a.projectId, list);
    }
    const toNode = (p: Project): ProjectNode => ({
      ...p,
      achievements: achByProject.get(p.id) ?? [],
    });

    const projectsByRole = new Map<string, ProjectNode[]>();
    const sideProjects: ProjectNode[] = [];
    for (const p of projectRows) {
      if (p.roleId) {
        const list = projectsByRole.get(p.roleId) ?? [];
        list.push(toNode(p));
        projectsByRole.set(p.roleId, list);
      } else {
        sideProjects.push(toNode(p));
      }
    }

    return {
      roles: roleRows.map((r) => ({ ...r, projects: projectsByRole.get(r.id) ?? [] })),
      sideProjects,
      education: eduRows,
      extras: extraRows,
    };
  });
}

export async function getAchievement(userId: string, id: string) {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ achievement: cardColumns, project: projects, role: roles })
      .from(achievements)
      .leftJoin(projects, eq(projects.id, achievements.projectId))
      .leftJoin(roles, eq(roles.id, achievements.roleId))
      .where(eq(achievements.id, id));
    return row ?? null;
  });
}

export async function getProjectWithAchievements(userId: string, projectId: string) {
  return withUser(userId, async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) return null;
    const role = project.roleId
      ? ((await tx.select().from(roles).where(eq(roles.id, project.roleId)))[0] ?? null)
      : null;
    const achs = await tx
      .select(cardColumns)
      .from(achievements)
      .where(and(eq(achievements.projectId, projectId), eq(achievements.isArchived, false)))
      .orderBy(asc(achievements.createdAt));
    return { project, role, achievements: achs };
  });
}

export async function getProfile(userId: string): Promise<Profile | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
    return row ?? null;
  });
}

// ---------------------------------------------------------------------------
// Mutations. Each takes parsed (output) values from lib/llm/schemas/vault.ts.
// ---------------------------------------------------------------------------

type Out<T extends z.ZodType> = z.output<T>;

export async function upsertProfile(userId: string, data: Out<typeof profileInput>) {
  await withUser(userId, (tx) =>
    tx
      .insert(profiles)
      .values({ userId, ...data })
      .onConflictDoUpdate({ target: profiles.userId, set: data }),
  );
}

/** Thrown when an update matched no row the user owns (stale id, or someone else's). */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** Throws unless `.returning()` gave back a row. */
function updated<T>(rows: T[], what: string): void {
  if (rows.length === 0) throw new NotFoundError(what);
}

export async function saveRole(userId: string, id: string | null, data: Out<typeof roleInput>) {
  return withUser(userId, async (tx) => {
    if (id) {
      updated(
        await tx.update(roles).set(data).where(eq(roles.id, id)).returning({ id: roles.id }),
        'Role',
      );
      return id;
    }
    const [row] = await tx
      .insert(roles)
      .values({ userId, ...data })
      .returning({ id: roles.id });
    return row!.id;
  });
}

export async function saveProject(
  userId: string,
  id: string | null,
  data: Out<typeof projectInput>,
) {
  const values = { ...data, isSideProject: data.roleId === null ? true : data.isSideProject };
  return withUser(userId, async (tx) => {
    // Foreign keys ignore row-level security, so check the role belongs to this user (RLS applies
    // to this select) before linking to it.
    if (values.roleId) {
      const [own] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, values.roleId));
      if (!own) throw new NotFoundError('Role');
    }
    if (id) {
      updated(
        await tx
          .update(projects)
          .set(values)
          .where(eq(projects.id, id))
          .returning({ id: projects.id }),
        'Project',
      );
      // Keep the denormalised role_id on achievements in sync.
      await tx
        .update(achievements)
        .set({ roleId: values.roleId })
        .where(eq(achievements.projectId, id));
      return id;
    }
    const [row] = await tx
      .insert(projects)
      .values({ userId, ...values })
      .returning({ id: projects.id });
    return row!.id;
  });
}

async function roleIdForProject(tx: Tx, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  const [p] = await tx
    .select({ roleId: projects.roleId })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!p) throw new NotFoundError('Project');
  return p.roleId;
}

export async function saveAchievement(
  userId: string,
  id: string | null,
  data: Out<typeof achievementInput>,
) {
  return withUser(userId, async (tx) => {
    const roleId = await roleIdForProject(tx, data.projectId);
    if (id) {
      updated(
        await tx
          .update(achievements)
          .set({ ...data, roleId })
          .where(eq(achievements.id, id))
          .returning({ id: achievements.id }),
        'Achievement',
      );
      return id;
    }
    const [row] = await tx
      .insert(achievements)
      .values({ userId, ...data, roleId })
      .returning({ id: achievements.id });
    return row!.id;
  });
}

export async function saveEducation(
  userId: string,
  id: string | null,
  data: Out<typeof educationInput>,
) {
  return withUser(userId, async (tx) => {
    if (id) {
      updated(
        await tx
          .update(education)
          .set(data)
          .where(eq(education.id, id))
          .returning({ id: education.id }),
        'Education entry',
      );
      return id;
    }
    const [row] = await tx
      .insert(education)
      .values({ userId, ...data })
      .returning({ id: education.id });
    return row!.id;
  });
}

export async function saveExtra(userId: string, id: string | null, data: Out<typeof extraInput>) {
  return withUser(userId, async (tx) => {
    if (id) {
      updated(
        await tx.update(extras).set(data).where(eq(extras.id, id)).returning({ id: extras.id }),
        'Entry',
      );
      return id;
    }
    const [row] = await tx
      .insert(extras)
      .values({ userId, ...data })
      .returning({ id: extras.id });
    return row!.id;
  });
}

export type VaultEntity = 'role' | 'project' | 'achievement' | 'education' | 'extra' | 'source';

export async function deleteVaultItem(userId: string, entity: VaultEntity, id: string) {
  const table = {
    role: roles,
    project: projects,
    achievement: achievements,
    education,
    extra: extras,
    source: vaultSources,
  }[entity];
  await withUser(userId, (tx) => tx.delete(table).where(eq(table.id, id)));
}

/** Achievement ids whose embedding text depends on the given role/project. */
export async function achievementIdsFor(
  userId: string,
  by: { roleId?: string; projectId?: string },
): Promise<string[]> {
  return withUser(userId, async (tx) => {
    const cond = by.roleId
      ? eq(achievements.roleId, by.roleId)
      : by.projectId
        ? eq(achievements.projectId, by.projectId)
        : undefined;
    if (!cond) return [];
    const rows = await tx.select({ id: achievements.id }).from(achievements).where(cond);
    return rows.map((r) => r.id);
  });
}

// ---------------------------------------------------------------------------
// Vault sources (resumes, portfolios, briefs)
// ---------------------------------------------------------------------------

export type VaultSource = typeof vaultSources.$inferSelect;

export async function addVaultSource(
  userId: string,
  src: {
    kind: 'resume' | 'portfolio' | 'brief';
    title?: string | null;
    url?: string | null;
    filePath?: string | null;
    text: string;
  },
): Promise<string> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .insert(vaultSources)
      .values({
        userId,
        kind: src.kind,
        title: src.title ?? null,
        url: src.url ?? null,
        filePath: src.filePath ?? null,
        text: src.text,
      })
      .returning({ id: vaultSources.id }),
  );
  return row!.id;
}

export async function listVaultSources(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: vaultSources.id,
        kind: vaultSources.kind,
        title: vaultSources.title,
        url: vaultSources.url,
        createdAt: vaultSources.createdAt,
        chars: sql<number>`length(${vaultSources.text})`,
      })
      .from(vaultSources)
      .orderBy(desc(vaultSources.createdAt)),
  );
}
