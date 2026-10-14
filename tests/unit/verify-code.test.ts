import { describe, expect, it } from 'vitest';
import { keywordCoverage, mentions } from '@/lib/keywords/coverage';
import { leadVerb, verifyBullet, type VerifyContext } from '@/lib/pipeline/verify-code';
import type { AchievementRecord } from '@/lib/pipeline/types';

const record: AchievementRecord = {
  id: 'a1',
  situation: 'Learners churned after wrong answers',
  action: 'Launched an LLM study coach that explains wrong answers',
  result: 'Reduced learner-reported wrong explanations',
  metricValue: '~45%',
  metricConfidence: 'estimate',
  skills: ['LLM evals'],
  tools: ['GPT-4', 'Python'],
  functionTags: [],
  domainTags: [],
  senioritySignals: [],
  rawNotes: null,
  project: {
    id: 'p1',
    name: 'AI Study Coach',
    oneLiner: null,
    ownership: 'Built with 4 engineers',
    proofUrl: null,
    isSideProject: false,
    startDate: null,
    endDate: null,
  },
  role: {
    id: 'r1',
    title: 'PM',
    company: 'Lumio',
    location: null,
    startDate: '2023-01-01',
    endDate: null,
  },
};
const ctx: VerifyContext = {
  vaultTools: ['Amplitude', 'Metabase'],
  jdKeywords: [
    { term: 'LLM evaluation', synonyms: ['LLM evals'] },
    { term: 'experimentation', synonyms: ['A/B testing'] },
    { term: 'retention', synonyms: [] },
    { term: 'personalisation', synonyms: [] },
  ],
  targetCompany: 'Brightpath',
};

const ok =
  'Launched a GPT-4 study coach with 4 engineers that explains wrong answers, cutting learner-reported errors by ~45%';

describe('keyword matching', () => {
  it('is word-boundary aware', () => {
    expect(mentions('Wrote SQL, dbt models', 'SQL')).toBe(true);
    expect(mentions('Used NoSQL stores', 'SQL')).toBe(false);
    expect(mentions('Ran A/B testing at scale', 'A/B testing')).toBe(true);
    expect(mentions('Built in C++.', 'C++')).toBe(true);
  });
  it('reports where each keyword is used', () => {
    expect(
      keywordCoverage(
        [
          { term: 'SQL', synonyms: ['structured query language'] },
          { term: 'Figma', synonyms: [] },
        ],
        [
          { id: 'b1', text: 'Wrote SQL' },
          { id: 'b2', text: 'Taught structured query language' },
        ],
      ),
    ).toEqual([
      { term: 'SQL', used: true, where: ['b1', 'b2'] },
      { term: 'Figma', used: false, where: [] },
    ]);
  });
});

describe('verifyBullet', () => {
  it('passes a faithful bullet', () => expect(verifyBullet(ok, record, ctx)).toEqual([]));

  it('catches an invented number', () =>
    expect(verifyBullet(ok.replace('~45%', '~60%'), record, ctx)[0]).toContain('60'));

  it('catches a team size not in the record', () =>
    expect(verifyBullet(ok.replace('4 engineers', '12 engineers'), record, ctx).join()).toContain(
      '12',
    ));

  it('catches a tool borrowed from elsewhere in the vault', () =>
    expect(verifyBullet(`${ok} using Amplitude`, record, ctx).join()).toContain('Amplitude'));

  it('catches a well-known technology not in the record', () =>
    expect(verifyBullet(ok.replace('GPT-4', 'Claude'), record, ctx).join()).toContain('Claude'));

  it('requires the hedge on an estimated metric', () =>
    expect(verifyBullet(ok.replace('~45%', '45%'), record, ctx).join()).toContain('hedge'));

  it('flags banned phrases', () =>
    expect(verifyBullet(`Was responsible for ${ok}`, record, ctx).join()).toContain(
      'responsible for',
    ));

  it('allows up to 2 JD keyword substitutions but not 3', () => {
    const two = `${ok}; improved retention through experimentation`;
    expect(verifyBullet(two, record, ctx)).toEqual([]);
    const three = `${ok}; improved retention through experimentation and personalisation`;
    expect(verifyBullet(three, record, ctx).join()).toContain('max 2');
  });

  it('never names the target company', () =>
    expect(verifyBullet(`${ok} for Brightpath`, record, ctx).join()).toContain('Brightpath'));
});

it('leadVerb', () => expect(leadVerb('  Launched a coach')).toBe('launched'));
