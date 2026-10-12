'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { acceptProposals, runInterviewTurn, type TurnResult } from '@/lib/vault/interview';

export async function interviewTurnAction(
  projectId: string,
  messages: unknown,
  finish: boolean,
): Promise<ActionResult<TurnResult>> {
  const user = await requireUser();
  try {
    return { ok: true, data: await runInterviewTurn(user.id, projectId, messages, finish) };
  } catch (err) {
    console.error('[interviewer] turn failed', err);
    return { ok: false, error: 'The interviewer hit a snag. Try sending that again.' };
  }
}

export async function acceptProposalsAction(
  projectId: string,
  proposals: unknown,
): Promise<ActionResult<{ saved: number }>> {
  const user = await requireUser();
  const { ids, embeddingError } = await acceptProposals(user.id, projectId, proposals);
  revalidatePath('/vault');
  revalidatePath('/dashboard');
  return {
    ok: true,
    data: { saved: ids.length },
    warning: embeddingError
      ? 'Saved, but search indexing failed — edit an achievement to retry.'
      : undefined,
  };
}
