import { describe, expect, it } from 'vitest';
import { checkImport, numbersIn } from '@/lib/import/source-check';
import { importResumeOutput } from '@/lib/llm/schemas/import';

const SOURCE = `Jane Doe
Product Manager, Acme — Jan 2022 – Present
- Launched onboarding revamp that lifted activation by 40% across 2,000 users
- Cut support tickets by ~30% with an FAQ bot
- Grew newsletter to over 5000 subscribers
B.Tech, IIT Delhi, 2016 – 2020`;

function draftWith(achievements: unknown[]) {
  return importResumeOutput.parse({
    roles: [
      {
        company: 'Acme',
        title: 'Product Manager',
        start_date: '2022-01',
        end_date: null,
        is_current: true,
        projects: [{ name: 'Product Manager — core work', achievements }],
      },
    ],
    education: [{ institution: 'IIT Delhi', start_date: '2016', end_date: '2021' }],
  });
}

const ach = (o: Record<string, unknown>) => ({ action: 'Did something', ...o });

describe('numbersIn', () => {
  it('handles thousands separators and percentages', () =>
    expect(numbersIn('2,000 users in 3 weeks (40%)')).toEqual(['2000', '3', '40']));
});

describe('checkImport', () => {
  it('keeps a plainly stated number as exact', () => {
    const { draft, flags } = checkImport(
      draftWith([ach({ metric_value: '40%', metric_confidence: 'exact' })]),
      SOURCE,
    );
    expect(draft.roles[0]!.projects[0]!.achievements[0]).toMatchObject({
      metric_value: '40%',
      metric_confidence: 'exact',
    });
    expect(flags.filter((f) => f.path.startsWith('roles'))).toHaveLength(0);
  });

  it('matches numbers written with thousands separators', () => {
    const { draft } = checkImport(
      draftWith([ach({ metric_value: '2000 users', metric_confidence: 'exact' })]),
      SOURCE,
    );
    expect(draft.roles[0]!.projects[0]!.achievements[0]!.metric_value).toBe('2000 users');
  });

  it('downgrades hedged numbers to estimate', () => {
    const { draft } = checkImport(
      draftWith([
        ach({ metric_value: '30%', metric_confidence: 'exact' }),
        ach({ metric_value: '5000 subscribers', metric_confidence: 'exact' }),
      ]),
      SOURCE,
    );
    const [a, b] = draft.roles[0]!.projects[0]!.achievements;
    expect(a!.metric_confidence).toBe('estimate');
    expect(b!.metric_confidence).toBe('estimate');
  });

  it('removes a metric whose number is not in the source', () => {
    const { draft, flags } = checkImport(
      draftWith([ach({ metric_value: '55%', metric_confidence: 'exact' })]),
      SOURCE,
    );
    expect(draft.roles[0]!.projects[0]!.achievements[0]).toMatchObject({
      metric_value: null,
      metric_confidence: 'none',
    });
    expect(flags[0]?.message).toContain('55%');
  });

  it('does not let "4" match inside "40"', () => {
    const { draft } = checkImport(
      draftWith([ach({ metric_value: '4x', metric_confidence: 'exact' })]),
      SOURCE,
    );
    expect(draft.roles[0]!.projects[0]!.achievements[0]!.metric_value).toBeNull();
  });

  it('flags invented numbers in the action text', () => {
    const { flags } = checkImport(draftWith([ach({ action: 'Led a team of 12' })]), SOURCE);
    expect(flags.some((f) => f.message.includes('12'))).toBe(true);
  });

  it('removes dates whose year is not in the source', () => {
    const { draft, flags } = checkImport(draftWith([]), SOURCE);
    expect(draft.education[0]).toMatchObject({ start_date: '2016-01', end_date: null });
    expect(flags.some((f) => f.path === 'education.0.end_date')).toBe(true);
  });

  it('clears end_date for current roles and drops unknown function tags', () => {
    const { draft } = checkImport(
      draftWith([ach({ function_tags: ['growth', 'synergy'] })]),
      SOURCE,
    );
    expect(draft.roles[0]!.end_date).toBeNull();
    expect(draft.roles[0]!.projects[0]!.achievements[0]!.function_tags).toEqual(['growth']);
  });

  it('sets confidence to none when there is no metric', () => {
    const { draft } = checkImport(draftWith([ach({ metric_confidence: 'exact' })]), SOURCE);
    expect(draft.roles[0]!.projects[0]!.achievements[0]!.metric_confidence).toBe('none');
  });
});
