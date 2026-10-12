import { describe, expect, it } from 'vitest';
import { metricBonus, ONE_PAGE, recencyFactor, select, selectedIds } from '@/lib/pipeline/select';
import type { AchievementRecord, EvidenceMatrix, Requirement } from '@/lib/pipeline/types';

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

describe('select', () => {
  it('is deterministic regardless of input order', () => {
    const records = ['a', 'b', 'c', 'd', 'e'].map((id, i) => rec(id, { project: `P${i % 2}` }));
    const m = matrix([
      ['a', 'm1', 3],
      ['b', 'm2', 2],
      ['c', 'm1', 2],
      ['d', 'n1', 3],
      ['e', 'm2', 3],
    ]);
    const one = select({ requirements: M, matrix: m, records, today });
    const two = select({
      requirements: [...M].reverse(),
      matrix: m,
      records: [...records].reverse(),
      today,
    });
    expect(two).toEqual(one);
  });

  it('respects every structural cap', () => {
    const records: AchievementRecord[] = [];
    const entries: [string, string, number][] = [];
    for (let r = 0; r < 6; r++)
      for (let p = 0; p < 3; p++)
        for (let k = 0; k < 6; k++) {
          const id = `r${r}p${p}a${k}`;
          records.push(
            rec(id, {
              role: `R${r}`,
              roleStart: `20${10 + r}-01-01`,
              roleEnd: r === 5 ? null : `20${11 + r}-01-01`,
              project: `R${r}P${p}`,
            }),
          );
          entries.push([id, k % 2 ? 'm1' : 'm2', 1 + ((r + p + k) % 3)], [id, 'n1', 1]);
        }
    const sel = select({ requirements: M, matrix: matrix(entries), records, today });
    const ids = selectedIds(sel);
    expect(ids.length).toBeLessThanOrEqual(ONE_PAGE.maxBullets);
    expect(sel.roles.filter((r) => !r.gapFill).length).toBeLessThanOrEqual(
      ONE_PAGE.maxRolesWithBullets,
    );
    for (const r of sel.roles) {
      expect(r.projects.length).toBeLessThanOrEqual(ONE_PAGE.maxProjectsPerRole);
      expect(r.projects.reduce((n, p) => n + p.achievementIds.length, 0)).toBeGreaterThanOrEqual(1);
      for (const p of r.projects)
        expect(p.achievementIds.length).toBeLessThanOrEqual(ONE_PAGE.maxBulletsPerProject);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prioritises must-have coverage over nice-to-have', () => {
    const records = [rec('must'), rec('nice')];
    const m = matrix([
      ['must', 'm1', 2],
      ['nice', 'n1', 3],
    ]);
    const sel = select({
      requirements: M,
      matrix: m,
      records,
      today,
      budget: { ...ONE_PAGE, maxBullets: 1 },
    });
    expect(selectedIds(sel)).toEqual(['must']);
  });

  it('redundancy penalty prevents two near-identical bullets', () => {
    const shared = ['sql', 'a/b testing', 'growth'];
    const records = [
      rec('a', { tags: shared, project: 'P1' }),
      rec('a-twin', { tags: shared, project: 'P1' }),
      rec('b', { tags: ['figma', 'research'], project: 'P1' }),
    ];
    const m = matrix([
      ['a', 'm1', 3],
      ['a-twin', 'm1', 3],
      ['a-twin', 'n1', 1],
      ['b', 'n1', 1],
    ]);
    const ids = selectedIds(select({ requirements: M, matrix: m, records, today }));
    expect(ids.filter((id) => id.startsWith('a')).length).toBe(1);
    // A different bullet covering the leftover requirement is still preferred over the twin.
    const m2 = matrix([
      ['a', 'm1', 3],
      ['a-twin', 'm1', 3],
      ['a-twin', 'n1', 2],
      ['b', 'n1', 3],
    ]);
    const ids2 = selectedIds(select({ requirements: M, matrix: m2, records, today }));
    expect(ids2.filter((id) => id.startsWith('a')).length).toBe(1);
    expect(ids2).toContain('b');
  });

  it('shows recent roles with no picks (no unexplained gap) but not old ones', () => {
    const records = [
      rec('cur', { role: 'R-cur', roleStart: '2024-01-01', roleEnd: null }),
      rec('recent-weak', { role: 'R-recent', roleStart: '2022-01-01', roleEnd: '2023-12-01' }),
      rec('old-weak', { role: 'R-old', roleStart: '2015-01-01', roleEnd: '2018-01-01' }),
    ];
    const m = matrix([['cur', 'm1', 3]]);
    const sel = select({ requirements: M, matrix: m, records, today });
    expect(sel.roles.map((r) => r.roleId)).toEqual(['R-cur', 'R-recent']);
    expect(sel.roles[1]).toMatchObject({ gapFill: true });
    expect(sel.roles[1]!.projects[0]!.achievementIds).toEqual(['recent-weak']);
  });

  it('orders roles reverse-chronologically and strongest bullets first', () => {
    const records = [
      rec('old1', { role: 'R-old', roleStart: '2020-01-01', roleEnd: '2023-06-01' }),
      rec('new-strong', { role: 'R-new', roleStart: '2023-07-01' }),
      rec('new-weak', { role: 'R-new', roleStart: '2023-07-01' }),
    ];
    const m = matrix([
      ['old1', 'm2', 3],
      ['new-strong', 'm1', 3],
      ['new-weak', 'n1', 2],
    ]);
    const sel = select({ requirements: M, matrix: m, records, today });
    expect(sel.roles.map((r) => r.roleId)).toEqual(['R-new', 'R-old']);
    expect(sel.roles[0]!.projects[0]!.achievementIds).toEqual(['new-strong', 'new-weak']);
  });

  it('reports coverage and must-have gaps', () => {
    const sel = select({
      requirements: M,
      matrix: matrix([
        ['a', 'm1', 3],
        ['a', 'm2', 1],
      ]),
      records: [rec('a')],
      today,
    });
    expect(sel.coverage.m1).toEqual({ bestScore: 3, achievementId: 'a' });
    expect(sel.gaps).toEqual(['m2']);
  });

  it('only includes side projects that clear the value threshold', () => {
    const records = [
      rec('w1', { project: 'W' }),
      rec('w2', { project: 'W' }),
      rec('side-weak', { role: null, project: 'S1' }),
      rec('side-strong', { role: null, project: 'S2' }),
    ];
    const m = matrix([
      ['w1', 'm1', 3],
      ['w2', 'm2', 3],
      ['side-weak', 'n1', 1],
      ['side-strong', 'm1', 3],
      ['side-strong', 'n1', 3],
    ]);
    const sel = select({ requirements: M, matrix: m, records, today });
    const side = sel.sideProjects.flatMap((p) => p.achievementIds);
    expect(side).toContain('side-strong');
    expect(side).not.toContain('side-weak');
  });
});
