import { extraTitle, SECTION_HEADINGS } from '@/lib/export/template';
import { dateRange } from '@/lib/pipeline/assemble-utils';
import type { ResumeDoc } from './types';

/** Plain-text rendering, in the same order and with the same headings as the export template (SPEC §11). */
export function resumeToText(doc: ResumeDoc): string {
  const out: string[] = [];
  const h = doc.header;
  const row = (left: string, dates: string) => (dates ? `${left}   ${dates}` : left);
  out.push(
    h.name.toUpperCase(),
    [h.phone, h.email, ...h.links.map((l) => l.label || l.url)].filter(Boolean).join(' | '),
  );
  if (doc.education.length) {
    out.push('', SECTION_HEADINGS.education);
    for (const e of doc.education) {
      out.push(row(e.institution ?? '', dateRange(e.start, e.end)));
      const degree = [[e.degree, e.field].filter(Boolean).join(' in '), e.grade]
        .filter(Boolean)
        .join(' | ');
      if (degree) out.push(degree);
    }
  }
  if (doc.experience.length) {
    out.push('', SECTION_HEADINGS.experience);
    for (const e of doc.experience) {
      out.push(row(`${e.title} – ${e.company}`, dateRange(e.start, e.end)));
      for (const b of e.bullets) out.push(`• ${b.text}`);
      for (const p of e.projects ?? []) {
        out.push(p.oneLiner ? `${p.name} — ${p.oneLiner}` : p.name);
        for (const b of p.bullets) out.push(`• ${b.text}`);
      }
    }
  }
  if (doc.projects.length) {
    out.push('', SECTION_HEADINGS.projects);
    for (const p of doc.projects) {
      out.push(row(p.name, dateRange(p.start, p.end)));
      for (const b of p.bullets) out.push(`• ${b.text}`);
    }
  }
  const skillLines = doc.skillGroups?.length
    ? doc.skillGroups.map((g) => `${g.label}: ${g.items.join(', ')}`)
    : doc.skills.length
      ? [doc.skills.join(', ')]
      : [];
  if (skillLines.length) out.push('', SECTION_HEADINGS.skills, ...skillLines);
  if (doc.extras.length) {
    out.push('', SECTION_HEADINGS.extras);
    for (const x of doc.extras)
      out.push(`• ${extraTitle(x)}${x.description ? ` — ${x.description}` : ''}`);
  }
  return out.join('\n');
}
