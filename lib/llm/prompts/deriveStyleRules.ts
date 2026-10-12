// SPEC §9.9 — fast tier, runs after every 5 new edits.
export const version = 'derive-style-rules-1';

export const system =
  'You find consistent writing preferences in a person’s edits to their resume bullets. You return only JSON.';

export function buildUser(edits: { before: string; after: string; changed: string }[]): string {
  return `Here are edits a user made to AI-generated resume bullets (before → after; "changed" lists removed (-) and added (+) words).
Identify consistent preferences (verbs, tone, length, structure, words they remove or add).
Only output a rule if it appears in at least 2 edits. Phrase each rule as an instruction a writer can follow,
e.g. "Start bullets with 'Shipped' instead of 'Built'". Never output rules that would add facts.
EDITS: ${JSON.stringify(edits)}
Return ONLY JSON: { "rules": [ { "rule": string, "evidence_count": number } ] }`;
}
