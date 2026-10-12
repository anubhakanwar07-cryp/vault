import { describe, expect, it } from 'vitest';
import { average, completenessScore, type CompletenessInput } from '@/lib/vault/completeness';

const empty: CompletenessInput = {
  action: null,
  result: null,
  metricValue: null,
  metricConfidence: 'none',
  situation: null,
  skills: [],
  tools: [],
  functionTags: [],
  senioritySignals: [],
  projectProofUrl: null,
};

describe('completenessScore', () => {
  it('is 0 for an empty record', () => expect(completenessScore(empty)).toBe(0));

  it('is 100 for a complete record', () =>
    expect(
      completenessScore({
        action: 'Built X',
        result: 'Y improved',
        metricValue: '40%',
        metricConfidence: 'exact',
        situation: 'Z was slow',
        skills: ['sql'],
        tools: ['dbt'],
        functionTags: ['data'],
        senioritySignals: ['led team of 4'],
        projectProofUrl: null,
      }),
    ).toBe(100));

  it('gives no metric points when confidence is none', () =>
    expect(completenessScore({ ...empty, metricValue: '40%', metricConfidence: 'none' })).toBe(0));

  it('counts an estimate metric', () =>
    expect(completenessScore({ ...empty, metricValue: '~40%', metricConfidence: 'estimate' })).toBe(
      20,
    ));

  it('needs at least 2 skills or tools combined', () => {
    expect(completenessScore({ ...empty, skills: ['a'] })).toBe(0);
    expect(completenessScore({ ...empty, skills: ['a'], tools: ['b'] })).toBe(10);
  });

  it('accepts proof_url on the project instead of a seniority signal', () =>
    expect(completenessScore({ ...empty, projectProofUrl: 'https://x.dev' })).toBe(10));

  it('ignores whitespace-only fields', () =>
    expect(completenessScore({ ...empty, action: '  ', result: '' })).toBe(0));
});

describe('average', () => {
  it('rounds the mean', () => expect(average([50, 61])).toBe(56));
  it('is null for no scores', () => expect(average([])).toBeNull());
});
