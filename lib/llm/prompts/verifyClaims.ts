// SPEC §9.5 — fast tier. Always a separate call from the one that wrote the text.
// SPEC-QUESTION: the model is asked for a verdict per claim (more reliable than a single boolean);
// the code derives SPEC's { supported, unsupported_claims } from it.
export const version = 'verify-claims-3';

export const system =
  'You are a meticulous fact-checking auditor for resumes. You flag new or inflated facts, and you accept faithful ' +
  'paraphrase. You return only JSON.';

export function buildUser(
  lines: { line_id: string; text: string; source_records: unknown[] }[],
): string {
  return `For each line, split it into its factual claims (numbers, tools, technologies, team sizes, titles, scope,
outcomes, ownership) and judge each one against the line's source record(s).

A claim is SUPPORTED when the source states it or it is a faithful paraphrase, including:
- synonyms or more general wording for the same work ("LLM-powered tutor" for "LLM study coach")
- facts from any field of the record: action, result, situation, metric, tools, skills, raw notes,
  project name/one-liner/ownership, role title/company (e.g. team size from the ownership note)
- describing a tool listed in the record as used in that work
A claim is UNSUPPORTED when it adds a fact the record doesn't contain or inflates one:
- a number, tool, team size, title or outcome not in the record
- stronger ownership than stated ("led" when the record says "ran" or "contributed"; "owned" when shared)
- a hedged figure stated as exact ("40%" when the record says "~40%")
- a causal link or scope the record doesn't state

LINES:
${JSON.stringify(lines)}

Return ONLY JSON:
{ "results": [ { "line_id": string, "claims": [ { "claim": string, "verdict": "supported" | "unsupported", "why": string } ] } ] }
List only the line's factual claims (usually 2–5), each as a short quote. "why" is "" for supported claims and under 12 words for unsupported ones.`;
}
