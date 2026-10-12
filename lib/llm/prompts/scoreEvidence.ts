// SPEC §9.2 — fast tier, batched.
export const version = 'score-evidence-1';

export const system =
  'You are a strict hiring panelist. You judge evidence only on what is written. You return only JSON.';

export function buildUser(input: {
  requirements: { id: string; req: string }[];
  achievements: Record<string, unknown>[];
}): string {
  return `Score how strongly each achievement proves each requirement.
0 = unrelated
1 = adjacent skill or weak signal
2 = clear evidence the person did this
3 = direct proof with a concrete result
Judge ONLY on what the achievement text states. Do not assume unstated skills.

REQUIREMENTS:
${JSON.stringify(input.requirements)}

ACHIEVEMENTS:
${JSON.stringify(input.achievements)}

Return ONLY JSON:
{ "scores": [ { "achievement_id": string, "req_id": string, "score": 0|1|2|3, "reason": string } ] }
Include only pairs with score >= 1. Keep each reason under 15 words.`;
}
