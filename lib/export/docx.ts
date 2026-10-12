import 'server-only';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from 'docx';
import { monthYear } from '@/lib/pipeline/assemble-utils';
import type { ResumeDoc } from '@/lib/resume/types';
import { SECTION_HEADINGS } from './template';

const FONT = 'Arial';
const linkText = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const join = (parts: (string | null | undefined)[], sep = ' | ') => parts.filter(Boolean).join(sep);

const heading = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } },
    children: [new TextRun({ text, bold: true, font: FONT, size: 21, allCaps: true })],
  });

const bullet = (text: string) =>
  new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 30 },
    children: [new TextRun({ text, font: FONT, size: 21 })],
  });

/** Left text with right-aligned plain-text dates via a right tab stop (no tables — ATS-safe). */
const lineWithDates = (left: string, right: string, bold = true) =>
  new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 100, after: 20 },
    children: [
      new TextRun({ text: left, bold, font: FONT, size: 21 }),
      new TextRun({ text: `\t${right}`, font: FONT, size: 19 }),
    ],
  });

/** DOCX export: same order and exact headings as the template (SPEC §11). */
export async function renderDocx(doc: ResumeDoc): Promise<Buffer> {
  const h = doc.header;
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: h.name, bold: true, font: FONT, size: 36 })] }),
    new Paragraph({
      children: [
        new TextRun({
          text: join([h.email, h.phone, h.location, ...h.links.map((l) => linkText(l.url))]),
          font: FONT,
          size: 19,
        }),
      ],
    }),
  ];
  if (doc.headline)
    children.push(
      new Paragraph({
        spacing: { before: 60 },
        children: [new TextRun({ text: doc.headline, bold: true, font: FONT, size: 21 })],
      }),
    );
  if (doc.summary)
    children.push(
      heading(SECTION_HEADINGS.summary),
      new Paragraph({ children: [new TextRun({ text: doc.summary, font: FONT, size: 21 })] }),
    );

  if (doc.experience.length) {
    children.push(heading(SECTION_HEADINGS.experience));
    for (const e of doc.experience) {
      children.push(
        lineWithDates(
          join([`${e.title}, ${e.company}`, e.location], ' — '),
          `${monthYear(e.start)} – ${monthYear(e.end)}`,
        ),
      );
      children.push(...e.bullets.map((b) => bullet(b.text)));
      for (const p of e.projects ?? []) {
        children.push(
          new Paragraph({
            spacing: { before: 40 },
            children: [new TextRun({ text: p.name, italics: true, font: FONT, size: 20 })],
          }),
        );
        children.push(...p.bullets.map((b) => bullet(b.text)));
      }
    }
  }
  if (doc.projects.length) {
    children.push(heading(SECTION_HEADINGS.projects));
    for (const p of doc.projects) {
      children.push(
        new Paragraph({
          spacing: { before: 100 },
          children: [
            new TextRun({
              text: join([p.name, p.url ? linkText(p.url) : null], ' — '),
              bold: true,
              font: FONT,
              size: 21,
            }),
          ],
        }),
      );
      children.push(...p.bullets.map((b) => bullet(b.text)));
    }
  }
  if (doc.skills.length)
    children.push(
      heading(SECTION_HEADINGS.skills),
      new Paragraph({
        children: [new TextRun({ text: doc.skills.join(', '), font: FONT, size: 21 })],
      }),
    );
  if (doc.education.length) {
    children.push(heading(SECTION_HEADINGS.education));
    for (const e of doc.education) {
      children.push(
        lineWithDates(
          join([join([e.degree, e.field], ', '), e.institution], ' — ') +
            (e.grade ? ` | ${e.grade}` : ''),
          e.end ? e.end.slice(0, 4) : '',
          false,
        ),
      );
    }
  }
  if (doc.extras.length) {
    children.push(heading(SECTION_HEADINGS.extras));
    children.push(
      ...doc.extras.map((x) => bullet(join([x.title, x.issuer, x.date?.slice(0, 4)], ', '))),
    );
  }

  const file = new Document({
    creator: 'Resume Tailor',
    title: h.name,
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
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
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { margin: { top: 864, bottom: 864, left: 864, right: 864 } } },
        children,
      },
    ],
  });
  return Packer.toBuffer(file);
}
