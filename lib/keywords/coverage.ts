// SPEC §7.8: keyword coverage — case-insensitive, word-boundary aware, term or any synonym.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches `term` as a whole token: "SQL" matches "SQL," but not "NoSQL"; works for "A/B testing", "C++". */
export function termRegex(term: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term.trim())}(?![\\p{L}\\p{N}])`, 'iu');
}

export function mentions(text: string, term: string): boolean {
  return term.trim().length > 0 && termRegex(term).test(text);
}

export type KeywordLike = { term: string; synonyms: string[] };

export function mentionsKeyword(text: string, k: KeywordLike): boolean {
  return [k.term, ...k.synonyms].some((t) => mentions(text, t));
}

export function keywordCoverage<K extends KeywordLike>(
  keywords: K[],
  lines: { id: string; text: string }[],
): { term: string; used: boolean; where: string[] }[] {
  return keywords.map((k) => {
    const where = lines.filter((l) => mentionsKeyword(l.text, k)).map((l) => l.id);
    return { term: k.term, used: where.length > 0, where };
  });
}
