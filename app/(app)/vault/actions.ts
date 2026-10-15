'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { invalid, type ActionResult } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import {
  achievementIdsFor,
  deleteVaultItem,
  NotFoundError,
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

const GONE = 'That item no longer exists in your vault. Reload the page and try again.';

/** Runs a save; a stale or foreign id becomes a friendly error instead of a crash. */
async function guarded<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: GONE };
    throw err;
  }
}

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
  const saved = await guarded(() => saveRole(user.id, id.parse(rawId), parsed.data));
  if (!saved.ok) return saved;
  const roleId = saved.data;
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
  const saved = await guarded(() => saveProject(user.id, id.parse(rawId), parsed.data));
  if (!saved.ok) return saved;
  const projectId = saved.data;
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
  // Resumes group bullets under projects, so an achievement with no project could never be used.
  if (!parsed.data.projectId) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields.',
      fieldErrors: { projectId: 'Pick a project — achievements need one to appear on a resume.' },
    };
  }
  const saved = await guarded(() => saveAchievement(user.id, id.parse(rawId), parsed.data));
  if (!saved.ok) return saved;
  const achievementId = saved.data;
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
  const saved = await guarded(() => saveEducation(user.id, id.parse(rawId), parsed.data));
  if (!saved.ok) return saved;
  const eduId = saved.data;
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
  const saved = await guarded(() => saveExtra(user.id, id.parse(rawId), parsed.data));
  if (!saved.ok) return saved;
  const extraId = saved.data;
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
