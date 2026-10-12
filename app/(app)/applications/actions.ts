'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import {
  createApplication,
  deleteApplication,
  updateApplicationNotes,
  updateApplicationStatus,
} from '@/lib/db/queries/applications';
import { ROLE_FAMILIES } from '@/lib/llm/schemas/vault';
import { APPLICATION_STATUSES } from '@/lib/tracker/stats';

const empty = (v: unknown) => (v === '' || v === undefined ? null : v);

const newApplication = z
  .object({
    resumeId: z.preprocess(empty, z.uuid().nullable()),
    company: z.string().trim().min(1, 'Company is required'),
    roleTitle: z.string().trim().min(1, 'Role is required'),
    roleFamily: z.preprocess(empty, z.enum(ROLE_FAMILIES).nullable()),
    isTailored: z.boolean(),
    appliedAt: z.preprocess(empty, z.iso.date().nullable()),
    channel: z.preprocess(
      empty,
      z.enum(['portal', 'referral', 'cold-email', 'linkedin']).nullable(),
    ),
    status: z.enum(APPLICATION_STATUSES).default('applied'),
    notes: z.preprocess(empty, z.string().trim().nullable()),
  })
  .refine((a) => !a.isTailored || a.resumeId, {
    message: 'Tailored applications need a resume version',
    path: ['resumeId'],
  })
  .refine((a) => a.isTailored || a.roleFamily, {
    message: 'Pick a role family so the comparison is fair',
    path: ['roleFamily'],
  });

export async function createApplicationAction(raw: unknown): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = newApplication.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const id = await createApplication(user.id, parsed.data);
  revalidatePath('/applications');
  revalidatePath('/dashboard');
  return { ok: true, data: id };
}

export async function updateStatusAction(id: string, status: string): Promise<ActionResult> {
  const user = await requireUser();
  await updateApplicationStatus(
    user.id,
    z.uuid().parse(id),
    z.enum(APPLICATION_STATUSES).parse(status),
  );
  revalidatePath('/applications');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}

export async function updateNotesAction(id: string, notes: string): Promise<ActionResult> {
  const user = await requireUser();
  await updateApplicationNotes(user.id, z.uuid().parse(id), notes.trim() || null);
  revalidatePath('/applications');
  return { ok: true, data: undefined };
}

export async function deleteApplicationAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await deleteApplication(user.id, z.uuid().parse(id));
  revalidatePath('/applications');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}
