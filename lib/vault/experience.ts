// Pure helpers for knockout warnings (SPEC §7.3): compare JD hard filters with the vault.

export type RoleSpan = { startDate: string; endDate: string | null; employmentType: string | null };

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

/**
 * Years of professional experience from role dates, merging overlaps.
 * Internships are counted separately (recruiters usually don't count them toward "N years").
 */
export function yearsOfExperience(
  roles: RoleSpan[],
  today = new Date(),
): { total: number; excludingInterns: number } {
  const span = (rs: RoleSpan[]) => {
    const intervals = rs
      .map(
        (r) =>
          [Date.parse(r.startDate), r.endDate ? Date.parse(r.endDate) : today.getTime()] as const,
      )
      .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s)
      .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let curS = -Infinity;
    let curE = -Infinity;
    for (const [s, e] of intervals) {
      if (s > curE) {
        if (curE > curS) total += curE - curS;
        curS = s;
        curE = e;
      } else curE = Math.max(curE, e);
    }
    if (curE > curS) total += curE - curS;
    return Math.round((total / MS_PER_YEAR) * 10) / 10;
  };
  return {
    total: span(roles),
    excludingInterns: span(roles.filter((r) => r.employmentType !== 'intern')),
  };
}

/** "3+ years", "minimum of 5 years", "2-4 years" → the lower bound in years. */
export function requiredYears(knockout: string): number | null {
  const m = knockout.match(
    /(\d+(?:\.\d+)?)\s*(?:\+|-\s*\d+|to\s*\d+)?\s*(?:\+\s*)?(?:years?|yrs?)/i,
  );
  return m ? Number(m[1]) : null;
}

export function knockoutWarnings(
  knockouts: string[],
  roles: RoleSpan[],
  today = new Date(),
): string[] {
  const yoe = yearsOfExperience(roles, today);
  const warnings: string[] = [];
  for (const k of knockouts) {
    const need = requiredYears(k);
    if (need === null) continue;
    if (yoe.excludingInterns < need) {
      const internNote =
        yoe.total > yoe.excludingInterns ? ` (${yoe.total} including internships)` : '';
      warnings.push(
        `The JD asks for ${k.trim()}; your vault shows ${yoe.excludingInterns} years${internNote}.`,
      );
    }
  }
  return warnings;
}
