import { describe, expect, it } from 'vitest';
import { knockoutWarnings, requiredYears, yearsOfExperience } from '@/lib/vault/experience';

const today = new Date('2026-01-01');

describe('yearsOfExperience', () => {
  it('merges overlapping roles and separates internships', () => {
    const y = yearsOfExperience(
      [
        { startDate: '2023-01-01', endDate: null, employmentType: 'full-time' },
        { startDate: '2024-01-01', endDate: '2024-06-01', employmentType: 'freelance' }, // overlaps
        { startDate: '2022-01-01', endDate: '2022-07-01', employmentType: 'intern' },
      ],
      today,
    );
    expect(y.excludingInterns).toBe(3);
    expect(y.total).toBe(3.5);
  });
  it('is 0 with no roles', () => expect(yearsOfExperience([], today).total).toBe(0));
});

describe('requiredYears', () => {
  it.each([
    ['3+ years of product experience', 3],
    ['Minimum 5 years in B2B SaaS', 5],
    ['2-4 years experience', 2],
    ['1.5 yrs exp', 1.5],
    ['Must be based in Bengaluru', null],
  ])('%s → %s', (k, n) => expect(requiredYears(k)).toBe(n));
});

describe('knockoutWarnings', () => {
  const roles = [
    { startDate: '2024-07-01', endDate: null, employmentType: 'full-time' },
    { startDate: '2023-01-01', endDate: '2023-07-01', employmentType: 'intern' },
  ];
  it('warns when the vault has fewer years than required', () => {
    const w = knockoutWarnings(
      ['3+ years of product management', 'Bachelor’s degree'],
      roles,
      today,
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('3+ years');
    expect(w[0]).toContain('1.5 years');
    expect(w[0]).toContain('including internships');
  });
  it('stays quiet when the requirement is met', () =>
    expect(knockoutWarnings(['1+ years'], roles, today)).toHaveLength(0));
});
