import { describe, expect, it } from 'vitest';
import { parsedJD } from '@/lib/llm/schemas/jd';

const base = {
  role_title: 'Product Manager, AI',
  company: 'Acme',
  role_family: 'ai_pm',
  seniority: 'mid',
  company_stage: 'growth',
  core_problems: ['a', 'b', 'c', 'd'],
  must_haves: [
    { id: 'x', req: 'LLM evals', weight: 9, evidence_type: 'skill' },
    { id: 'x', req: 'SQL', weight: 0, evidence_type: 'weird' },
  ],
  nice_to_haves: [{ id: 'q', req: 'Python', weight: 5 }],
  keywords: [
    { term: 'LLM', synonyms: ['large language model', ''], weight: 5 },
    { term: 'llm', synonyms: [], weight: 2 },
  ],
  knockouts: ['3+ years', ' '],
  tone: 'fast-moving',
};

describe('parsedJD schema', () => {
  it('normalises ids, clamps weights, trims lists and dedupes keywords', () => {
    const p = parsedJD.parse(base);
    expect(p.core_problems).toEqual(['a', 'b', 'c']);
    expect(p.must_haves.map((m) => [m.id, m.weight, m.evidence_type])).toEqual([
      ['m1', 5, 'skill'],
      ['m2', 1, 'skill'],
    ]);
    expect(p.nice_to_haves[0]).toMatchObject({ id: 'n1', weight: 3 });
    expect(p.keywords).toHaveLength(1);
    expect(p.keywords[0]!.synonyms).toEqual(['large language model']);
    expect(p.knockouts).toEqual(['3+ years']);
  });
  it('falls back on unknown enums', () => {
    const p = parsedJD.parse({
      ...base,
      role_family: 'astronaut',
      seniority: 'principal',
      company_stage: '?',
    });
    expect([p.role_family, p.seniority, p.company_stage]).toEqual(['other', 'mid', 'unknown']);
  });
  it('requires at least one must-have', () =>
    expect(parsedJD.safeParse({ ...base, must_haves: [] }).success).toBe(false));
});
