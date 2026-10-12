// Turns user edits into compact before → after pairs for the style-rule prompt (SPEC §9.9). Pure.
import { diffWords } from 'diff';

export type EditPair = { before: string; after: string };

/** Words removed and added, e.g. "-Built +Shipped". Empty when nothing changed. */
export function changeSummary(before: string, after: string): string {
  return diffWords(before, after)
    .filter((p) => p.added || p.removed)
    .map((p) => `${p.added ? '+' : '-'}${p.value.trim()}`)
    .filter((s) => s.length > 1)
    .join(' ');
}

/** Real rewrites only (no no-ops), newest first, capped. */
export function editsForPrompt(edits: EditPair[], max = 20) {
  return edits
    .filter((e) => e.before.trim() && e.after.trim() && e.before.trim() !== e.after.trim())
    .slice(0, max)
    .map((e) => ({ before: e.before, after: e.after, changed: changeSummary(e.before, e.after) }));
}
