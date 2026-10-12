'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { upsertProfile } from '@/lib/db/queries/vault';
import { deleteStyleRule, setStyleRuleActive } from '@/lib/learning/style-rules';
import { profileInput } from '@/lib/llm/schemas/vault';

/** Links arrive as plain URLs from the tag input; the visible label is the URL without protocol (SPEC §11). */
function linksFromUrls(urls: unknown) {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
    .map((u) => {
      const url = /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`;
      return { label: url.replace(/^https?:\/\//i, '').replace(/\/$/, ''), url };
    });
}

export async function saveProfileAction(
  raw: Record<string, unknown>,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = profileInput.safeParse({ ...raw, links: linksFromUrls(raw.links) });
  if (!parsed.success) return invalid(parsed.error);
  await upsertProfile(user.id, parsed.data);
  revalidatePath('/profile');
  revalidatePath('/dashboard');
  return { ok: true, data: user.id };
}

export async function toggleStyleRuleAction(id: string, active: boolean): Promise<ActionResult> {
  const user = await requireUser();
  await setStyleRuleActive(user.id, z.uuid().parse(id), active);
  revalidatePath('/profile');
  return { ok: true, data: undefined };
}

export async function deleteStyleRuleAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  await deleteStyleRule(user.id, z.uuid().parse(id));
  revalidatePath('/profile');
  return { ok: true, data: undefined };
}

export async function deleteAccountAction(confirmation: string): Promise<ActionResult> {
  const user = await requireUser();
  if (confirmation.trim().toUpperCase() !== 'DELETE')
    return { ok: false, error: 'Type DELETE to confirm.' };
  const { deleteAccount } = await import('@/lib/account');
  await deleteAccount(user.id);
  const { createSupabaseServerClient } = await import('@/lib/supabase/server');
  await (await createSupabaseServerClient()).auth.signOut();
  return { ok: true, data: undefined };
}
