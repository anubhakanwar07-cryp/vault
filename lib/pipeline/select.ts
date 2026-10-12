// Stage 5 (SPEC §7.6): deterministic, pure selection of which achievements appear on the resume.
// No LLM, no I/O. Same inputs → same output, regardless of input order.
import type {
  AchievementRecord,
  EvidenceMatrix,
  Requirement,
  Selection,
  SelectedProject,
} from './types';

export type Budget = {
  maxBullets: number;
  maxRolesWithBullets: number;
  maxProjectsPerRole: number;
  maxBulletsPerProject: number;
  maxSideProjects: number;
  maxBulletsPerSideProject: number;
};

/** SPEC §7.6 budget for page_limit = 1. Side-project bullet cap is ours (SPEC-QUESTION: unspecified). */
export const ONE_PAGE: Budget = {
  maxBullets: 15,
  maxRolesWithBullets: 3,
  maxProjectsPerRole: 2,
  maxBulletsPerProject: 4,
  maxSideProjects: 2,
  maxBulletsPerSideProject: 2,
};

export const METRIC_BONUS = 1.15;
export const REDUNDANCY_WEIGHT = 0.3;
/** Side projects need value ≥ this × median value of picked work bullets (plan default). */
export const SIDE_PROJECT_RATIO = 0.5;
/**
 * Depth-fill candidates need value ≥ this × the best candidate's value, and clear evidence (≥ this
 * score) for at least one must-have. Chosen by replaying stored eval scores (scripts/tune-select.ts):
 * stricter fills raise precision against the golden ideals only slightly but cut recall below the
 * 60% target once LLM scoring variance is accounted for.
 */
export const FILL_MIN_RATIO = 0.25;
export const FILL_MIN_MUST_SCORE = 2;
/** Tag overlap at which two bullets count as near-identical and never both appear. */
export const NEAR_DUPLICATE = 0.8;
const GAP_YEARS = 3;
const EPS = 1e-9;

export type SelectInput = {
  requirements: Requirement[];
  matrix: EvidenceMatrix;
  records: AchievementRecord[];
  budget?: Budget;
  today?: Date;
  /** Override FILL_MIN_RATIO (used by offline tuning). */
  fillMinRatio?: number;
  /** Override FILL_MIN_MUST_SCORE (used by offline tuning). */
  fillMinMustScore?: number;
};

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** 1.0 current role (or ongoing side project), 0.9 ended within 2 years, 0.75 older. */
export function recencyFactor(a: AchievementRecord, today = new Date()): number {
  const ongoing = a.role ? a.role.endDate === null : a.project ? a.project.endDate === null : false;
  if (ongoing && (a.role || a.project?.startDate)) return 1.0;
  const end = a.role?.endDate ?? a.project?.endDate ?? null;
  if (!end) return 0.9;
  return today.getTime() - Date.parse(end) <= 2 * YEAR_MS ? 0.9 : 0.75;
}

export function metricBonus(a: AchievementRecord): number {
  return a.metricConfidence !== 'none' && a.metricValue ? METRIC_BONUS : 1.0;
}

const scoreOf = (m: EvidenceMatrix, a: string, r: string) => m[a]?.[r]?.score ?? 0;

export function baseValue(
  a: AchievementRecord,
  reqs: Requirement[],
  m: EvidenceMatrix,
  today: Date,
): number {
  const raw = reqs.reduce((s, r) => s + r.weight * scoreOf(m, a.id, r.id), 0);
  return raw * recencyFactor(a, today) * metricBonus(a);
}

const tagSet = (a: AchievementRecord) =>
  new Set(
    [...a.skills, ...a.tools, ...a.functionTags, ...a.domainTags].map((t) => t.toLowerCase()),
  );

export function jaccard(x: Set<string>, y: Set<string>): number {
  if (x.size === 0 && y.size === 0) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter++;
  return inter / (x.size + y.size - inter);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function select(input: SelectInput): Selection {
  const budget = input.budget ?? ONE_PAGE;
  const today = input.today ?? new Date();
  const reqs = [...input.requirements].sort((a, b) => a.id.localeCompare(b.id));
  // Stable order independent of input order.
  const records = [...input.records]
    .filter((r) => r.project)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(records.map((r) => [r.id, r]));
  const value = new Map(records.map((r) => [r.id, baseValue(r, reqs, input.matrix, today)]));
  const tags = new Map(records.map((r) => [r.id, tagSet(r)]));

  const picked: string[] = [];
  const pickValue: Record<string, number> = {};
  const best: Record<string, number> = Object.fromEntries(reqs.map((r) => [r.id, 0]));

  const redundancy = (id: string) =>
    picked.reduce((mx, p) => Math.max(mx, jaccard(tags.get(id)!, tags.get(p)!)), 0);

  const fits = (a: AchievementRecord): boolean => {
    if (picked.length >= budget.maxBullets) return false;
    const pid = a.project!.id;
    const inProject = picked.filter((p) => byId.get(p)!.project!.id === pid).length;
    if (a.role) {
      const rolesWithBullets = new Set(picked.map((p) => byId.get(p)!.role?.id).filter(Boolean));
      if (!rolesWithBullets.has(a.role.id) && rolesWithBullets.size >= budget.maxRolesWithBullets)
        return false;
      const projectsInRole = new Set(
        picked
          .filter((p) => byId.get(p)!.role?.id === a.role!.id)
          .map((p) => byId.get(p)!.project!.id),
      );
      if (!projectsInRole.has(pid) && projectsInRole.size >= budget.maxProjectsPerRole)
        return false;
      return inProject < budget.maxBulletsPerProject;
    }
    const sideProjects = new Set(
      picked.filter((p) => !byId.get(p)!.role).map((p) => byId.get(p)!.project!.id),
    );
    if (!sideProjects.has(pid) && sideProjects.size >= budget.maxSideProjects) return false;
    if (inProject >= budget.maxBulletsPerSideProject) return false;
    const workValues = picked.filter((p) => byId.get(p)!.role).map((p) => value.get(p)!);
    return workValues.length === 0 || value.get(a.id)! >= SIDE_PROJECT_RATIO * median(workValues);
  };

  const take = (id: string, v: number) => {
    picked.push(id);
    pickValue[id] = v;
    for (const r of reqs) best[r.id] = Math.max(best[r.id]!, scoreOf(input.matrix, id, r.id));
  };

  // Pass 1 — SPEC §7.6 greedy on marginal requirement coverage.
  for (;;) {
    let bestId: string | null = null;
    let bestMarginal = EPS;
    for (const a of records) {
      if (picked.includes(a.id) || !fits(a) || redundancy(a.id) >= NEAR_DUPLICATE) continue;
      const factor = recencyFactor(a, today) * metricBonus(a);
      const gain = reqs.reduce(
        (s, r) => s + r.weight * Math.max(0, scoreOf(input.matrix, a.id, r.id) - best[r.id]!),
        0,
      );
      const marginal = gain * factor - REDUNDANCY_WEIGHT * redundancy(a.id) * value.get(a.id)!;
      if (
        marginal > bestMarginal + EPS ||
        (Math.abs(marginal - bestMarginal) <= EPS && bestId !== null && a.id < bestId)
      ) {
        bestMarginal = marginal;
        bestId = a.id;
      }
    }
    if (!bestId) break;
    take(bestId, bestMarginal);
  }

  // Pass 2 — depth fill. SPEC-QUESTION: §7.6 stops when nothing adds *coverage*, which can leave a
  // one-page resume with a handful of bullets. We fill the remaining budget with the next most
  // valuable evidence, discounted by overlap with what's already picked.
  const maxValue = Math.max(0, ...value.values());
  for (;;) {
    let bestId: string | null = null;
    let bestScore = EPS;
    for (const a of records) {
      const v = value.get(a.id)!;
      if (
        picked.includes(a.id) ||
        v < (input.fillMinRatio ?? FILL_MIN_RATIO) * maxValue ||
        v <= EPS ||
        !fits(a)
      )
        continue;
      if (redundancy(a.id) >= NEAR_DUPLICATE) continue;
      // Depth fill only adds real evidence for something the JD requires.
      const minMust = input.fillMinMustScore ?? FILL_MIN_MUST_SCORE;
      if (!reqs.some((r) => r.kind === 'must' && scoreOf(input.matrix, a.id, r.id) >= minMust))
        continue;
      const adjusted = v * (1 - REDUNDANCY_WEIGHT * redundancy(a.id));
      if (
        adjusted > bestScore + EPS ||
        (Math.abs(adjusted - bestScore) <= EPS && bestId !== null && a.id < bestId)
      ) {
        bestScore = adjusted;
        bestId = a.id;
      }
    }
    if (!bestId) break;
    // Scale fill picks below every coverage pick so ordering puts coverage first.
    take(bestId, bestScore * 1e-3);
  }

  // Timeline: roles in the last GAP_YEARS with no picks get their single best bullet.
  const roleIds = new Set(picked.map((p) => byId.get(p)!.role?.id).filter((x): x is string => !!x));
  const allRoles = new Map<string, NonNullable<AchievementRecord['role']>>();
  for (const r of records) if (r.role) allRoles.set(r.role.id, r.role);
  const gapRoles = new Set<string>();
  for (const role of [...allRoles.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (roleIds.has(role.id)) continue;
    const recent =
      role.endDate === null || today.getTime() - Date.parse(role.endDate) <= GAP_YEARS * YEAR_MS;
    if (!recent) continue;
    const candidates = records
      .filter((r) => r.role?.id === role.id)
      .sort((a, b) => value.get(b.id)! - value.get(a.id)! || a.id.localeCompare(b.id));
    if (candidates[0]) {
      picked.push(candidates[0].id);
      pickValue[candidates[0].id] = value.get(candidates[0].id)! * 1e-6;
      gapRoles.add(role.id);
    }
  }
  // Keep within the bullet budget by trimming the weakest bullet from projects that have spares.
  while (picked.length > budget.maxBullets) {
    const counts = new Map<string, number>();
    for (const p of picked)
      counts.set(byId.get(p)!.project!.id, (counts.get(byId.get(p)!.project!.id) ?? 0) + 1);
    const removable = picked
      .filter(
        (p) =>
          !gapRoles.has(byId.get(p)!.role?.id ?? '') && counts.get(byId.get(p)!.project!.id)! > 1,
      )
      .sort((a, b) => pickValue[a]! - pickValue[b]! || b.localeCompare(a));
    const drop = removable[0];
    if (!drop) break;
    picked.splice(picked.indexOf(drop), 1);
    delete pickValue[drop];
  }

  // Assemble the Selection, ordered for the page.
  const groupProjects = (ids: string[]): SelectedProject[] => {
    const byProject = new Map<string, string[]>();
    for (const id of ids) {
      const pid = byId.get(id)!.project!.id;
      byProject.set(pid, [...(byProject.get(pid) ?? []), id]);
    }
    return [...byProject.entries()]
      .map(([projectId, achievementIds]) => ({
        projectId,
        achievementIds: achievementIds.sort(
          (a, b) => pickValue[b]! - pickValue[a]! || a.localeCompare(b),
        ),
        total: achievementIds.reduce((s, id) => s + value.get(id)!, 0),
      }))
      .sort((a, b) => b.total - a.total || a.projectId.localeCompare(b.projectId))
      .map(({ projectId, achievementIds }) => ({ projectId, achievementIds }));
  };

  const workIds = picked.filter((p) => byId.get(p)!.role);
  const roleOrder = [...new Set(workIds.map((p) => byId.get(p)!.role!.id))].sort((a, b) => {
    const ra = allRoles.get(a)!;
    const rb = allRoles.get(b)!;
    return rb.startDate.localeCompare(ra.startDate) || a.localeCompare(b);
  });

  const coverage: Selection['coverage'] = {};
  for (const r of reqs) {
    let bestScore = 0;
    let achievementId: string | null = null;
    for (const id of [...picked].sort(
      (a, b) => pickValue[b]! - pickValue[a]! || a.localeCompare(b),
    )) {
      const s = scoreOf(input.matrix, id, r.id);
      if (s > bestScore) {
        bestScore = s;
        achievementId = id;
      }
    }
    coverage[r.id] = { bestScore, achievementId };
  }

  return {
    roles: roleOrder.map((roleId) => ({
      roleId,
      projects: groupProjects(workIds.filter((p) => byId.get(p)!.role!.id === roleId)),
      ...(gapRoles.has(roleId) ? { gapFill: true } : {}),
    })),
    sideProjects: groupProjects(picked.filter((p) => !byId.get(p)!.role)),
    coverage,
    gaps: reqs.filter((r) => r.kind === 'must' && coverage[r.id]!.bestScore < 2).map((r) => r.id),
    pickValue,
  };
}

/** All achievement ids in a selection, in page order. */
export function selectedIds(sel: Selection): string[] {
  return [
    ...sel.roles.flatMap((r) => r.projects.flatMap((p) => p.achievementIds)),
    ...sel.sideProjects.flatMap((p) => p.achievementIds),
  ];
}
