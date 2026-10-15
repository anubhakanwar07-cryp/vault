'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import type { ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { maybeDeriveStyleRules } from '@/lib/learning/style-rules';
import {
  alternativesFor,
  deleteBullet,
  editBullet,
  EditorError,
  improveWeakestLine,
  markFinal,
  moveBullet,
  regenerateBullet,
  swapBullet,
  type Alternative,
  type EditResult,
} from '@/lib/resume/editor';
import { MAX_BULLET_CHARS } from '@/lib/resume/limits';

const id = z.uuid();

async function run<T>(fn: (userId: string) => Promise<T>): Promise<ActionResult<T>> {
  const user = await requireUser();
  try {
    return { ok: true, data: await fn(user.id) };
  } catch (err) {
    if (err instanceof EditorError) return { ok: false, error: err.message };
    if (err instanceof z.ZodError) return { ok: false, error: 'Invalid request.' };
    console.error('[editor]', err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function editBulletAction(resumeId: string, bulletId: string, text: string) {
  return run<EditResult>(async (u) => {
    const res = await editBullet(
      u,
      id.parse(resumeId),
      id.parse(bulletId),
      z.string().max(MAX_BULLET_CHARS).parse(text),
    );
    // Learn from edits without slowing the editor down (SPEC §9.9: every 5 new edits).
    after(() => maybeDeriveStyleRules(u));
    return res;
  });
}
export async function regenerateBulletAction(resumeId: string, bulletId: string) {
  return run<EditResult>((u) => regenerateBullet(u, id.parse(resumeId), id.parse(bulletId)));
}
export async function alternativesAction(resumeId: string, bulletId: string) {
  return run<Alternative[]>((u) => alternativesFor(u, id.parse(resumeId), id.parse(bulletId)));
}
export async function swapBulletAction(resumeId: string, bulletId: string, achievementId: string) {
  return run<EditResult>((u) =>
    swapBullet(u, id.parse(resumeId), id.parse(bulletId), id.parse(achievementId)),
  );
}
export async function deleteBulletAction(resumeId: string, bulletId: string) {
  return run<EditResult>((u) => deleteBullet(u, id.parse(resumeId), id.parse(bulletId)));
}
export async function moveBulletAction(resumeId: string, bulletId: string, dir: number) {
  return run<EditResult>((u) =>
    moveBullet(u, id.parse(resumeId), id.parse(bulletId), dir < 0 ? -1 : 1),
  );
}
export async function improveWeakestAction(resumeId: string) {
  return run<EditResult>((u) => improveWeakestLine(u, id.parse(resumeId)));
}
export async function markFinalAction(resumeId: string, jobId: string) {
  const res = await run<null>(async (u) => {
    await markFinal(u, id.parse(resumeId));
    return null;
  });
  revalidatePath(`/tailor/${jobId}/resume/${resumeId}`);
  return res;
}
