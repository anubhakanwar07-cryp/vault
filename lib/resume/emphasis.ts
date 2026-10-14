// Render-time bold emphasis for resume lines (SPEC §11, Phase 8). Pure.
// Bolds metrics and JD keywords that the text already contains — it never adds or changes words, so
// stored bullet text stays markup-free and verification is unaffected.
import { termRegex } from '@/lib/keywords/coverage';

export const MAX_BOLD_SPANS = 3;

export type Segment = { text: string; bold: boolean };

/** "60%", "90%+", "3.4x", "+480", "~40%", "1.4M", "2,000+" — numbers with a unit or sign, not bare counts. */
const METRIC =
  /(?<![\p{L}\p{N}])(?:[+~]\d[\d,]*(?:\.\d+)?(?:%\+?|[xX](?![\p{L}])|[KMB](?![\p{L}]))?|\d[\d,]*(?:\.\d+)?(?:%\+?|[xX](?![\p{L}])|[KMB](?![\p{L}])\+?|\+))/gu;

type Span = { start: number; end: number };

function matches(re: RegExp, text: string): Span[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return [...text.matchAll(g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/**
 * Splits `text` into plain and bold segments. Metrics win first, then `terms` in the order given
 * (callers pass JD keywords by weight). Overlapping spans are skipped; at most `max` spans are bold.
 */
export function emphasize(text: string, terms: string[] = [], max = MAX_BOLD_SPANS): Segment[] {
  const picked: Span[] = [];
  const overlaps = (s: Span) => picked.some((p) => s.start < p.end && p.start < s.end);
  const candidates = [
    ...matches(METRIC, text),
    ...terms.filter((t) => t.trim()).flatMap((t) => matches(termRegex(t), text).slice(0, 1)),
  ];
  for (const s of candidates) {
    if (picked.length >= max) break;
    if (s.end > s.start && !overlaps(s)) picked.push(s);
  }
  picked.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let at = 0;
  for (const s of picked) {
    if (s.start > at) out.push({ text: text.slice(at, s.start), bold: false });
    out.push({ text: text.slice(s.start, s.end), bold: true });
    at = s.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), bold: false });
  return out;
}
