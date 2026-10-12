import { describe, expect, it } from 'vitest';
import { changeSummary, editsForPrompt } from '@/lib/learning/edit-diff';
import { mergeRules } from '@/lib/learning/merge-rules';
import {
  callbackStats,
  gotCallback,
  withStatusChange,
  type AppForStats,
} from '@/lib/tracker/stats';

const app = (o: Partial<AppForStats>): AppForStats => ({
  status: 'applied',
  statusHistory: [],
  isTailored: true,
  roleFamily: 'pm',
  ...o,
});

describe('callback stats', () => {
  it('counts an interview that later became a rejection as a callback', () => {
    expect(
      gotCallback(
        app({
          status: 'rejected',
          statusHistory: [
            { status: 'interview', at: '' },
            { status: 'rejected', at: '' },
          ],
        }),
      ),
    ).toBe(true);
    expect(gotCallback(app({ status: 'ghosted' }))).toBe(false);
  });

  it('splits tailored vs baseline and by family, ignores saved, flags small N', () => {
    const apps = [
      ...Array.from({ length: 10 }, (_, i) => app({ status: i < 4 ? 'interview' : 'rejected' })),
      app({ status: 'saved' }),
      app({ isTailored: false, status: 'callback', roleFamily: 'growth' }),
      app({ isTailored: false, status: 'ghosted', roleFamily: 'growth' }),
    ];
    const s = callbackStats(apps);
    expect(s.tailored).toEqual({ n: 10, callbacks: 4, rate: 0.4, enough: true });
    expect(s.baseline).toMatchObject({ n: 2, callbacks: 1, rate: 0.5, enough: false });
    expect(s.byFamily.map((f) => f.family)).toEqual(['growth', 'pm']);
    expect(s.byFamily[0]!.tailored.n).toBe(0);
    expect(s.byFamily[0]!.tailored.rate).toBeNull();
  });

  it('appends to status history only on change', () => {
    const a = { status: 'applied', statusHistory: [] as { status: string; at: string }[] };
    const b = withStatusChange(a, 'interview', new Date('2026-01-02'));
    expect(b.statusHistory).toEqual([{ status: 'interview', at: '2026-01-02T00:00:00.000Z' }]);
    expect(withStatusChange(b, 'interview')).toBe(b);
  });
});

describe('edit diffs', () => {
  it('summarises word changes', () =>
    expect(changeSummary('Built a search bar', 'Shipped a search bar')).toBe('-Built +Shipped'));
  it('drops no-op edits', () =>
    expect(
      editsForPrompt([
        { before: 'a', after: 'a' },
        { before: 'Built x', after: 'Shipped x' },
      ]),
    ).toHaveLength(1));
});

describe('mergeRules', () => {
  const existing = [
    { id: '1', rule: 'Prefers "Shipped" over "Built"', evidenceCount: 2, active: false },
  ];
  it('updates evidence for a near-identical rule without re-activating it, and inserts new ones', () => {
    const { inserts, updates } = mergeRules(existing, [
      { rule: 'Prefers "Shipped" instead of "Built"', evidence_count: 5 },
      { rule: 'Removes adverbs like "successfully"', evidence_count: 3 },
      { rule: 'Likes short bullets', evidence_count: 1 },
    ]);
    expect(updates).toEqual([{ id: '1', evidenceCount: 5 }]);
    expect(inserts.map((i) => i.rule)).toEqual(['Removes adverbs like "successfully"']);
  });
});
