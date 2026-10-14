import { describe, expect, it } from 'vitest';
import {
  dateRange,
  groupSkills,
  orderSkills,
  pickExtras,
  weightedCoverage,
} from '@/lib/pipeline/assemble-utils';
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

describe('groupSkills', () => {
  const kw = [{ term: 'SQL', synonyms: [], weight: 5 }];
  it('splits tools/technologies from product skills, each ordered', () => {
    const out = groupSkills(
      ['BigQuery', 'Figma'],
      ['SQL', 'Roadmapping', 'A/B Testing'],
      [r(['Roadmapping', 'SQL'], ['BigQuery', 'Figma']), r(['A/B Testing'], [])],
      kw,
      'pm',
    );
    expect(out).toEqual([
      { label: 'Technical', items: ['SQL', 'BigQuery', 'Figma'] },
      { label: 'Product', items: ['A/B Testing', 'Roadmapping'] },
    ]);
  });
  it('labels the second line Core outside product roles and drops empty lines', () => {
    expect(groupSkills([], ['Hiring'], [r(['Hiring'], [])], [], 'ops')).toEqual([
      { label: 'Core', items: ['Hiring'] },
    ]);
  });
});

it('dateRange', () => {
  expect(dateRange('2025-07-01', null)).toBe('July 2025 – Present');
  expect(dateRange('2021-11-01', '2025-05-01')).toBe('November 2021 – May 2025');
  expect(dateRange(null, '2025-05-01')).toBe('May 2025');
  expect(dateRange(null, null)).toBe('');
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
