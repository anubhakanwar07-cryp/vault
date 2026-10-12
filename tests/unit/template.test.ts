import { describe, expect, it } from 'vitest';
import { resumeBodyHtml, SECTION_HEADINGS } from '@/lib/export/template';
import type { ResumeDoc } from '@/lib/resume/types';

const doc: ResumeDoc = {
  header: {
    name: 'Aarav <Mehta>',
    email: 'a@x.com',
    phone: null,
    location: 'Bengaluru',
    links: [{ label: 'site', url: 'https://aarav.dev/' }],
  },
  headline: 'AI PM',
  summary: 'Ships LLM products.',
  experience: [
    {
      roleId: 'r',
      company: 'Lumio',
      title: 'PM',
      location: null,
      start: '2023-04-01',
      end: null,
      bullets: [{ bulletId: 'b1', text: 'Cut cost ~40% & more' }],
    },
  ],
  projects: [
    {
      projectId: 'p',
      name: 'Ranker',
      url: 'https://github.com/x',
      bullets: [{ bulletId: 'b2', text: 'Built it' }],
    },
  ],
  skills: ['SQL', 'Python'],
  education: [
    {
      institution: 'IIT',
      degree: 'B.Tech',
      field: 'ME',
      start: null,
      end: '2019-05-01',
      grade: null,
    },
  ],
  extras: [{ kind: 'award', title: 'Award', issuer: 'Lumio', date: '2024-03-01' }],
};

describe('resumeBodyHtml', () => {
  const html = resumeBodyHtml(doc);
  it('uses the exact section headings in order', () => {
    const order = Object.values(SECTION_HEADINGS).map((t) =>
      html.indexOf(`>${t.replace('&', '&amp;')}<`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('escapes text, shows links as visible text and plain-text dates', () => {
    expect(html).toContain('Aarav &lt;Mehta&gt;');
    expect(html).toContain('Cut cost ~40% &amp; more');
    expect(html).toContain('aarav.dev');
    expect(html).toContain('Apr 2023 – Present');
    expect(html).not.toMatch(/<table|<img|<svg/);
  });
});
