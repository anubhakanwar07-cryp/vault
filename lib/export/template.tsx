// The single resume template (SPEC §11). Written once against a tiny element factory so the same
// definition renders to React (preview/editor) and to an HTML string (PDF) — Next.js forbids
// react-dom/server in server code, and two hand-kept templates would drift.
// Layout follows the owner's own resume (Phase 8); docx.ts mirrors it.
// ATS-safe: one column, no tables/icons/images, exact section headings, plain-text dates.
import { createElement, Fragment, type ReactNode } from 'react';
import { dateRange } from '@/lib/pipeline/assemble-utils';
import { emphasize } from '@/lib/resume/emphasis';
import type { ResumeDoc } from '@/lib/resume/types';

export const SECTION_HEADINGS = {
  education: 'Education',
  experience: 'Experience',
  projects: 'Projects',
  skills: 'Skills',
  extras: 'Awards / Position of Responsibility',
} as const;

/** Scoped CSS for the page (also inlined into the PDF HTML). US Letter. */
export const RESUME_CSS = `
.rt-page { font-family: Lato, Carlito, Calibri, Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.3;
  color: #111; background: #fff; padding: 0.5in 0.6in; box-sizing: border-box; width: 8.5in; min-height: 11in; }
.rt-page * { box-sizing: border-box; }
.rt-name { font-size: 20pt; font-weight: 700; margin: 0; text-align: center; letter-spacing: 0.01em; }
.rt-contact { margin: 3pt 0 0; font-size: 10pt; text-align: center; }
.rt-a { color: #1a56b0; text-decoration: underline; }
.rt-h2 { font-size: 11.5pt; font-weight: 700; margin: 9pt 0 4pt; padding-bottom: 1.5pt; border-bottom: 0.75pt solid #222; }
.rt-row { display: flex; justify-content: space-between; gap: 12pt; align-items: baseline; }
.rt-head { font-weight: 700; margin: 4pt 0 1pt; }
.rt-dates { white-space: nowrap; font-weight: 400; font-style: italic; color: #444; font-size: 10pt; }
.rt-sub { margin: 1pt 0 0; }
.rt-it { font-style: italic; color: #444; }
.rt-ul { margin: 1pt 0 2pt; padding-left: 14pt; }
.rt-proj .rt-ul { padding-left: 28pt; }
.rt-li { margin: 0 0 2pt; }
.rt-p { margin: 0 0 2pt; }
.rt-b { font-weight: 700; }
`;

type Props = {
  className?: string;
  href?: string;
  'data-bullet-id'?: string;
  key?: string | number;
} | null;
type Child<N> = N | string | null | undefined | false;
export type H<N> = (tag: string, props: Props, ...children: (Child<N> | Child<N>[])[]) => N;

/** Only web and mail links are rendered as links; anything else is shown as https. */
export const safeHref = (url: string) =>
  /^(https?:|mailto:)/i.test(url) ? url : `https://${url.replace(/^[a-z][\w+.-]*:\/*/i, '')}`;
const join = (parts: (string | null | undefined)[], sep = ' | ') => parts.filter(Boolean).join(sep);

type Bullet = { bulletId: string; text: string };
/** Renders a bullet's contents; `content` is the bullet text with emphasis already applied. */
export type BulletRenderer<N> = (b: Bullet, content: (N | string)[]) => N | string;

function build<N>(doc: ResumeDoc, h: H<N>, renderBullet?: BulletRenderer<N>): N {
  const terms = doc.emphasis ?? [];
  const b = (text: string, key?: string | number) => h('strong', { className: 'rt-b', key }, text);
  const rich = (text: string): (N | string)[] =>
    emphasize(text, terms).map((s, i) => (s.bold ? b(s.text, i) : s.text));
  const bullets = (list: Bullet[]) =>
    list.length === 0
      ? null
      : h(
          'ul',
          { className: 'rt-ul' },
          list.map((x) =>
            h(
              'li',
              { key: x.bulletId, className: 'rt-li', 'data-bullet-id': x.bulletId },
              renderBullet ? renderBullet(x, rich(x.text)) : rich(x.text),
            ),
          ),
        );
  const section = (key: string, title: string, ...children: (Child<N> | Child<N>[])[]) =>
    h('section', { key }, h('h2', { className: 'rt-h2' }, title), ...children);
  const headRow = (left: Child<N> | Child<N>[], dates: string, key?: string | number) =>
    h(
      'div',
      { key, className: 'rt-row rt-head' },
      h('span', null, left),
      dates ? h('span', { className: 'rt-dates' }, dates) : null,
    );
  const hd = doc.header;

  const contact: (N | string)[] = [];
  const addContact = (part: N | string) => {
    if (contact.length) contact.push('  |  ');
    contact.push(part);
  };
  if (hd.phone) addContact(hd.phone);
  if (hd.email)
    addContact(h('a', { key: 'email', className: 'rt-a', href: `mailto:${hd.email}` }, hd.email));
  for (const l of hd.links)
    addContact(h('a', { key: l.url, className: 'rt-a', href: safeHref(l.url) }, l.label || l.url));

  const skillLines = doc.skillGroups?.length
    ? doc.skillGroups.map((g) => ({ label: g.label, items: g.items }))
    : doc.skills.length
      ? [{ label: null, items: doc.skills }]
      : [];

  return h(
    'div',
    { className: 'rt-page' },
    h('h1', { className: 'rt-name' }, (hd.name || 'Your name').toUpperCase()),
    contact.length ? h('p', { className: 'rt-contact' }, contact) : null,
    doc.education.length
      ? section(
          'education',
          SECTION_HEADINGS.education,
          doc.education.map((e, i) =>
            h(
              'div',
              { key: i },
              headRow(e.institution ?? '', dateRange(e.start, e.end)),
              h(
                'p',
                { className: 'rt-sub rt-it' },
                join([join([e.degree, e.field], ' in '), e.grade]),
              ),
            ),
          ),
        )
      : null,
    doc.experience.length
      ? section(
          'experience',
          SECTION_HEADINGS.experience,
          doc.experience.map((e) =>
            h(
              'div',
              { key: e.roleId },
              headRow(`${e.title} – ${e.company}`, dateRange(e.start, e.end)),
              bullets(e.bullets),
              (e.projects ?? []).map((p) =>
                h(
                  'div',
                  { key: p.name, className: 'rt-proj' },
                  h(
                    'p',
                    { className: 'rt-sub' },
                    b(p.name),
                    p.oneLiner ? ' — ' : null,
                    p.oneLiner ? rich(p.oneLiner) : null,
                  ),
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
              headRow(
                p.url ? h('a', { className: 'rt-a', href: safeHref(p.url) }, p.name) : p.name,
                dateRange(p.start, p.end),
              ),
              bullets(p.bullets),
            ),
          ),
        )
      : null,
    skillLines.length
      ? section(
          'skills',
          SECTION_HEADINGS.skills,
          skillLines.map((g, i) =>
            h(
              'p',
              { key: i, className: 'rt-p' },
              g.label ? b(`${g.label}:`) : null,
              g.label ? ' ' : null,
              g.items.join(', '),
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
                b(extraTitle(x)),
                x.description ? ' — ' : null,
                x.description ?? null,
              ),
            ),
          ),
        )
      : null,
  );
}

/** "Title, Issuer", plus the year when the title doesn't already carry it. */
export function extraTitle(x: ResumeDoc['extras'][number]): string {
  const base = join([x.title, x.issuer], ', ');
  const year = x.date?.slice(0, 4);
  return year && !base.includes(year) ? `${base} (${year})` : base;
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
    props?.href ? ` href="${esc(props.href)}"` : '',
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
