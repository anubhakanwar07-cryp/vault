import { describe, expect, it } from 'vitest';
import { keywordCoverage, mentions } from '@/lib/keywords/coverage';
import {
  leadVerb,
  mentionsTech,
  numberTokens,
  verifyBullet,
  type VerifyContext,
} from '@/lib/pipeline/verify-code';
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

  it('checks the unit, not just the digits', () => {
    expect(verifyBullet(ok.replace('~45%', '~45x'), record, ctx).join()).toContain('45x');
    expect(verifyBullet(ok.replace('~45%', '~$45'), record, ctx).join()).toContain('$45');
  });

  it('does not let a tool version number permit a metric', () =>
    expect(verifyBullet(`${ok}, growing usage 4x`, record, ctx).join()).toContain('4x'));

  it('does not treat a tool version number as a fact', () =>
    expect(
      verifyBullet(
        ok.replace('4 engineers', 'engineers'),
        { ...record, project: { ...record.project!, ownership: 'Shared' } },
        ctx,
      ),
    ).toEqual([]));

  it('catches spelled-out quantities and multipliers', () => {
    expect(
      verifyBullet(ok.replace('4 engineers', 'twelve engineers'), record, ctx).join(),
    ).toContain('twelve');
    expect(verifyBullet(`${ok}, doubling retention`, record, ctx).join()).toContain('doubling');
    expect(verifyBullet(`${ok} for hundreds of schools`, record, ctx).join()).toContain('hundreds');
  });

  it('accepts a spelled-out number that the source states as a digit', () =>
    expect(verifyBullet(ok.replace('4 engineers', 'four engineers'), record, ctx)).toEqual([]));

  it('needs the hedge next to the estimated number, not anywhere in the line', () =>
    expect(
      verifyBullet(
        ok.replace('~45%', '45%').replace('explains', 'brought about'),
        record,
        ctx,
      ).join(),
    ).toContain('hedge'));

  it('does not mistake everyday words for tools', () => {
    const plain = `${ok} after a go-to-market review of R&D spend for each user segment`;
    expect(verifyBullet(plain, record, ctx).join()).not.toContain('Names');
  });

  it('never names the target company', () =>
    expect(verifyBullet(`${ok} for Brightpath`, record, ctx).join()).toContain('Brightpath'));
});

it('leadVerb', () => expect(leadVerb('  Launched a coach')).toBe('launched'));

describe('numberTokens', () => {
  it('applies magnitudes and keeps units', () => {
    expect(
      numberTokens('$1.2M and 2K users, 40% up, 3x faster').map((t) => [
        t.value,
        t.unit,
        t.currency,
      ]),
    ).toEqual([
      [1200000, '', true],
      [2000, '', false],
      [40, '%', false],
      [3, 'x', false],
    ]);
  });
  it('treats 2,000 and 2K as the same value', () =>
    expect(numberTokens('2,000')[0]!.value).toBe(numberTokens('2K')[0]!.value));
});

describe('mentionsTech', () => {
  it('matches ambiguous tool names only in exact case and standing alone', () => {
    expect(mentionsTech('Built services in Go', 'Go')).toBe(true);
    expect(mentionsTech('Ran the go-to-market plan', 'Go')).toBe(false);
    expect(mentionsTech('Go-to-market plan', 'Go')).toBe(false);
    expect(mentionsTech('Cut R&D cost', 'R')).toBe(false);
    expect(mentionsTech('Analysed churn in R', 'R')).toBe(true);
    expect(mentionsTech('Grew the SMB segment', 'Segment')).toBe(false);
    expect(mentionsTech('Wrote SQL', 'SQL')).toBe(true);
  });
});
