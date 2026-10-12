// Pure, immutable operations on a ResumeDoc's bullets (used by the editor).
import type { ResumeDoc } from './types';

type Bullet = { bulletId: string; text: string };
type Lists = Bullet[][];

/** Every bullet list in the doc (role bullets, role-project bullets, side-project bullets), by reference into `doc`. */
function lists(doc: ResumeDoc): Lists {
  return [
    ...doc.experience.flatMap((e) => [e.bullets, ...(e.projects ?? []).map((p) => p.bullets)]),
    ...doc.projects.map((p) => p.bullets),
  ];
}

export function findBullet(doc: ResumeDoc, bulletId: string): Bullet | null {
  for (const l of lists(doc)) {
    const b = l.find((x) => x.bulletId === bulletId);
    if (b) return b;
  }
  return null;
}

function edit(
  doc: ResumeDoc,
  bulletId: string,
  fn: (list: Bullet[], i: number) => void,
): ResumeDoc {
  const copy = structuredClone(doc);
  for (const l of lists(copy)) {
    const i = l.findIndex((x) => x.bulletId === bulletId);
    if (i !== -1) {
      fn(l, i);
      return copy;
    }
  }
  throw new Error(`Bullet ${bulletId} not found`);
}

export const setBulletText = (doc: ResumeDoc, bulletId: string, text: string) =>
  edit(doc, bulletId, (l, i) => (l[i] = { bulletId, text }));

export const replaceBullet = (doc: ResumeDoc, bulletId: string, next: Bullet) =>
  edit(doc, bulletId, (l, i) => (l[i] = next));

/** Removes a bullet; empty side projects and empty role-project groups are dropped. Roles stay (timeline). */
export function removeBullet(doc: ResumeDoc, bulletId: string): ResumeDoc {
  const out = edit(doc, bulletId, (l, i) => void l.splice(i, 1));
  for (const e of out.experience)
    if (e.projects) e.projects = e.projects.filter((p) => p.bullets.length > 0);
  out.projects = out.projects.filter((p) => p.bullets.length > 0);
  return out;
}

/** Moves a bullet up (-1) or down (+1) within its own list. No-op at the ends. */
export const moveBullet = (doc: ResumeDoc, bulletId: string, dir: -1 | 1) =>
  edit(doc, bulletId, (l, i) => {
    const j = i + dir;
    if (j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j]!, l[i]!];
  });

export function bulletIds(doc: ResumeDoc): string[] {
  return lists(doc).flatMap((l) => l.map((b) => b.bulletId));
}

/**
 * Rough page-fit estimate in rendered lines for one page (SPEC §10 page-fit indicator).
 * ~95 characters per line at 10.5pt across a 7in text column; ~56 lines per page.
 */
export const LINES_PER_PAGE = 56;
export function estimateLines(doc: ResumeDoc): number {
  const wrap = (s: string, width = 95) => Math.max(1, Math.ceil(s.length / width));
  let n = 3; // name, contact, spacing
  if (doc.headline) n += 1;
  if (doc.summary) n += 1.6 + wrap(doc.summary);
  if (doc.experience.length) n += 1.6;
  for (const e of doc.experience) {
    n += 1.2;
    for (const b of e.bullets) n += wrap(b.text, 90);
    for (const p of e.projects ?? []) n += 1 + p.bullets.reduce((s, b) => s + wrap(b.text, 90), 0);
  }
  if (doc.projects.length) n += 1.6;
  for (const p of doc.projects) n += 1.2 + p.bullets.reduce((s, b) => s + wrap(b.text, 90), 0);
  if (doc.skills.length) n += 1.6 + wrap(doc.skills.join(', '));
  if (doc.education.length) n += 1.6 + doc.education.length;
  if (doc.extras.length) n += 1.6 + doc.extras.length;
  return Math.round(n);
}
