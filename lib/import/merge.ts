// Pure helpers for merging an imported draft into an existing vault.
import type { ImportResumeOutput } from '@/lib/llm/schemas/import';

export type ExistingVault = {
  roles: {
    id: string;
    title: string;
    company: string;
    startDate: string;
    endDate: string | null;
    projects: {
      id: string;
      name: string;
      oneLiner: string | null;
      achievements: { action: string }[];
    }[];
  }[];
  sideProjects: {
    id: string;
    name: string;
    oneLiner: string | null;
    achievements: { action: string }[];
  }[];
};

/** Compact summary for the prompt: ids, names and the first words of each achievement. */
export function summariseVault(v: ExistingVault) {
  const proj = (p: ExistingVault['sideProjects'][number]) => ({
    id: p.id,
    name: p.name,
    one_liner: p.oneLiner,
    achievements: p.achievements.map((a) => a.action.slice(0, 100)),
  });
  return {
    roles: v.roles.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      start: r.startDate.slice(0, 7),
      end: r.endDate?.slice(0, 7) ?? 'present',
      projects: r.projects.map(proj),
    })),
    side_projects: v.sideProjects.map(proj),
  };
}

export type MergeInfo = {
  /** role path ("roles.0") → label of the existing role it adds to */
  roleTargets: Record<string, string>;
  /** project path → label of the existing project it adds to */
  projectTargets: Record<string, string>;
  /** achievement paths that look like something already in the vault */
  duplicates: string[];
};

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9%\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );

export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const DUPLICATE_THRESHOLD = 0.55;

/**
 * Drops existing_* ids that aren't in this user's vault (the model must never attach data to
 * rows it can't see) and flags achievements that near-duplicate existing ones.
 */
export function resolveMerge(
  draft: ImportResumeOutput,
  vault: ExistingVault,
): { draft: ImportResumeOutput; merge: MergeInfo } {
  const roleById = new Map(vault.roles.map((r) => [r.id, r]));
  const allProjects = [
    ...vault.roles.flatMap((r) => r.projects.map((p) => ({ ...p, roleId: r.id as string | null }))),
    ...vault.sideProjects.map((p) => ({ ...p, roleId: null as string | null })),
  ];
  const projectById = new Map(allProjects.map((p) => [p.id, p]));
  const allExistingActions = allProjects.flatMap((p) => p.achievements.map((a) => a.action));
  const merge: MergeInfo = { roleTargets: {}, projectTargets: {}, duplicates: [] };

  const fixProject = (
    p: ImportResumeOutput['side_projects'][number],
    path: string,
    roleId: string | null,
  ) => {
    let existingId = p.existing_project_id;
    const target = existingId ? projectById.get(existingId) : undefined;
    // A project can only be merged into one that sits under the same role (or is also a side project).
    if (!target || (roleId !== undefined && target.roleId !== roleId)) existingId = null;
    if (existingId && target) merge.projectTargets[path] = target.name;

    const compareTo =
      existingId && target ? target.achievements.map((a) => a.action) : allExistingActions;
    p.achievements.forEach((a, k) => {
      if (compareTo.some((x) => similarity(x, a.action) >= DUPLICATE_THRESHOLD)) {
        merge.duplicates.push(`${path}.achievements.${k}`);
      }
    });
    return { ...p, existing_project_id: existingId };
  };

  const roles = draft.roles.map((r, i) => {
    const existing = r.existing_role_id ? roleById.get(r.existing_role_id) : undefined;
    const roleId = existing ? existing.id : null;
    if (existing) merge.roleTargets[`roles.${i}`] = `${existing.title} at ${existing.company}`;
    return {
      ...r,
      existing_role_id: roleId,
      // New roles can't contain existing projects.
      projects: r.projects.map((p, j) =>
        roleId
          ? fixProject(p, `roles.${i}.projects.${j}`, roleId)
          : fixProject({ ...p, existing_project_id: null }, `roles.${i}.projects.${j}`, null),
      ),
    };
  });
  const side = draft.side_projects.map((p, j) => fixProject(p, `side_projects.${j}`, null));

  return { draft: { ...draft, roles, side_projects: side }, merge };
}

type DraftProject = ImportResumeOutput['side_projects'][number];
type DraftAchievement = DraftProject['achievements'][number];

const info = (a: DraftAchievement) =>
  (a.metric_value ? 4 : 0) +
  (a.result ? 2 : 0) +
  (a.situation ? 1 : 0) +
  a.skills.length +
  a.tools.length;

export const SAME_ACTION_THRESHOLD = 0.8;

/** Collapses near-identical achievements inside one project, keeping the most informative one. */
export function dedupeWithinProjects(draft: ImportResumeOutput): ImportResumeOutput {
  const dedupe = (p: DraftProject): DraftProject => {
    const kept: DraftAchievement[] = [];
    for (const a of p.achievements) {
      const i = kept.findIndex((k) => similarity(k.action, a.action) >= SAME_ACTION_THRESHOLD);
      if (i === -1) kept.push(a);
      else if (info(a) > info(kept[i]!)) kept[i] = a;
    }
    return { ...p, achievements: kept };
  };
  return {
    ...draft,
    roles: draft.roles.map((r) => ({ ...r, projects: r.projects.map(dedupe) })),
    side_projects: draft.side_projects.map(dedupe),
  };
}
