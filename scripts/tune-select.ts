// Offline tuning for the selection depth-fill (no LLM cost): replays every eval run's stored
// evidence scores against the golden ideals. Usage: pnpm tsx --conditions=react-server scripts/tune-select.ts
import { readdir, readFile } from 'node:fs/promises';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function main() {
  const { ensureTestUser } = await import('../tests/integration/helpers');
  const { adminDb, withUser } = await import('@/lib/db/client');
  const { jobs, resumes } = await import('@/lib/db/schema');
  const { and, eq } = await import('drizzle-orm');
  const sel = await import('@/lib/pipeline/select');
  const { loadRecords } = await import('@/lib/pipeline/records');
  const { requirementsOf } = await import('@/lib/pipeline/types');
  const { parsedJD } = await import('@/lib/llm/schemas/jd');
  const { matchReport } = await import('@/lib/resume/types');

  const uid = await ensureTestUser('eval@resume-tailor.test');
  const golden = await Promise.all(
    (await readdir('evals/golden')).map(async (f) =>
      JSON.parse(await readFile(`evals/golden/${f}`, 'utf8')),
    ),
  );
  const byText = new Map(
    await Promise.all(
      golden.map(async (g) => [(await readFile(g.jd_file, 'utf8')).trim(), g] as const),
    ),
  );
  const fx = JSON.parse(await readFile('evals/fixtures/vault.json', 'utf8'));
  const keyByAction = new Map<string, string>();
  for (const p of [
    ...fx.roles.flatMap((r: { projects: unknown[] }) => r.projects),
    ...fx.sideProjects,
  ]) {
    for (const a of (p as { achievements: { action: string; key: string }[] }).achievements)
      keyByAction.set(a.action, a.key);
  }

  const rows = await adminDb()
    .select({ r: resumes, j: jobs })
    .from(resumes)
    .innerJoin(jobs, eq(jobs.id, resumes.jobId))
    .where(and(eq(resumes.userId, uid), eq(resumes.version, 1)));
  const cases = [];
  for (const { r, j } of rows) {
    const g = byText.get(j.jdText.trim());
    const report = matchReport.safeParse(r.matchReport);
    if (!g || !report.success || report.data.candidates.length === 0) continue;
    const recs = await withUser(uid, (tx) =>
      loadRecords(
        tx,
        report.data.candidates.map((c) => c.achievementId),
      ),
    );
    const matrix = Object.fromEntries(
      report.data.candidates.map((c) => [
        c.achievementId,
        Object.fromEntries(
          Object.entries(c.scores).map(([k, s]) => [k, { score: s as 0 | 1 | 2 | 3, reason: '' }]),
        ),
      ]),
    );
    cases.push({ g, jd: parsedJD.parse(j.parsed), recs, matrix, today: r.createdAt });
  }
  console.log(`replaying ${cases.length} runs`);

  for (const must of [0, 1, 2]) {
    for (const fill of [0.2, 0.25, 0.3, 0.35, 0.4]) {
      let P = 0,
        R = 0,
        N = 0;
      for (const c of cases) {
        const s = sel.select({
          requirements: requirementsOf(c.jd),
          matrix: c.matrix,
          records: c.recs,
          today: c.today,
          fillMinRatio: fill,
          fillMinMustScore: must,
        });
        const picked = sel
          .selectedIds(s)
          .map((id) => keyByAction.get(c.recs.find((x) => x.id === id)!.action)!);
        const ideal = new Set<string>(c.g.ideal_achievement_ids);
        const hits = picked.filter((k) => ideal.has(k)).length;
        P += picked.length ? hits / picked.length : 0;
        R += hits / ideal.size;
        N += picked.length;
      }
      const n = cases.length;
      console.log(
        `must≥${must} fill ${fill.toFixed(2)}  precision ${((P / n) * 100).toFixed(0)}%  recall ${((R / n) * 100).toFixed(0)}%  bullets ${(N / n).toFixed(1)}`,
      );
    }
  }
  process.exit(0);
}
main();
