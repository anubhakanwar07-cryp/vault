// Merging newly derived style rules into the stored ones. Pure.
import { similarity } from '@/lib/import/merge';

export type StoredRule = { id: string; rule: string; evidenceCount: number; active: boolean };
export type DerivedRule = { rule: string; evidence_count: number };

export const SAME_RULE = 0.6;
export const MIN_EVIDENCE = 2;

/** New rules → inserts; near-identical rules → evidence update (never re-activating a rule the user turned off). */
export function mergeRules(existing: StoredRule[], derived: DerivedRule[]) {
  const inserts: { rule: string; evidenceCount: number }[] = [];
  const updates: { id: string; evidenceCount: number }[] = [];
  for (const d of derived) {
    if (d.evidence_count < MIN_EVIDENCE || !d.rule.trim()) continue;
    const stored = existing.find((e) => similarity(e.rule, d.rule) >= SAME_RULE);
    if (stored) {
      if (d.evidence_count > stored.evidenceCount)
        updates.push({ id: stored.id, evidenceCount: d.evidence_count });
    } else if (!inserts.some((i) => similarity(i.rule, d.rule) >= SAME_RULE)) {
      inserts.push({ rule: d.rule.trim(), evidenceCount: d.evidence_count });
    }
  }
  return { inserts, updates };
}
