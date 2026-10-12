import { describe, expect, it } from 'vitest';
import { orderSkills, pickExtras, weightedCoverage } from '@/lib/pipeline/assemble-utils';
import type { AchievementRecord } from '@/lib/pipeline/types';

const r = (skills: string[], tools: string[]) =>
  ({ skills, tools }) as unknown as AchievementRecord;

describe('orderSkills', () => {
  it('puts JD keywords first, then frequency; never adds new skills', () => {
    const out = orderSkills(
      ['SQL', 'Figma', 'Python', 'Tableau', 'Cooking'],
      [r(['Python'], ['Tableau']), r(['Python'], [])],
      [
        { term: 'SQL', synonyms: [], weight: 5 },
        { term: 'Kubernetes', synonyms: [], weight: 5 },
        { term: 'figma', synonyms: [], weight: 2 },
      ],
    );
    expect(out).toEqual(['SQL', 'Figma', 'Python', 'Tableau']);
  });
  it('caps at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => `s${i}`);
    expect(orderSkills(many, [r(many, [])], [])).toHaveLength(12);
  });
});

describe('pickExtras', () => {
  it('keeps extras matching JD keywords, max 3', () => {
    const x = (title: string, tags: string[] = []) => ({
      kind: 'award',
      title,
      issuer: null,
      date: null,
      description: null,
      tags,
    });
    const out = pickExtras(
      [x('Chess champion'), x('AI award', ['llm']), x('Data cert', ['sql'])],
      [
        { term: 'LLM', synonyms: [] },
        { term: 'SQL', synonyms: [] },
      ],
    );
    expect(out.map((e) => e.title)).toEqual(['AI award', 'Data cert']);
  });
});

describe('weightedCoverage', () => {
  it('weights full, half and no credit', () => {
    expect(
      weightedCoverage([
        { weight: 5, bestScore: 3 },
        { weight: 3, bestScore: 1 },
        { weight: 2, bestScore: 0 },
      ]),
    ).toBe(65);
    expect(weightedCoverage([])).toBe(100);
  });
});
