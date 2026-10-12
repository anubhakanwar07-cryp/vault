// The single resume template (SPEC §11): preview, PDF and (structurally) DOCX all follow it.
// ATS-safe: one column, no tables/icons/images, exact section headings, plain-text dates and links.
import type { ReactNode } from 'react';
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
  background: #fff; padding: 0.6in; box-sizing: border-box; width: 8.5in; min-height: 11in; }
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

const join = (parts: (string | null | undefined)[], sep = ' | ') => parts.filter(Boolean).join(sep);
const linkText = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

export type BulletRenderer = (b: { bulletId: string; text: string }) => ReactNode;

function Bullets({
  bullets,
  render,
}: {
  bullets: { bulletId: string; text: string }[];
  render?: BulletRenderer;
}) {
  if (bullets.length === 0) return null;
  return (
    <ul className="rt-ul">
      {bullets.map((b) => (
        <li key={b.bulletId} className="rt-li" data-bullet-id={b.bulletId}>
          {render ? render(b) : b.text}
        </li>
      ))}
    </ul>
  );
}

export function ResumeTemplate({
  doc,
  renderBullet,
}: {
  doc: ResumeDoc;
  renderBullet?: BulletRenderer;
}) {
  const h = doc.header;
  return (
    <div className="rt-page">
      <h1 className="rt-name">{h.name || 'Your name'}</h1>
      <p className="rt-contact">
        {join([h.email, h.phone, h.location, ...h.links.map((l) => linkText(l.url))])}
      </p>
      {doc.headline && <p className="rt-headline">{doc.headline}</p>}

      {doc.summary && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.summary}</h2>
          <p className="rt-p">{doc.summary}</p>
        </section>
      )}

      {doc.experience.length > 0 && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.experience}</h2>
          {doc.experience.map((e) => (
            <div key={e.roleId}>
              <div className="rt-row rt-role">
                <span>{join([`${e.title}, ${e.company}`, e.location], ' — ')}</span>
                <span className="rt-dates">
                  {monthYear(e.start)} – {monthYear(e.end)}
                </span>
              </div>
              <Bullets bullets={e.bullets} render={renderBullet} />
              {e.projects?.map((p) => (
                <div key={p.name}>
                  <p className="rt-sub">{p.name}</p>
                  <Bullets bullets={p.bullets} render={renderBullet} />
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {doc.projects.length > 0 && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.projects}</h2>
          {doc.projects.map((p) => (
            <div key={p.projectId}>
              <p className="rt-role rt-p">
                {join([p.name, p.url ? linkText(p.url) : null], ' — ')}
              </p>
              <Bullets bullets={p.bullets} render={renderBullet} />
            </div>
          ))}
        </section>
      )}

      {doc.skills.length > 0 && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.skills}</h2>
          <p className="rt-p">{doc.skills.join(', ')}</p>
        </section>
      )}

      {doc.education.length > 0 && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.education}</h2>
          {doc.education.map((e, i) => (
            <div key={i} className="rt-row">
              <span>
                {join([join([e.degree, e.field], ', '), e.institution], ' — ')}
                {e.grade ? ` | ${e.grade}` : ''}
              </span>
              <span className="rt-dates">{e.end ? e.end.slice(0, 4) : ''}</span>
            </div>
          ))}
        </section>
      )}

      {doc.extras.length > 0 && (
        <section>
          <h2 className="rt-h2">{SECTION_HEADINGS.extras}</h2>
          <ul className="rt-ul">
            {doc.extras.map((x, i) => (
              <li key={i} className="rt-li">
                {join([x.title, x.issuer, x.date?.slice(0, 4)], ', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
