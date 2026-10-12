import 'server-only';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { adminDb, withUser } from '@/lib/db/client';
import {
  achievements,
  applications,
  education,
  extras,
  jobs,
  profiles,
  projects,
  roles,
  styleRules,
  vaultSources,
} from '@/lib/db/schema';
import {
  achievementInput,
  educationInput,
  extraInput,
  profileInput,
  projectInput,
  roleInput,
} from '@/lib/llm/schemas/vault';
import { refreshAchievements } from '@/lib/vault/embed';

type FixtureAchievement = Record<string, unknown> & { key: string };
type FixtureProject = Record<string, unknown> & { key: string; achievements: FixtureAchievement[] };
type Fixture = {
  profile: Record<string, unknown>;
  roles: (Record<string, unknown> & {
    key: string;
    start: string;
    end: string | null;
    projects: FixtureProject[];
  })[];
  sideProjects: FixtureProject[];
  education: Record<string, unknown>[];
  extras: Record<string, unknown>[];
};

export async function loadFixture(path = 'evals/fixtures/vault.json'): Promise<Fixture> {
  return JSON.parse(await readFile(path, 'utf8')) as Fixture;
}

/** Deletes a test user's vault, jobs and applications (system op — bypasses RLS). */
export async function wipeUser(userId: string) {
  const db = adminDb();
  for (const t of [
    applications,
    jobs,
    achievements,
    projects,
    roles,
    education,
    extras,
    vaultSources,
    styleRules,
  ]) {
    await db.delete(t).where(eq(t.userId, userId));
  }
  await db.delete(profiles).where(eq(profiles.userId, userId));
}

/** Seeds the fixture vault into `userId` and returns fixture key → DB id for roles/projects/achievements. */
export async function seedFixtureVault(
  userId: string,
  fixture?: Fixture,
): Promise<Record<string, string>> {
  const fx = fixture ?? (await loadFixture());
  await wipeUser(userId);
  const ids: Record<string, string> = {};

  await withUser(userId, async (tx) => {
    await tx.insert(profiles).values({ userId, ...profileInput.parse(fx.profile) });

    const insertProject = async (p: FixtureProject, roleId: string | null) => {
      const [proj] = await tx
        .insert(projects)
        .values({
          userId,
          ...projectInput.parse({
            ...p,
            roleId,
            startDate: p.start,
            endDate: p.end,
            isSideProject: roleId === null,
          }),
        })
        .returning({ id: projects.id });
      ids[p.key] = proj!.id;
      for (const a of p.achievements) {
        const [row] = await tx
          .insert(achievements)
          .values({ userId, ...achievementInput.parse({ ...a, projectId: proj!.id }), roleId })
          .returning({ id: achievements.id });
        ids[a.key] = row!.id;
      }
    };

    for (const r of fx.roles) {
      const [row] = await tx
        .insert(roles)
        .values({ userId, ...roleInput.parse({ ...r, startDate: r.start, endDate: r.end }) })
        .returning({ id: roles.id });
      ids[r.key] = row!.id;
      for (const p of r.projects) await insertProject(p, row!.id);
    }
    for (const p of fx.sideProjects) await insertProject(p, null);
    for (const e of fx.education) {
      await tx
        .insert(education)
        .values({ userId, ...educationInput.parse({ ...e, startDate: e.start, endDate: e.end }) });
    }
    for (const x of fx.extras) await tx.insert(extras).values({ userId, ...extraInput.parse(x) });
  });

  const achievementIds = Object.entries(ids)
    .filter(([k]) => /^a\d+$/.test(k))
    .map(([, v]) => v);
  const { embeddingError } = await refreshAchievements(userId, achievementIds);
  if (embeddingError) throw new Error(`Embedding failed while seeding: ${embeddingError}`);
  return ids;
}
