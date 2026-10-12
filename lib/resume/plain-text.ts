import { monthYear } from '@/lib/pipeline/assemble-utils';
import type { ResumeDoc } from './types';

/** Plain-text rendering, in the same order and with the same headings as the export template (SPEC §11). */
export function resumeToText(doc: ResumeDoc): string {
  const out: string[] = [];
  const h = doc.header;
  out.push(
    h.name,
    [h.email, h.phone, h.location, ...h.links.map((l) => l.label)].filter(Boolean).join(' | '),
    '',
  );
  if (doc.headline) out.push(doc.headline);
  if (doc.summary) out.push('', 'Summary', doc.summary);
  if (doc.experience.length) {
    out.push('', 'Experience');
    for (const e of doc.experience) {
      out.push(
        `${e.title}, ${e.company}${e.location ? ` — ${e.location}` : ''}   ${monthYear(e.start)} – ${monthYear(e.end)}`,
      );
      for (const b of e.bullets) out.push(`• ${b.text}`);
      for (const p of e.projects ?? []) {
        out.push(`  ${p.name}`);
        for (const b of p.bullets) out.push(`• ${b.text}`);
      }
    }
  }
  if (doc.projects.length) {
    out.push('', 'Projects');
    for (const p of doc.projects) {
      out.push(`${p.name}${p.url ? ` — ${p.url.replace(/^https?:\/\//, '')}` : ''}`);
      for (const b of p.bullets) out.push(`• ${b.text}`);
    }
  }
  if (doc.skills.length) out.push('', 'Skills', doc.skills.join(', '));
  if (doc.education.length) {
    out.push('', 'Education');
    for (const e of doc.education) {
      out.push(
        [[e.degree, e.field].filter(Boolean).join(', '), e.institution]
          .filter(Boolean)
          .join(' — ') +
          (e.end ? `   ${e.end.slice(0, 4)}` : '') +
          (e.grade ? ` | ${e.grade}` : ''),
      );
    }
  }
  if (doc.extras.length) {
    out.push('', 'Awards & Leadership');
    for (const x of doc.extras)
      out.push(`• ${[x.title, x.issuer, x.date?.slice(0, 4)].filter(Boolean).join(', ')}`);
  }
  return out.join('\n');
}
