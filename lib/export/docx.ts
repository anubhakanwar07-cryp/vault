import 'server-only';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { dateRange } from '@/lib/pipeline/assemble-utils';
import { emphasize } from '@/lib/resume/emphasis';
import type { ResumeDoc } from '@/lib/resume/types';
import { extraTitle, safeHref, SECTION_HEADINGS } from './template';

const FONT = 'Calibri';
const SIZE = 21; // half-points: 10.5pt
const LINK = '1A56B0';
const join = (parts: (string | null | undefined)[], sep = ' | ') => parts.filter(Boolean).join(sep);

type Run = TextRun | ExternalHyperlink;
const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? SIZE, bold: o.bold, italics: o.italics });
const link = (text: string, url: string, size = SIZE, bold = false) =>
  new ExternalHyperlink({
    link: safeHref(url),
    children: [new TextRun({ text, font: FONT, size, bold, color: LINK, underline: {} })],
  });

const heading = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '222222', space: 1 } },
    children: [run(text, { bold: true, size: 23 })],
  });

/** Plain and bold runs for one line, with the same emphasis as the template. */
const richRuns = (text: string, terms: string[]) =>
  emphasize(text, terms).map((s) => run(s.text, { bold: s.bold }));

const bullet = (text: string, terms: string[], level = 0) =>
  new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 40 },
    children: richRuns(text, terms),
  });

/** Bold left text with right-aligned italic dates via a right tab stop (no tables — ATS-safe). */
const headRow = (left: Run[], dates: string) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 80, after: 20 },
    children: [...left, ...(dates ? [run(`\t${dates}`, { italics: true, size: 20 })] : [])],
  });

/** DOCX export: same layout, order and exact headings as the template (SPEC §11). */
export async function renderDocx(doc: ResumeDoc): Promise<Buffer> {
  const h = doc.header;
  const terms = doc.emphasis ?? [];
  const contact: Run[] = [];
  const add = (r: Run) => {
    if (contact.length) contact.push(run('  |  ', { size: 20 }));
    contact.push(r);
  };
  if (h.phone) add(run(h.phone, { size: 20 }));
  if (h.email) add(link(h.email, `mailto:${h.email}`, 20));
  for (const l of h.links) add(link(l.label || l.url, l.url, 20));

  const children: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [run((h.name || 'Your name').toUpperCase(), { bold: true, size: 40 })],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: contact }),
  ];

  if (doc.education.length) {
    children.push(heading(SECTION_HEADINGS.education));
    for (const e of doc.education)
      children.push(
        headRow([run(e.institution ?? '', { bold: true })], dateRange(e.start, e.end)),
        new Paragraph({
          children: [run(join([join([e.degree, e.field], ' in '), e.grade]), { italics: true })],
        }),
      );
  }
  if (doc.experience.length) {
    children.push(heading(SECTION_HEADINGS.experience));
    for (const e of doc.experience) {
      children.push(
        headRow([run(`${e.title} – ${e.company}`, { bold: true })], dateRange(e.start, e.end)),
      );
      children.push(...e.bullets.map((b) => bullet(b.text, terms)));
      for (const p of e.projects ?? []) {
        children.push(
          new Paragraph({
            spacing: { before: 40, after: 20 },
            children: [
              run(p.name, { bold: true }),
              ...(p.oneLiner ? [run(' — '), ...richRuns(p.oneLiner, terms)] : []),
            ],
          }),
        );
        children.push(...p.bullets.map((b) => bullet(b.text, terms, 1)));
      }
    }
  }
  if (doc.projects.length) {
    children.push(heading(SECTION_HEADINGS.projects));
    for (const p of doc.projects) {
      children.push(
        headRow(
          [p.url ? link(p.name, p.url, SIZE, true) : run(p.name, { bold: true })],
          dateRange(p.start, p.end),
        ),
      );
      children.push(...p.bullets.map((b) => bullet(b.text, terms)));
    }
  }
  const skillLines = doc.skillGroups?.length
    ? doc.skillGroups
    : doc.skills.length
      ? [{ label: '', items: doc.skills }]
      : [];
  if (skillLines.length) {
    children.push(heading(SECTION_HEADINGS.skills));
    for (const g of skillLines)
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            ...(g.label ? [run(`${g.label}: `, { bold: true })] : []),
            run(g.items.join(', ')),
          ],
        }),
      );
  }
  if (doc.extras.length) {
    children.push(heading(SECTION_HEADINGS.extras));
    for (const x of doc.extras)
      children.push(
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: 40 },
          children: [
            run(extraTitle(x), { bold: true }),
            ...(x.description ? [run(` — ${x.description}`)] : []),
          ],
        }),
      );
  }

  const file = new Document({
    creator: 'Resume Tailor',
    title: h.name,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 280, hanging: 200 } } },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 560, hanging: 200 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            // US Letter, 0.5in top/bottom, 0.6in sides (twips).
            size: { width: 12240, height: 15840 },
            margin: { top: 720, bottom: 720, left: 864, right: 864 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(file);
}
