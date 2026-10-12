export type EmbeddingSource = {
  action: string;
  result: string | null;
  skills: string[];
  tools: string[];
  functionTags: string[];
  domainTags: string[];
  project: { name: string; oneLiner: string | null } | null;
  role: { title: string; company: string } | null;
};

/** Exact format from SPEC §6.5 — retrieval matches on this, so don't change it casually. */
export function buildEmbeddingText(a: EmbeddingSource): string {
  const list = (xs: string[]) => xs.join(', ');
  return (
    `${a.action}. ${a.result ?? ''}. Skills: ${list(a.skills)}. Tools: ${list(a.tools)}. ` +
    `Functions: ${list(a.functionTags)}. Domain: ${list(a.domainTags)}. ` +
    `Project: ${a.project?.name ?? ''} — ${a.project?.oneLiner ?? ''}. ` +
    `Role: ${a.role?.title ?? ''} at ${a.role?.company ?? ''}.`
  );
}
