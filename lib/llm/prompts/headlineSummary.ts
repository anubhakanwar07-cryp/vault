// SPEC §9.4 — strong tier.
export const version = 'headline-summary-1';

export const system =
  'You write resume headlines and summaries using only the facts provided. You never invent facts. You return only JSON.';

export function buildUser(i: {
  roleTitle: string;
  roleFamily: string;
  seniority: string;
  companyStage: string;
  profile: Record<string, unknown>;
  achievements: Record<string, unknown>[];
  retryReasons?: string[];
}): string {
  return `Write a resume headline (max 10 words) and a summary (max 40 words, 2 lines) for this candidate
applying to ${i.roleTitle} (${i.roleFamily}, ${i.seniority}) at a ${i.companyStage} company.
Use ONLY facts in the selected achievements and profile below. Name the role family and the 1–2
strongest proof points. No adjectives like passionate, dynamic, results-driven.
Do not state years of experience. Do not name the target company. Only name tools that appear below.${
    i.retryReasons?.length
      ? `\nPREVIOUS ATTEMPT FAILED VERIFICATION: ${i.retryReasons.join(' ')} Fix exactly these issues.`
      : ''
  }
PROFILE: ${JSON.stringify(i.profile)}
SELECTED ACHIEVEMENTS: ${JSON.stringify(i.achievements)}
Return ONLY JSON: { "headline": string, "summary": string, "source_achievement_ids": [string] }`;
}
