'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import {
  achievementIdsFor,
  deleteVaultItem,
  saveAchievement,
  saveEducation,
  saveExtra,
  saveProject,
  saveRole,
  type VaultEntity,
} from '@/lib/db/queries/vault';
import {
  achievementInput,
  educationInput,
  extraInput,
  projectInput,
  roleInput,
} from '@/lib/llm/schemas/vault';
import { refreshAchievements } from '@/lib/vault/embed';

const id = z.uuid().nullable();

function embeddingWarning(err: string | null): string | undefined {
  return err
    ? 'Saved, but the search index could not be updated. It will retry on the next edit.'
    : undefined;
}

export async function saveRoleAction(
  rawId: string | null,
  raw: unknown,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = roleInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const roleId = await saveRole(user.id, id.parse(rawId), parsed.data);
  // Role title/company are part of the embedding text of its achievements.
  const { embeddingError } = rawId
    ? await refreshAchievements(user.id, await achievementIdsFor(user.id, { roleId }))
    : { embeddingError: null };
  revalidatePath('/vault');
  return { ok: true, data: roleId, warning: embeddingWarning(embeddingError) };
}

export async function saveProjectAction(
  rawId: string | null,
  raw: unknown,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = projectInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const projectId = await saveProject(user.id, id.parse(rawId), parsed.data);
  // Project name/one-liner feed the embedding text; proof_url feeds completeness.
  const { embeddingError } = rawId
    ? await refreshAchievements(user.id, await achievementIdsFor(user.id, { projectId }))
    : { embeddingError: null };
  revalidatePath('/vault');
  return { ok: true, data: projectId, warning: embeddingWarning(embeddingError) };
}

export async function saveAchievementAction(
  rawId: string | null,
  raw: unknown,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = achievementInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const achievementId = await saveAchievement(user.id, id.parse(rawId), parsed.data);
  const { embeddingError } = await refreshAchievements(user.id, [achievementId]);
  revalidatePath('/vault');
  revalidatePath('/dashboard');
  return { ok: true, data: achievementId, warning: embeddingWarning(embeddingError) };
}

export async function saveEducationAction(
  rawId: string | null,
  raw: unknown,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = educationInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const eduId = await saveEducation(user.id, id.parse(rawId), parsed.data);
  revalidatePath('/vault');
  return { ok: true, data: eduId };
}

export async function saveExtraAction(
  rawId: string | null,
  raw: unknown,
): Promise<ActionResult<string>> {
  const user = await requireUser();
  const parsed = extraInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const extraId = await saveExtra(user.id, id.parse(rawId), parsed.data);
  revalidatePath('/vault');
  return { ok: true, data: extraId };
}

const entity = z.enum(['role', 'project', 'achievement', 'education', 'extra', 'source']);

export async function deleteVaultItemAction(
  rawEntity: VaultEntity,
  rawId: string,
): Promise<ActionResult> {
  const user = await requireUser();
  await deleteVaultItem(user.id, entity.parse(rawEntity), z.uuid().parse(rawId));
  revalidatePath('/vault');
  revalidatePath('/dashboard');
  return { ok: true, data: undefined };
}
