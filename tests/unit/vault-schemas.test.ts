import { describe, expect, it } from 'vitest';
import { achievementInput, projectInput, roleInput } from '@/lib/llm/schemas/vault';

describe('vault input schemas', () => {
  it('normalises month dates and empty selects', () => {
    const r = roleInput.parse({
      company: ' Acme ',
      title: 'PM',
      startDate: '2023-04',
      endDate: '',
      employmentType: '',
      location: '',
    });
    expect(r).toMatchObject({
      company: 'Acme',
      startDate: '2023-04-01',
      endDate: null,
      employmentType: null,
      location: null,
    });
  });

  it('treats an empty role select as a side project', () => {
    expect(projectInput.parse({ name: 'Side thing', roleId: '' }).roleId).toBeNull();
  });

  it('defaults metric confidence to none and dedupes tags', () => {
    const a = achievementInput.parse({
      action: 'Did X',
      metricConfidence: '',
      skills: ['sql', 'sql', ' '],
    });
    expect(a.metricConfidence).toBe('none');
    expect(a.skills).toEqual(['sql']);
  });

  it('requires an action', () => {
    expect(achievementInput.safeParse({ action: '  ' }).success).toBe(false);
  });
});
