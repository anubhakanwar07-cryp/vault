import { describe, expect, it } from 'vitest';
import { fitToOnePage, nextBulletToDrop } from '@/lib/pipeline/fit';
import {
  BULLETS_BY_RANK,
  MAX_PROJECTS,
  metricBonus,
  rankProjects,
  recencyFactor,
  select,
  selectedIds,
} from '@/lib/pipeline/select';
import type {
  AchievementRecord,
  EvidenceMatrix,
  ProjectScores,
  Requirement,
} from '@/lib/pipeline/types';

const today = new Date('2026-01-01');

function rec(
  id: string,
  o: {
    role?: string | null;
    roleStart?: string;
    roleEnd?: string | null;
    project?: string;
    tags?: string[];
    metric?: boolean;
  } = {},
): AchievementRecord {
  const roleId = o.role === undefined ? 'R1' : o.role;
  return {
    id,
    situation: null,
    action: `did ${id}`,
    result: null,
    metricValue: o.metric ? '10%' : null,
    metricConfidence: o.metric ? 'exact' : 'none',
    skills: o.tags ?? [id],
    tools: [],
    functionTags: [],
    domainTags: [],
    senioritySignals: [],
    rawNotes: null,
    project: {
      id: o.project ?? `P-${roleId ?? 'side'}`,
      name: 'p',
      oneLiner: null,
      ownership: null,
      proofUrl: null,
      isSideProject: roleId === null,
      startDate: '2020-01-01',
      endDate: roleId === null ? '2025-06-01' : null,
    },
    role: roleId
      ? {
          id: roleId,
          title: 't',
          company: 'c',
          location: null,
          startDate: o.roleStart ?? '2023-01-01',
          endDate: o.roleEnd === undefined ? null : o.roleEnd,
        }
      : null,
  };
}

const M: Requirement[] = [
  { id: 'm1', req: 'must 1', weight: 5, kind: 'must' },
  { id: 'm2', req: 'must 2', weight: 3, kind: 'must' },
  { id: 'n1', req: 'nice 1', weight: 1, kind: 'nice' },
];

function matrix(entries: [string, string, number][]): EvidenceMatrix {
  const m: EvidenceMatrix = {};
  for (const [a, r, s] of entries) (m[a] ??= {})[r] = { score: s as 0 | 1 | 2 | 3, reason: '' };
  return m;
}

describe('recencyFactor / metricBonus', () => {
  it('scores current, recent and older roles', () => {
    expect(recencyFactor(rec('a', { roleEnd: null }), today)).toBe(1);
    expect(recencyFactor(rec('a', { roleEnd: '2024-06-01' }), today)).toBe(0.9);
    expect(recencyFactor(rec('a', { roleEnd: '2020-06-01' }), today)).toBe(0.75);
  });
  it('rewards a stated metric', () => {
    expect(metricBonus(rec('a', { metric: true }))).toBe(1.15);
    expect(metricBonus(rec('a'))).toBe(1);
  });
});

const ps = (entries: [string, number, string[]?][]): ProjectScores =>
  Object.fromEntries(
    entries.map(([id, score, proven]) => [
      id,
      { score, requirementsProven: proven ?? [], reason: '' },
    ]),
  );

/** n achievements in project `pid`, each proving a different requirement at score 3. */
function project(pid: string, n: number, o: { role?: string | null } = {}) {
  const reqs = ['m1', 'm2', 'n1', 'm1', 'm2'];
  const records = Array.from({ length: n }, (_, i) =>
    rec(`${pid}-${i}`, { project: pid, role: o.role, tags: [`${pid}-${i}`] }),
  );
  const entries = records.map(
    (r, i) => [r.id, reqs[i % reqs.length]!, 3] as [string, string, number],
  );
  return { records, entries };
}

const projectsOnPage = (s: ReturnType<typeof select>) => [
  ...s.roles.flatMap((r) => r.projects),
  ...s.sideProjects,
];

describe('rankProjects (Stage A)', () => {
  it('takes the top MAX_PROJECTS by project score', () => {
    const scores = ps([
      ['A', 9],
      ['B', 2],
      ['C', 7],
      ['D', 8],
      ['E', 5],
    ]);
    expect(rankProjects(scores, M, ['A', 'B', 'C', 'D', 'E'])).toEqual(['A', 'D', 'C']);
    expect(MAX_PROJECTS).toBe(3);
  });
  it('breaks ties toward a project proving a must-have nobody chosen proves yet', () => {
    const scores = ps([
      ['A', 8, ['m1']],
      ['B', 6, ['m1']],
      ['C', 6, ['m2']],
    ]);
    expect(rankProjects(scores, M, ['A', 'B', 'C'], 2)).toEqual(['A', 'C']);
  });
  it('only considers eligible projects and is order-independent', () => {
    const scores = ps([
      ['A', 9],
      ['B', 8],
      ['C', 7],
    ]);
    expect(rankProjects(scores, M, ['C', 'B'])).toEqual(['B', 'C']);
  });
});

describe('select (Stage B)', () => {
  it('shows exactly 3 projects with a 3/3/2 bullet budget', () => {
    const parts = ['P1', 'P2', 'P3', 'P4', 'P5'].map((p) => project(p, 5));
    const s = select({
      requirements: M,
      matrix: matrix(parts.flatMap((p) => p.entries)),
      records: parts.flatMap((p) => p.records),
      projectScores: ps([
        ['P1', 9],
        ['P2', 8],
        ['P3', 7],
        ['P4', 6],
        ['P5', 5],
      ]),
      today,
    });
    expect(s.rankedProjects).toEqual(['P1', 'P2', 'P3']);
    expect(projectsOnPage(s)).toHaveLength(3);
    const counts = s.rankedProjects.map(
      (pid) => projectsOnPage(s).find((p) => p.projectId === pid)!.achievementIds.length,
    );
    expect(counts).toEqual([...BULLETS_BY_RANK]);
    expect(selectedIds(s)).toHaveLength(8);
  });

  it('lets work and side projects compete for the same slots', () => {
    const work = project('W', 3);
    const side = project('S', 3, { role: null });
    const other = project('O', 3);
    const s = select({
      requirements: M,
      matrix: matrix([...work.entries, ...side.entries, ...other.entries]),
      records: [...work.records, ...side.records, ...other.records],
      projectScores: ps([
        ['S', 9],
        ['W', 4],
        ['O', 7],
      ]),
      today,
    });
    expect(s.rankedProjects).toEqual(['S', 'O', 'W']);
    expect(s.sideProjects.map((p) => p.projectId)).toEqual(['S']);
    expect(s.sideProjects[0]!.achievementIds).toHaveLength(3);
  });

  it('a project matching only on a tool name loses to one matching on function', () => {
    // "TOOL" achievements score high per requirement (they literally say SQL), but the project-level
    // judgement says it only shares a tool name; "FUNC" proves the job's purpose.
    const tool = project('TOOL', 3);
    const func = project('FUNC', 3);
    const s = select({
      requirements: M,
      matrix: matrix([
        ...tool.entries,
        ...func.entries.map(([a, r]) => [a, r, 2] as [string, string, number]),
      ]),
      records: [...tool.records, ...func.records],
      projectScores: ps([
        ['TOOL', 3],
        ['FUNC', 8],
      ]),
      today,
    });
    expect(s.rankedProjects[0]).toBe('FUNC');
  });

  it('gives each bullet in a project a different requirement when alternatives exist', () => {
    // a, b, c all best prove m1; d proves m2, e proves n1 — so the project shows a, d, e.
    const records = ['a', 'b', 'c', 'd', 'e'].map((id) => rec(id, { project: 'P', tags: [id] }));
    const s = select({
      requirements: M,
      matrix: matrix([
        ['a', 'm1', 3],
        ['b', 'm1', 3],
        ['c', 'm1', 3],
        ['d', 'm2', 2],
        ['e', 'n1', 2],
      ]),
      records,
      projectScores: ps([['P', 9]]),
      today,
    });
    expect(projectsOnPage(s)[0]!.achievementIds.sort()).toEqual(['a', 'd', 'e']);
  });

  it('repeats a requirement only when nothing else in the project scores ≥ 2', () => {
    const records = ['a', 'b', 'c'].map((id) => rec(id, { project: 'P', tags: [id] }));
    const s = select({
      requirements: M,
      matrix: matrix([
        ['a', 'm1', 3],
        ['b', 'm1', 2],
        ['c', 'm2', 1],
      ]),
      records,
      projectScores: ps([['P', 9]]),
      today,
    });
    expect(projectsOnPage(s)[0]!.achievementIds).toEqual(['a', 'b', 'c']);
  });

  it('never shows two near-identical bullets', () => {
    const records = [
      rec('a', { project: 'P', tags: ['x', 'y'] }),
      rec('b', { project: 'P', tags: ['x', 'y'] }),
      rec('c', { project: 'P', tags: ['z'] }),
    ];
    const s = select({
      requirements: M,
      matrix: matrix([
        ['a', 'm1', 3],
        ['b', 'm2', 3],
        ['c', 'n1', 2],
      ]),
      records,
      projectScores: ps([['P', 9]]),
      today,
    });
    const ids = projectsOnPage(s)[0]!.achievementIds;
    expect(ids).toContain('c');
    expect(ids.filter((id) => id === 'a' || id === 'b')).toHaveLength(1);
  });

  it('shows at least one bullet for a chosen project even with weak evidence', () => {
    const records = [rec('a', { project: 'P' }), rec('b', { project: 'Q' })];
    const s = select({
      requirements: M,
      matrix: matrix([['a', 'm1', 3]]),
      records,
      projectScores: ps([
        ['P', 9],
        ['Q', 4],
      ]),
      today,
    });
    expect(projectsOnPage(s).map((p) => p.achievementIds)).toEqual([['a'], ['b']]);
  });

  it('is deterministic regardless of input order', () => {
    const parts = ['P1', 'P2', 'P3', 'P4'].map((p) => project(p, 4));
    const input = {
      requirements: M,
      matrix: matrix(parts.flatMap((p) => p.entries)),
      records: parts.flatMap((p) => p.records),
      projectScores: ps([
        ['P1', 6],
        ['P2', 6],
        ['P3', 6],
        ['P4', 6],
      ]),
      today,
    };
    const a = select(input);
    const b = select({
      ...input,
      records: [...input.records].reverse(),
      requirements: [...M].reverse(),
    });
    expect(b).toEqual(a);
  });

  it('keeps recent roles without a chosen project on the timeline, without adding a 4th project', () => {
    const p = project('P', 3, { role: 'R1' });
    const old = {
      id: 'R0',
      title: 'Analyst',
      company: 'Old',
      location: null,
      startDate: '2021-01-01',
      endDate: '2024-06-01',
    };
    const ancient = { ...old, id: 'RX', startDate: '2015-01-01', endDate: '2018-01-01' };
    const s = select({
      requirements: M,
      matrix: matrix(p.entries),
      records: p.records,
      projectScores: ps([['P', 9]]),
      roles: [old, ancient],
      today,
    });
    expect(s.roles.map((r) => r.roleId)).toEqual(['R1', 'R0']);
    expect(s.roles[1]).toEqual({ roleId: 'R0', projects: [], gapFill: true });
    expect(projectsOnPage(s)).toHaveLength(1);
  });
});

describe('one-page fit', () => {
  const plan = [
    ['a1', 'a2', 'a3'],
    ['b1', 'b2', 'b3'],
    ['c1', 'c2'],
  ];
  it('drops from project #3, then #2, then #1, never below one bullet each', () => {
    const order: string[] = [];
    const dropped = new Set<string>();
    for (let next = nextBulletToDrop(plan, dropped); next; next = nextBulletToDrop(plan, dropped)) {
      order.push(next);
      dropped.add(next);
    }
    expect(order).toEqual(['c2', 'b3', 'b2', 'a3', 'a2']);
  });
  it('stops as soon as the page fits', async () => {
    const res = await fitToOnePage(
      plan.flat(),
      plan,
      async (doc) => doc.length <= 6,
      (doc, id) => doc.filter((x) => x !== id),
    );
    expect(res).toEqual({
      doc: ['a1', 'a2', 'a3', 'b1', 'b2', 'c1'],
      dropped: ['c2', 'b3'],
      fits: true,
    });
  });
  it('reports when one bullet per project still overflows', async () => {
    const res = await fitToOnePage(
      plan.flat(),
      plan,
      async () => false,
      (d, id) => d.filter((x) => x !== id),
    );
    expect(res.fits).toBe(false);
    expect(res.doc).toEqual(['a1', 'b1', 'c1']);
  });
});
