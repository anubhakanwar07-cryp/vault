import { describe, expect, it } from 'vitest';
import { extraTitle, resumeBodyHtml, SECTION_HEADINGS } from '@/lib/export/template';
import { resumeToText } from '@/lib/resume/plain-text';
import type { ResumeDoc } from '@/lib/resume/types';

const doc: ResumeDoc = {
  header: {
    name: 'Aarav <Mehta>',
    email: 'a@x.com',
    phone: '+91 99999',
    location: 'Bengaluru',
    links: [
      { label: 'LinkedIn', url: 'https://linkedin.com/in/aarav' },
      { label: 'Portfolio', url: 'javascript:alert(1)' },
    ],
  },
  headline: '',
  summary: '',
  experience: [
    {
      roleId: 'r',
      company: 'Lumio',
      title: 'PM',
      location: null,
      start: '2023-04-01',
      end: null,
      bullets: [],
      projects: [
        {
          name: 'Coach',
          oneLiner: 'an LLM writing coach',
          bullets: [{ bulletId: 'b1', text: 'Cut cost ~40% & more with SQL' }],
        },
      ],
    },
  ],
  projects: [
    {
      projectId: 'p',
      name: 'Ranker',
      url: 'https://github.com/x',
      start: '2026-05-01',
      end: '2026-06-01',
      bullets: [{ bulletId: 'b2', text: 'Built it' }],
    },
  ],
  skills: ['SQL', 'Roadmapping'],
  skillGroups: [
    { label: 'Technical', items: ['SQL'] },
    { label: 'Product', items: ['Roadmapping'] },
  ],
  emphasis: ['SQL', 'LLM'],
  education: [
    {
      institution: 'IIT',
      degree: 'B.Tech',
      field: 'ME',
      start: '2015-07-01',
      end: '2019-05-01',
      grade: null,
    },
  ],
  extras: [
    {
      kind: 'award',
      title: 'Hult Prize',
      issuer: 'Hult',
      date: '2023-03-01',
      description: 'Top 4 of 100+',
    },
  ],
};

describe('resumeBodyHtml', () => {
  const html = resumeBodyHtml(doc);
  it('uses the exact section headings in your-resume order', () => {
    expect(Object.values(SECTION_HEADINGS)).toEqual([
      'Education',
      'Experience',
      'Projects',
      'Skills',
      'Awards / Position of Responsibility',
    ]);
    const order = Object.values(SECTION_HEADINGS).map((t) => html.indexOf(`>${t}<`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Summary');
  });
  it('renders the header: capitalised name, labelled links, safe hrefs', () => {
    expect(html).toContain('AARAV &lt;MEHTA&gt;');
    expect(html).toContain('href="https://linkedin.com/in/aarav">LinkedIn</a>');
    expect(html).toContain('href="mailto:a@x.com"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Bengaluru');
  });
  it('renders role, project sub-head, dates and bold emphasis', () => {
    expect(html).toContain('PM – Lumio');
    expect(html).toContain('April 2023 – Present');
    expect(html).toContain(
      '<strong class="rt-b">Coach</strong> — an <strong class="rt-b">LLM</strong>',
    );
    expect(html).toContain(
      'Cut cost <strong class="rt-b">~40%</strong> &amp; more with <strong class="rt-b">SQL</strong>',
    );
    expect(html).toContain('May 2026 – June 2026');
    expect(html).toContain('<strong class="rt-b">Technical:</strong> SQL');
    expect(html).toContain('B.Tech in ME');
    expect(html).toContain('<strong class="rt-b">Hult Prize, Hult (2023)</strong> — Top 4 of 100+');
    expect(html).not.toMatch(/<table|<img|<svg/);
  });
  it('still renders an older doc (flat skills, no groups or emphasis)', () => {
    const old = resumeBodyHtml({ ...doc, skillGroups: undefined, emphasis: undefined });
    expect(old).toContain('SQL, Roadmapping');
  });
});

it('extraTitle adds the year only when missing', () => {
  expect(extraTitle({ ...doc.extras[0]!, title: 'Hult Prize 2023' })).toBe('Hult Prize 2023, Hult');
});

it('plain text follows the same order and keeps text unmarked', () => {
  const t = resumeToText(doc);
  expect(t.indexOf('Education')).toBeLessThan(t.indexOf('Experience'));
  expect(t).toContain('Coach — an LLM writing coach');
  expect(t).toContain('• Cut cost ~40% & more with SQL');
  expect(t).not.toContain('*');
});
