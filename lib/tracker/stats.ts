// Callback-rate stats for the dashboard (SPEC §12). Pure.

export const APPLICATION_STATUSES = [
  'saved',
  'applied',
  'callback',
  'interview',
  'offer',
  'rejected',
  'ghosted',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const CALLBACK_STATUSES: ApplicationStatus[] = ['callback', 'interview', 'offer'];
export const MIN_N_TO_COMPARE = 10;

export type AppForStats = {
  status: ApplicationStatus;
  statusHistory: { status: string; at: string }[];
  isTailored: boolean;
  roleFamily: string | null;
};

/**
 * An application "got a callback" if it ever reached callback/interview/offer — an interview that
 * later became a rejection still counts. SPEC-QUESTION: §12 counts current status only; history is
 * the truer signal for comparing resumes.
 */
export function gotCallback(a: AppForStats): boolean {
  return (
    CALLBACK_STATUSES.includes(a.status) ||
    a.statusHistory.some((h) => CALLBACK_STATUSES.includes(h.status as ApplicationStatus))
  );
}

/** Only applications actually sent count toward the denominator ("saved" ones don't). */
export const wasSent = (a: AppForStats) => a.status !== 'saved';

export type GroupStat = { n: number; callbacks: number; rate: number | null; enough: boolean };

function group(apps: AppForStats[]): GroupStat {
  const sent = apps.filter(wasSent);
  const callbacks = sent.filter(gotCallback).length;
  return {
    n: sent.length,
    callbacks,
    rate: sent.length ? callbacks / sent.length : null,
    enough: sent.length >= MIN_N_TO_COMPARE,
  };
}

export type CallbackStats = {
  tailored: GroupStat;
  baseline: GroupStat;
  byFamily: { family: string; tailored: GroupStat; baseline: GroupStat }[];
};

export const UNKNOWN_FAMILY = 'unknown';

export function callbackStats(apps: AppForStats[]): CallbackStats {
  // Applications with no known family get their own group, separate from a genuine "other".
  const familyOf = (a: AppForStats) => a.roleFamily ?? UNKNOWN_FAMILY;
  const families = [...new Set(apps.map(familyOf))].sort();
  return {
    tailored: group(apps.filter((a) => a.isTailored)),
    baseline: group(apps.filter((a) => !a.isTailored)),
    byFamily: families.map((family) => {
      const f = apps.filter((a) => familyOf(a) === family);
      return {
        family,
        tailored: group(f.filter((a) => a.isTailored)),
        baseline: group(f.filter((a) => !a.isTailored)),
      };
    }),
  };
}

/** Appends a status change to the history (SPEC §12). No-op when the status doesn't change. */
export function withStatusChange<
  T extends { status: string; statusHistory: { status: string; at: string }[] },
>(app: T, status: ApplicationStatus, at: Date = new Date()): T {
  if (app.status === status) return app;
  return {
    ...app,
    status,
    statusHistory: [...app.statusHistory, { status, at: at.toISOString() }],
  };
}
