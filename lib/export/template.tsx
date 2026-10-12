// The single resume template (SPEC §11). Written once against a tiny element factory so the same
// definition renders to React (preview/editor) and to an HTML string (PDF) — Next.js forbids
// react-dom/server in server code, and two hand-kept templates would drift.
// ATS-safe: one column, no tables/icons/images, exact section headings, plain-text dates and links.
import { createElement, Fragment, type ReactNode } from 'react';
import { monthYear } from '@/lib/pipeline/assemble-utils';
import type { ResumeDoc } from '@/lib/resume/types';

export const SECTION_HEADINGS = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  education: 'Education',
  extras: 'Awards & Leadership',
} as const;

/** Scoped CSS for the page (also inlined into the PDF HTML). */
export const RESUME_CSS = `
.rt-page { font-family: Inter, Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.32; color: #111;
  background: #fff; padding: 0.6in; box-sizing: border-box; width: 8.27in; min-height: 11.69in; }
.rt-page * { box-sizing: border-box; }
.rt-name { font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.rt-contact { margin: 2pt 0 0; font-size: 9.5pt; color: #333; }
.rt-headline { margin: 4pt 0 0; font-weight: 600; }
.rt-h2 { font-size: 10.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin: 10pt 0 3pt;
  padding-bottom: 1pt; border-bottom: 0.75pt solid #999; }
.rt-row { display: flex; justify-content: space-between; gap: 12pt; align-items: baseline; }
.rt-role { font-weight: 600; margin: 5pt 0 1pt; }
.rt-dates { white-space: nowrap; font-size: 9.5pt; color: #333; }
.rt-sub { font-style: italic; margin: 2pt 0 0; font-size: 10pt; }
.rt-ul { margin: 1pt 0 0; padding-left: 13pt; }
.rt-li { margin: 0 0 1.5pt; }
.rt-p { margin: 0; }
`;

type Props = { className?: string; 'data-bullet-id'?: string; key?: string | number } | null;
type Child<N> = N | string | null | undefined | false;
export type H<N> = (tag: string, props: Props, ...children: (Child<N> | Child<N>[])[]) => N;

const join = (parts: (string | null | undefined)[], sep = ' | ') => parts.filter(Boolean).join(sep);
const linkText = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

type Bullet = { bulletId: string; text: string };
export type BulletRenderer<N> = (b: Bullet) => N | string;

function build<N>(doc: ResumeDoc, h: H<N>, renderBullet?: BulletRenderer<N>): N {
  const bullets = (list: Bullet[]) =>
    list.length === 0
      ? null
      : h(
          'ul',
          { className: 'rt-ul' },
          list.map((b) =>
            h(
              'li',
              { key: b.bulletId, className: 'rt-li', 'data-bullet-id': b.bulletId },
              renderBullet ? renderBullet(b) : b.text,
            ),
          ),
        );
  const section = (key: string, title: string, ...children: (Child<N> | Child<N>[])[]) =>
    h('section', { key }, h('h2', { className: 'rt-h2' }, title), ...children);
  const hd = doc.header;

  return h(
    'div',
    { className: 'rt-page' },
    h('h1', { className: 'rt-name' }, hd.name || 'Your name'),
    h(
      'p',
      { className: 'rt-contact' },
      join([hd.email, hd.phone, hd.location, ...hd.links.map((l) => linkText(l.url))]),
    ),
    doc.headline ? h('p', { className: 'rt-headline' }, doc.headline) : null,
    doc.summary
      ? section('summary', SECTION_HEADINGS.summary, h('p', { className: 'rt-p' }, doc.summary))
      : null,
    doc.experience.length
      ? section(
          'experience',
          SECTION_HEADINGS.experience,
          doc.experience.map((e) =>
            h(
              'div',
              { key: e.roleId },
              h(
                'div',
                { className: 'rt-row rt-role' },
                h('span', null, join([`${e.title}, ${e.company}`, e.location], ' — ')),
                h('span', { className: 'rt-dates' }, `${monthYear(e.start)} – ${monthYear(e.end)}`),
              ),
              bullets(e.bullets),
              (e.projects ?? []).map((p) =>
                h(
                  'div',
                  { key: p.name },
                  h('p', { className: 'rt-sub' }, p.name),
                  bullets(p.bullets),
                ),
              ),
            ),
          ),
        )
      : null,
    doc.projects.length
      ? section(
          'projects',
          SECTION_HEADINGS.projects,
          doc.projects.map((p) =>
            h(
              'div',
              { key: p.projectId },
              h(
                'p',
                { className: 'rt-role rt-p' },
                join([p.name, p.url ? linkText(p.url) : null], ' — '),
              ),
              bullets(p.bullets),
            ),
          ),
        )
      : null,
    doc.skills.length
      ? section(
          'skills',
          SECTION_HEADINGS.skills,
          h('p', { className: 'rt-p' }, doc.skills.join(', ')),
        )
      : null,
    doc.education.length
      ? section(
          'education',
          SECTION_HEADINGS.education,
          doc.education.map((e, i) =>
            h(
              'div',
              { key: i, className: 'rt-row' },
              h(
                'span',
                null,
                join([join([e.degree, e.field], ', '), e.institution], ' — ') +
                  (e.grade ? ` | ${e.grade}` : ''),
              ),
              h('span', { className: 'rt-dates' }, e.end ? e.end.slice(0, 4) : ''),
            ),
          ),
        )
      : null,
    doc.extras.length
      ? section(
          'extras',
          SECTION_HEADINGS.extras,
          h(
            'ul',
            { className: 'rt-ul' },
            doc.extras.map((x, i) =>
              h(
                'li',
                { key: i, className: 'rt-li' },
                join([x.title, x.issuer, x.date?.slice(0, 4)], ', '),
              ),
            ),
          ),
        )
      : null,
  );
}

// ---- React rendering (preview + editor)
const reactH: H<ReactNode> = (tag, props, ...children) =>
  createElement(
    tag,
    props ?? undefined,
    ...children.map((c) => (Array.isArray(c) ? createElement(Fragment, null, ...c) : c)),
  );

export function ResumeTemplate({
  doc,
  renderBullet,
}: {
  doc: ResumeDoc;
  renderBullet?: BulletRenderer<ReactNode>;
}) {
  return build(doc, reactH, renderBullet);
}

// ---- HTML string rendering (PDF)
type Html = { html: string };
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const htmlH: H<Html> = (tag, props, ...children) => {
  const attrs = [
    props?.className ? ` class="${esc(props.className)}"` : '',
    props?.['data-bullet-id'] ? ` data-bullet-id="${esc(props['data-bullet-id'])}"` : '',
  ].join('');
  const inner = children
    .flat()
    .map((c) =>
      c === null || c === undefined || c === false ? '' : typeof c === 'string' ? esc(c) : c.html,
    )
    .join('');
  return { html: `<${tag}${attrs}>${inner}</${tag}>` };
};

export function resumeBodyHtml(doc: ResumeDoc): string {
  return build(doc, htmlH).html;
}
