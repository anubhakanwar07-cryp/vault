import { describe, expect, it } from 'vitest';
import {
  bulletIds,
  estimateLines,
  findBullet,
  moveBullet,
  removeBullet,
  replaceBullet,
  setBulletText,
} from '@/lib/resume/doc-ops';
import type { ResumeDoc } from '@/lib/resume/types';

const doc: ResumeDoc = {
  header: { name: 'A', email: null, phone: null, location: null, links: [] },
  headline: 'h',
  summary: 's',
  experience: [
    {
      roleId: 'r1',
      company: 'C',
      title: 'T',
      location: null,
      start: '2023-01-01',
      end: null,
      bullets: [
        { bulletId: 'b1', text: 'one' },
        { bulletId: 'b2', text: 'two' },
      ],
    },
    {
      roleId: 'r2',
      company: 'D',
      title: 'U',
      location: null,
      start: '2020-01-01',
      end: '2022-01-01',
      bullets: [],
      projects: [{ name: 'P', bullets: [{ bulletId: 'b3', text: 'three' }] }],
    },
  ],
  projects: [
    { projectId: 'p9', name: 'Side', url: null, bullets: [{ bulletId: 'b4', text: 'four' }] },
  ],
  skills: ['SQL'],
  education: [],
  extras: [],
};

describe('doc-ops', () => {
  it('finds and edits bullets without mutating the input', () => {
    const out = setBulletText(doc, 'b3', 'THREE');
    expect(findBullet(out, 'b3')?.text).toBe('THREE');
    expect(findBullet(doc, 'b3')?.text).toBe('three');
  });
  it('replaces a bullet with a new id (swap)', () => {
    const out = replaceBullet(doc, 'b2', { bulletId: 'b9', text: 'nine' });
    expect(bulletIds(out)).toEqual(['b1', 'b9', 'b3', 'b4']);
  });
  it('removes bullets and drops empty groups but keeps roles', () => {
    const out = removeBullet(removeBullet(doc, 'b3'), 'b4');
    expect(out.experience).toHaveLength(2);
    expect(out.experience[1]!.projects).toEqual([]);
    expect(out.projects).toEqual([]);
  });
  it('moves within a list and ignores moves past the ends', () => {
    expect(bulletIds(moveBullet(doc, 'b2', -1)).slice(0, 2)).toEqual(['b2', 'b1']);
    expect(bulletIds(moveBullet(doc, 'b1', -1))).toEqual(bulletIds(doc));
  });
  it('throws for unknown bullets', () => expect(() => setBulletText(doc, 'nope', 'x')).toThrow());
  it('estimates page lines', () => {
    expect(estimateLines(doc)).toBeGreaterThan(5);
    const long = setBulletText(doc, 'b1', 'x'.repeat(400));
    expect(estimateLines(long)).toBeGreaterThan(estimateLines(doc));
  });
});
