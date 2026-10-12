// SPEC §6.3 — pure, deterministic completeness score (0–100) for one achievement.

export type CompletenessInput = {
  action: string | null;
  result: string | null;
  metricValue: string | null;
  metricConfidence: 'exact' | 'estimate' | 'none';
  situation: string | null;
  skills: string[];
  tools: string[];
  functionTags: string[];
  senioritySignals: string[];
  projectProofUrl: string | null;
};

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

export function completenessScore(a: CompletenessInput): number {
  let score = 0;
  if (has(a.action)) score += 20;
  if (has(a.result)) score += 20;
  if (has(a.metricValue) && a.metricConfidence !== 'none') score += 20;
  if (has(a.situation)) score += 10;
  if (a.skills.length + a.tools.length >= 2) score += 10;
  if (a.functionTags.length >= 1) score += 10;
  if (a.senioritySignals.length >= 1 || has(a.projectProofUrl)) score += 10;
  return score;
}

/** Projects whose achievements average below this get a "Deepen with AI" nudge. */
export const DEEPEN_THRESHOLD = 60;

export function average(scores: number[]): number | null {
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
}
