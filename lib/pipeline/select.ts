// Stage 5 (SPEC §7.6, reworked): deterministic, pure selection of what appears on the resume.
// No LLM, no I/O. Same inputs → same output, regardless of input order.
//
// Stage A picks the MAX_PROJECTS most relevant projects for the JD by their project-level score
// (score_projects). Stage B picks bullets inside those projects only, by rank budget, preferring a
// different JD requirement for each bullet in a project.
import type {
  AchievementRecord,
  EvidenceMatrix,
  ProjectScores,
  Requirement,
  Selection,
  SelectedProject,
} from './types';

export const METRIC_BONUS = 1.15;
export const REDUNDANCY_WEIGHT = 0.3;
/** Tag overlap at which two bullets count as near-identical and never both appear. */
export const NEAR_DUPLICATE = 0.8;
/** Bullets for the 1st, 2nd and 3rd ranked project (8 in total). */
export const BULLETS_BY_RANK = [3, 3, 2] as const;
/** A bullet only "covers" a requirement for the different-requirement rule at this score or above. */
export const MIN_FRESH_SCORE = 2;
const GAP_YEARS = 3;

type Role = NonNullable<AchievementRecord['role']>;

export type SelectInput = {
  requirements: Requirement[];
  matrix: EvidenceMatrix;
  /** Candidate achievements; only those in the chosen projects can be picked. */
  records: AchievementRecord[];
  /** Project-level relevance for the JD, keyed by project id (Stage A). */
  projectScores: ProjectScores;
  /** Every role in the vault, so recent roles without a chosen project still appear on the timeline. */
  roles?: Role[];
  today?: Date;
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

/** The requirement this bullet proves best (weight × score, then id), or null if it proves none. */
function topRequirement(id: string, reqs: Requirement[], m: EvidenceMatrix): string | null {
  let best: string | null = null;
  let bestV = 0;
  for (const r of reqs) {
    const v = r.weight * scoreOf(m, id, r.id);
    if (v > bestV) {
      bestV = v;
      best = r.id;
    }
  }
  return best;
}

const maxScore = (id: string, reqs: Requirement[], m: EvidenceMatrix) =>
  Math.max(0, ...reqs.map((r) => scoreOf(m, id, r.id)));

export function select(input: SelectInput): Selection {
  const today = input.today ?? new Date();
  const reqs = [...input.requirements].sort((a, b) => a.id.localeCompare(b.id));
  // Stable order independent of input order.
  const records = [...input.records]
    .filter((r) => r.project)
    .sort((a, b) => a.id.localeCompare(b.id));
  const value = new Map(records.map((r) => [r.id, baseValue(r, reqs, input.matrix, today)]));
  const tags = new Map(records.map((r) => [r.id, tagSet(r)]));

  // ---- Stage A: the top projects by project-level relevance.
  const ranked = rankProjects(
    input.projectScores,
    reqs,
    records.map((r) => r.project!.id),
  );

  // ---- Stage B: bullets inside the chosen projects only.
  const picked: string[] = [];
  const pickValue: Record<string, number> = {};
  const redundancy = (id: string) =>
    picked.reduce((mx, p) => Math.max(mx, jaccard(tags.get(id)!, tags.get(p)!)), 0);
  const byProject: Record<string, string[]> = {};

  ranked.forEach((pid, rank) => {
    const pool = records.filter((r) => r.project!.id === pid).map((r) => r.id);
    const mine: string[] = [];
    const coveredHere = new Set<string>();
    while (mine.length < (BULLETS_BY_RANK[rank] ?? 0)) {
      const candidates = pool.filter((id) => !mine.includes(id) && redundancy(id) < NEAR_DUPLICATE);
      if (candidates.length === 0) break;
      const adjusted = (id: string) => value.get(id)! * (1 - REDUNDANCY_WEIGHT * redundancy(id));
      // Prefer a bullet proving a requirement this project hasn't shown yet. A repeat is allowed
      // only when no such bullet scores ≥ MIN_FRESH_SCORE.
      const fresh = candidates.filter((id) => {
        const top = topRequirement(id, reqs, input.matrix);
        return (
          top !== null &&
          !coveredHere.has(top) &&
          maxScore(id, reqs, input.matrix) >= MIN_FRESH_SCORE
        );
      });
      let options = fresh.length ? fresh : candidates.filter((id) => adjusted(id) > 0);
      // Every chosen project shows at least one bullet.
      if (options.length === 0 && mine.length === 0) options = candidates;
      if (options.length === 0) break;
      const best = options.reduce((a, b) =>
        adjusted(b) > adjusted(a) || (adjusted(b) === adjusted(a) && b < a) ? b : a,
      );
      pickValue[best] = adjusted(best);
      mine.push(best);
      picked.push(best);
      const top = topRequirement(best, reqs, input.matrix);
      if (top) coveredHere.add(top);
    }
    byProject[pid] = mine;
  });

  // ---- Page structure. Work projects sit under their role (roles reverse-chronological, projects
  // by rank); side projects follow by rank.
  const recordOf = new Map(records.map((r) => [r.id, r]));
  const chosen = ranked.filter((pid) => byProject[pid]!.length > 0);
  const roleOf = (pid: string) => recordOf.get(byProject[pid]![0]!)!.role;
  const allRoles = new Map<string, Role>();
  for (const r of input.roles ?? []) allRoles.set(r.id, r);
  for (const r of records) if (r.role) allRoles.set(r.role.id, r.role);

  const workRoles = new Set(
    chosen
      .map(roleOf)
      .filter((r): r is Role => !!r)
      .map((r) => r.id),
  );
  // SPEC-QUESTION: §7.6 gives an uncovered recent role its best bullet. That would add a 4th project,
  // so such roles appear title-and-dates only (no bullets) to keep the timeline honest.
  const gapRoles = [...allRoles.values()].filter(
    (role) =>
      !workRoles.has(role.id) &&
      (role.endDate === null || today.getTime() - Date.parse(role.endDate) <= GAP_YEARS * YEAR_MS),
  );
  const roleOrder = [...workRoles, ...gapRoles.map((r) => r.id)].sort((a, b) => {
    const ra = allRoles.get(a)!;
    const rb = allRoles.get(b)!;
    return rb.startDate.localeCompare(ra.startDate) || a.localeCompare(b);
  });
  const projectsOf = (pids: string[]): SelectedProject[] =>
    pids.map((projectId) => ({ projectId, achievementIds: byProject[projectId]! }));

  const coverage: Selection['coverage'] = {};
  for (const r of reqs) {
    let bestScore = 0;
    let achievementId: string | null = null;
    for (const id of picked) {
      const s = scoreOf(input.matrix, id, r.id);
      if (s > bestScore) {
        bestScore = s;
        achievementId = id;
      }
    }
    coverage[r.id] = { bestScore, achievementId };
  }

  return {
    roles: roleOrder.map((roleId) =>
      workRoles.has(roleId)
        ? { roleId, projects: projectsOf(chosen.filter((pid) => roleOf(pid)?.id === roleId)) }
        : { roleId, projects: [], gapFill: true as const },
    ),
    sideProjects: projectsOf(chosen.filter((pid) => !roleOf(pid))),
    coverage,
    gaps: reqs.filter((r) => r.kind === 'must' && coverage[r.id]!.bestScore < 2).map((r) => r.id),
    pickValue,
    rankedProjects: chosen,
  };
}

/** Product rule: a tailored resume shows only this many projects (work and side projects compete). */
export const MAX_PROJECTS = 3;

/**
 * Stage A: the top MAX_PROJECTS projects by project-level score. On a score tie, prefer the project
 * proving a must-have no already-chosen project proves (most uncovered must-have weight first), then id.
 * Only `eligible` projects (ones with achievements to show) are considered.
 */
export function rankProjects(
  scores: ProjectScores,
  requirements: Requirement[],
  eligible: Iterable<string>,
  max = MAX_PROJECTS,
): string[] {
  const must = new Map(requirements.filter((r) => r.kind === 'must').map((r) => [r.id, r.weight]));
  const remaining = [...new Set(eligible)].sort();
  const chosen: string[] = [];
  const covered = new Set<string>();
  const scoreOfProject = (id: string) => scores[id]?.score ?? 0;
  const newMustWeight = (id: string) =>
    (scores[id]?.requirementsProven ?? [])
      .filter((r) => must.has(r) && !covered.has(r))
      .reduce((s, r) => s + must.get(r)!, 0);
  while (chosen.length < max && remaining.length) {
    remaining.sort(
      (a, b) =>
        scoreOfProject(b) - scoreOfProject(a) ||
        newMustWeight(b) - newMustWeight(a) ||
        a.localeCompare(b),
    );
    const next = remaining.shift()!;
    chosen.push(next);
    for (const r of scores[next]?.requirementsProven ?? []) covered.add(r);
  }
  return chosen;
}

/** All achievement ids in a selection, in page order. */
export function selectedIds(sel: Selection): string[] {
  return [
    ...sel.roles.flatMap((r) => r.projects.flatMap((p) => p.achievementIds)),
    ...sel.sideProjects.flatMap((p) => p.achievementIds),
  ];
}
