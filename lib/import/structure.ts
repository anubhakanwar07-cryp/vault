import 'server-only';
import { getVaultTree } from '@/lib/db/queries/vault';
import { callLLM } from '@/lib/llm/client';
import * as importPrompt from '@/lib/llm/prompts/importSource';
import { importResumeOutput, type ImportResumeOutput } from '@/lib/llm/schemas/import';
import { dedupeWithinProjects, resolveMerge, summariseVault, type MergeInfo } from './merge';
import { checkImport, type ImportFlag } from './source-check';

export const MAX_SOURCE_TEXT = 30_000;
export type { SourceKind } from '@/lib/llm/prompts/importSource';

export type StructuredSource = { draft: ImportResumeOutput; flags: ImportFlag[]; merge: MergeInfo };

/**
 * Source text → structured, source-checked, merge-resolved draft (SPEC §6.2 + vault sources).
 * Nothing is saved here.
 */
export async function structureSource(
  userId: string,
  kind: importPrompt.SourceKind,
  text: string,
): Promise<StructuredSource> {
  const vault = await getVaultTree(userId);
  const raw = await callLLM({
    stage: 'import',
    tier: 'strong',
    system: importPrompt.system,
    user: importPrompt.buildUser({
      kind,
      text: text.slice(0, MAX_SOURCE_TEXT),
      existingVault: summariseVault(vault),
    }),
    schema: importResumeOutput,
    promptVersion: importPrompt.version,
    userId,
    maxTokens: 16_000,
  });
  const checked = checkImport(dedupeWithinProjects(raw), text);
  const { draft, merge } = resolveMerge(checked.draft, vault);
  return { draft, flags: checked.flags, merge };
}
