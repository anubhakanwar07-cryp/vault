// Deterministic guard for SPEC §6.2 rule 5: "Never fill fields the resume didn't state."
// Pure functions — the LLM output is post-processed so unsupported numbers/dates never reach the vault.
import { FUNCTION_TAGS } from '@/lib/llm/schemas/vault';
import type { ImportedAchievement, ImportResumeOutput } from '@/lib/llm/schemas/import';

export type ImportFlag = { path: string; message: string };

/** Lowercased, whitespace-collapsed, with thousands separators removed from numbers. */
export function normaliseSource(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ');
}

/** Numeric tokens in a string, e.g. "2,000 users in 3 weeks (40%)" → ["2000", "3", "40"]. */
export function numbersIn(s: string): string[] {
  return (s.replace(/(\d),(?=\d{3}\b)/g, '$1').match(/\d+(?:\.\d+)?/g) ?? []).map((n) =>
    n.replace(/^0+(?=\d)/, ''),
  );
}

function numberInSource(n: string, source: string): boolean {
  return new RegExp(`(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d])`).test(source);
}

const HEDGE =
  /(~|≈|\babout\b|\bapprox|\bnearly\b|\baround\b|\bover\b|\bup to\b|\balmost\b|\broughly\b|\+)/;

/** True if the number appears in the source with a hedge word just before or a "+" just after. */
function isHedged(n: string, source: string): boolean {
  const re = new RegExp(`(.{0,15})(^|[^\\d.])${n.replace('.', '\\.')}(?![\\d])(.{0,2})`, 'g');
  for (const m of source.matchAll(re)) {
    if (HEDGE.test(`${m[1] ?? ''}${m[2] ?? ''}`) || (m[3] ?? '').startsWith('+')) return true;
  }
  return false;
}

export function checkAchievement(
  a: ImportedAchievement,
  source: string,
  path: string,
  flags: ImportFlag[],
): ImportedAchievement {
  const out = { ...a };
  const allowedFns = new Set<string>(FUNCTION_TAGS);
  out.function_tags = a.function_tags.filter((t) => allowedFns.has(t));

  if (out.metric_value) {
    const nums = numbersIn(out.metric_value);
    const missing = nums.filter((n) => !numberInSource(n, source));
    if (nums.length === 0 || missing.length > 0) {
      flags.push({
        path,
        message: `Removed metric "${out.metric_value}" — that number isn't in your resume.`,
      });
      out.metric_value = null;
      out.metric_confidence = 'none';
    } else if (nums.some((n) => isHedged(n, source))) {
      out.metric_confidence = 'estimate';
    } else if (out.metric_confidence === 'none') {
      out.metric_confidence = 'exact';
    }
  } else {
    out.metric_confidence = 'none';
  }

  for (const field of ['action', 'result', 'situation'] as const) {
    const text = out[field];
    if (!text) continue;
    const unknown = numbersIn(text).filter((n) => !numberInSource(n, source));
    if (unknown.length > 0) {
      flags.push({
        path,
        message: `The ${field} mentions ${unknown.join(', ')}, which isn't in your resume — please check it.`,
      });
    }
  }
  return out;
}

function checkDate(d: string | null, source: string, path: string, flags: ImportFlag[]) {
  if (!d) return null;
  if (source.includes(d.slice(0, 4))) return d;
  flags.push({ path, message: `Removed date ${d} — that year isn't in your resume.` });
  return null;
}

export function checkImport(
  draft: ImportResumeOutput,
  sourceText: string,
): { draft: ImportResumeOutput; flags: ImportFlag[] } {
  const source = normaliseSource(sourceText);
  const flags: ImportFlag[] = [];

  const checkProject = (p: ImportResumeOutput['side_projects'][number], path: string) => ({
    ...p,
    start_date: checkDate(p.start_date, source, `${path}.start_date`, flags),
    end_date: checkDate(p.end_date, source, `${path}.end_date`, flags),
    achievements: p.achievements.map((a, k) =>
      checkAchievement(a, source, `${path}.achievements.${k}`, flags),
    ),
  });

  return {
    draft: {
      ...draft,
      roles: draft.roles.map((r, i) => ({
        ...r,
        start_date: checkDate(r.start_date, source, `roles.${i}.start_date`, flags),
        end_date: r.is_current ? null : checkDate(r.end_date, source, `roles.${i}.end_date`, flags),
        projects: r.projects.map((p, j) => checkProject(p, `roles.${i}.projects.${j}`)),
      })),
      side_projects: draft.side_projects.map((p, j) => checkProject(p, `side_projects.${j}`)),
      education: draft.education.map((e, i) => ({
        ...e,
        start_date: checkDate(e.start_date, source, `education.${i}.start_date`, flags),
        end_date: checkDate(e.end_date, source, `education.${i}.end_date`, flags),
      })),
      extras: draft.extras.map((x, i) => ({
        ...x,
        date: checkDate(x.date, source, `extras.${i}.date`, flags),
      })),
    },
    flags,
  };
}
