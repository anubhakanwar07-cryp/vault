// SPEC §9.3 — strong tier, temperature 0.5.
import { BANNED_PHRASES } from '@/lib/pipeline/verify-code';

export const version = 'rewrite-bullet-2';

export const system =
  'You write resume bullets for experienced hiring managers. You never invent facts. Every number, ' +
  'tool, team size and outcome you write must appear in the source record. You return only JSON.';

export type RewriteInput = {
  roleTitle: string;
  roleFamily: string;
  seniority: string;
  companyStage: string;
  tone: string;
  coreProblem: string;
  requirements: string[];
  keywords: { term: string; synonyms: string[] }[];
  styleRules: string[];
  retryReasons?: string[];
  avoidVerbs?: string[];
  critique?: string;
  source: Record<string, unknown>;
};

export function buildUser(i: RewriteInput): string {
  return `Rewrite this achievement as ONE resume bullet for the target role.

TARGET ROLE: ${i.roleTitle} | family: ${i.roleFamily} | seniority: ${i.seniority} | company stage: ${i.companyStage}
CULTURE SIGNAL: ${i.tone || '—'}
THE READER CARES MOST ABOUT: ${i.coreProblem}
REQUIREMENTS THIS BULLET SHOULD PROVE: ${i.requirements.length ? i.requirements.join('; ') : '—'}
JD KEYWORDS (use a term only if it truthfully describes what was done): ${i.keywords
    .map((k) => (k.synonyms.length ? `${k.term} (${k.synonyms.join(', ')})` : k.term))
    .join('; ')}
USER STYLE RULES: ${i.styleRules.length ? i.styleRules.join('; ') : '—'}${
    i.retryReasons?.length
      ? `\nPREVIOUS ATTEMPT FAILED VERIFICATION: ${i.retryReasons.join(' ')} Fix exactly these issues.`
      : ''
  }${i.avoidVerbs?.length ? `\nDo not start with: ${i.avoidVerbs.join(', ')}` : ''}${
    i.critique ? `\nRECRUITER CRITIQUE OF THE CURRENT VERSION: ${i.critique}` : ''
  }

SOURCE RECORD:
${JSON.stringify(i.source)}

Rules:
- Structure: strong past-tense verb + what you did + how + result. 18–28 words.
- Lead with the part of the work the reader cares most about.
- Max 2 JD keyword substitutions.
- If metric_confidence is "estimate", keep a hedge (~, about, nearly). If "none", do not add a number.
- If ownership was shared, say so honestly ("with", "alongside", "as part of a team of N").
- Only name tools and technologies listed in the source record.
- Banned: ${BANNED_PHRASES.join(', ')}.
- Do not name the target company.

Return ONLY JSON: { "bullet": string }`;
  // SPEC-QUESTION: §9.3 also asks for source_fields_used / keywords_used / requirements_addressed. Keyword use and
  // requirement coverage are computed deterministically in code instead, so the model isn't asked (saves ~40% output).
}
