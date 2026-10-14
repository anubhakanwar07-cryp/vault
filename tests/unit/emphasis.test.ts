import { describe, expect, it } from 'vitest';
import { emphasize } from '@/lib/resume/emphasis';

const bold = (text: string, terms: string[] = []) =>
  emphasize(text, terms)
    .filter((s) => s.bold)
    .map((s) => s.text);

describe('emphasize', () => {
  it('bolds metrics with a unit or sign, not bare counts', () => {
    expect(bold('Cut QA effort by 60% across 44 projects')).toEqual(['60%']);
    expect(bold('Leads convert at 3.4x the rate')).toEqual(['3.4x']);
    expect(bold('Projected +480 enrollments across 1.4M leads')).toEqual(['+480', '1.4M']);
    expect(bold('Held a 90%+ score and ~40% savings')).toEqual(['90%+', '~40%']);
    expect(bold('Reviewed 3 drafts with 12 writers')).toEqual([]);
  });

  it('bolds JD terms the text already contains, whole words only', () => {
    expect(bold('Shipped an LLM QC engine', ['LLM', 'SQL'])).toEqual(['LLM']);
    expect(bold('Moved data to NoSQL', ['SQL'])).toEqual([]);
  });

  it('caps at 3 spans, metrics first, never overlapping', () => {
    const out = bold('Cut 60% and 30% and 20% of LLM costs', ['LLM']);
    expect(out).toEqual(['60%', '30%', '20%']);
    expect(bold('Built generative AI tools', ['generative AI', 'AI'])).toEqual(['generative AI']);
  });

  it('never changes the text', () => {
    const text = 'Cut a 3-day, two-person turnaround by 60% using SQL';
    expect(
      emphasize(text, ['SQL'])
        .map((s) => s.text)
        .join(''),
    ).toBe(text);
    expect(emphasize('')).toEqual([{ text: '', bold: false }]);
  });
});
