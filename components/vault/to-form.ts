import type { Education, Extra, Project, Role } from '@/lib/db/queries/vault';
import { toMonth, type FormValues } from './fields';

const s = (v: string | null | undefined) => v ?? '';

export const roleToForm = (r?: Role): FormValues => ({
  company: s(r?.company),
  title: s(r?.title),
  startDate: toMonth(r?.startDate),
  endDate: toMonth(r?.endDate),
  location: s(r?.location),
  employmentType: s(r?.employmentType),
  companyContext: s(r?.companyContext),
});

export const projectToForm = (p?: Partial<Project>): FormValues => ({
  name: s(p?.name),
  roleId: s(p?.roleId),
  oneLiner: s(p?.oneLiner),
  ownership: s(p?.ownership),
  proofUrl: s(p?.proofUrl),
  isSideProject: p?.isSideProject ?? false,
  startDate: toMonth(p?.startDate),
  endDate: toMonth(p?.endDate),
});

export const educationToForm = (e?: Education): FormValues => ({
  institution: s(e?.institution),
  degree: s(e?.degree),
  field: s(e?.field),
  grade: s(e?.grade),
  startDate: toMonth(e?.startDate),
  endDate: toMonth(e?.endDate),
  highlights: e?.highlights ?? [],
});

export const extraToForm = (x?: Extra): FormValues => ({
  kind: s(x?.kind),
  title: s(x?.title),
  issuer: s(x?.issuer),
  date: toMonth(x?.date),
  description: s(x?.description),
  tags: x?.tags ?? [],
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 2023 – Present" style, matching the export template (SPEC §11). */
export function formatRange(start: string | null, end: string | null, openEnded = true): string {
  const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  if (!start && !end) return '';
  if (!start) return fmt(end!);
  return `${fmt(start)} – ${end ? fmt(end) : openEnded ? 'Present' : ''}`.trim();
}
