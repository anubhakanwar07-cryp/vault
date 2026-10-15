// Render-time bold emphasis for resume lines (SPEC §11, Phase 8). Pure.
// Bolds metrics and JD keywords that the text already contains — it never adds or changes words, so
// stored bullet text stays markup-free and verification is unaffected.
import { termRegex } from '@/lib/keywords/coverage';

export const MAX_BOLD_SPANS = 3;

export type Segment = { text: string; bold: boolean };

// Metrics: numbers with a unit, a sign or a currency — not bare counts. Ranges ("20–30%") stay whole.
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const RANGE = String.raw`${NUM}(?:\s?[-–]\s?${NUM})?`;
const END = String.raw`(?![\p{L}\p{N}])`;
const UNIT = String.raw`(?:%\+?|[xX×]${END}|(?:[kK]|[MB]|bn|mn|Cr|L)${END}\+?|\+)`;
const SIGN = String.raw`[+~≈]\s?`;
const CURRENCY = String.raw`[$€£₹]\s?`;

/** "60%", "90%+", "3.4x", "+480", "~40%", "1.4M", "50k", "$1.2M", "₹3Cr", "20–30%", "2,000+". */
const METRIC = new RegExp(
  String.raw`(?<![\p{L}\p{N}.$€£₹+~≈])(?:${SIGN}(?:${CURRENCY})?${RANGE}${UNIT}?|${CURRENCY}${RANGE}${UNIT}?|${RANGE}${UNIT})`,
  'gu',
);

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
