// pnpm eval [--stage parse_jd] [--only name1,name2] [--concurrency 3]
// Runs the pipeline over the golden JD set on the fixture vault and reports SPEC §13 metrics.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

type Golden = {
  name: string;
  jd_file: string;
  expected_role_family: string;
  expected_must_have_keywords: string[];
  ideal_achievement_ids: string[];
  /** Each group is one expected project slot; any project in the group satisfies it. */
  ideal_project_groups?: string[][];
  /** Projects that must never be picked for this JD. */
  forbidden_project_keys?: string[];
};

type Row = {
  name: string;
  roleFamily: string;
  roleFamilyOk: boolean;
  keywordRecall: number;
  precision?: number;
  recall?: number;
  fabrications?: number;
  coverage?: number;
  bannedHits?: number;
  recruiterScore?: number | null;
  costUsd?: number;
  durationMs?: number;
  picked?: string[];
  /** Fixture keys of the projects on the page. */
  projects?: string[];
  /** Share of shown projects that contain at least one ideal achievement. */
  projectPrecision?: number;
  /** Share of ideal_project_groups satisfied (only JDs that define them). */
  projectGroupRecall?: number;
  forbiddenHits?: number;
  error?: string;
};

const TARGETS = {
  roleFamilyAccuracy: 0.9,
  keywordRecall: 0.8,
  precision: 0.7,
  recall: 0.6,
  projectPrecision: 0.8,
  projectGroupRecall: 0.67,
  forbiddenHits: 0,
  fabrication: 0,
  coverage: 80,
  bannedHits: 0,
  recruiterScore: 7,
  costUsd: 0.1,
  durationMs: 60_000,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const stage = arg('stage');
  const only = arg('only')?.split(',');
  const concurrency = Number(arg('concurrency') ?? 3);

  const [
    { default: pLimit },
    { ensureTestUser },
    { seedFixtureVault },
    { createJob, saveJobParse },
    { parseJD },
    { runTailorPipeline },
  ] = await Promise.all([
    import('p-limit'),
    import('../tests/integration/helpers'),
    import('@/lib/evals/seed'),
    import('@/lib/db/queries/jobs'),
    import('@/lib/pipeline/parse-jd'),
    import('@/lib/pipeline/run'),
  ]);
  const { adminDb, withUser } = await import('@/lib/db/client');
  const { achievements, resumes, resumeBullets, pipelineRuns } = await import('@/lib/db/schema');
  const { eq, sql } = await import('drizzle-orm');
  const { loadRecords } = await import('@/lib/pipeline/records');
  const { verifyBullet, bannedPhrasesIn } = await import('@/lib/pipeline/verify-code');
  const { resumeDoc, matchReport, allBullets } = await import('@/lib/resume/types');
  const { recruiterSimOutput } = await import('@/lib/llm/schemas/pipeline');

  const files = (await readdir('evals/golden')).filter((f) => f.endsWith('.json')).sort();
  const golden: Golden[] = [];
  for (const f of files) {
    const g = JSON.parse(await readFile(`evals/golden/${f}`, 'utf8')) as Golden;
    if (!only || only.includes(g.name)) golden.push(g);
  }
  console.log(`Running ${golden.length} golden JDs${stage ? ` (stage: ${stage})` : ''}…`);

  const userId = await ensureTestUser('eval@resume-tailor.test');
  const keyToId = stage === 'parse_jd' ? {} : await seedFixtureVault(userId);
  const idToKey = Object.fromEntries(Object.entries(keyToId).map(([k, v]) => [v, k]));
  // Same tool list the pipeline verifies against: every tool in the vault, not just picked ones,
  // so a tool borrowed from an unpicked achievement counts as a fabrication here too.
  const vaultTools =
    stage === 'parse_jd'
      ? []
      : (
          await withUser(userId, (tx) =>
            tx
              .select({ t: sql<string>`distinct unnest(${achievements.tools})` })
              .from(achievements)
              .where(eq(achievements.isArchived, false)),
          )
        ).map((r) => r.t);
  // Achievement key → project key, for project-level metrics.
  const projectOfKey: Record<string, string> = {};
  if (stage !== 'parse_jd') {
    const rows = await withUser(userId, (tx) =>
      tx.select({ id: achievements.id, projectId: achievements.projectId }).from(achievements),
    );
    for (const r of rows)
      if (idToKey[r.id] && r.projectId && idToKey[r.projectId])
        projectOfKey[idToKey[r.id]!] = idToKey[r.projectId]!;
  }

  const limit = pLimit(concurrency);
  const rows: Row[] = await Promise.all(
    golden.map((g) =>
      limit(async (): Promise<Row> => {
        const text = await readFile(g.jd_file, 'utf8');
        try {
          const parsed = await parseJD(userId, text);
          const haystack = [
            ...parsed.must_haves.map((m) => m.req),
            ...parsed.keywords.flatMap((k) => [k.term, ...k.synonyms]),
          ]
            .join(' | ')
            .toLowerCase();
          const found = g.expected_must_have_keywords.filter((k) =>
            haystack.includes(k.toLowerCase()),
          );
          const row: Row = {
            name: g.name,
            roleFamily: parsed.role_family,
            roleFamilyOk: parsed.role_family === g.expected_role_family,
            keywordRecall: found.length / g.expected_must_have_keywords.length,
          };
          if (stage === 'parse_jd') return row;

          const jobId = await createJob(userId, { jdText: text });
          await saveJobParse(userId, jobId, parsed, true);
          const run = await runTailorPipeline({ userId, jobId });

          const [resume] = await adminDb()
            .select()
            .from(resumes)
            .where(eq(resumes.id, run.resumeId));
          const doc = resumeDoc.parse(resume!.content);
          const report = matchReport.parse(resume!.matchReport);
          const sim = recruiterSimOutput.safeParse(resume!.recruiterSim);
          const bullets = await adminDb()
            .select()
            .from(resumeBullets)
            .where(eq(resumeBullets.resumeId, run.resumeId));
          const records = await withUser(userId, (tx) =>
            loadRecords(
              tx,
              bullets.map((b) => b.achievementId!),
            ),
          );
          const byId = new Map(records.map((r) => [r.id, r]));
          const vctx = { vaultTools, jdKeywords: parsed.keywords, targetCompany: parsed.company };

          let fabrications = 0;
          for (const b of bullets) {
            if (!allBullets(doc).some((x) => x.bulletId === b.id)) continue;
            if (verifyBullet(b.finalText, byId.get(b.achievementId!)!, vctx).length) fabrications++;
          }
          const allText = allBullets(doc)
            .map((b) => b.text)
            .join('\n');
          const picked = bullets
            .map((b) => idToKey[b.achievementId!])
            .filter((k): k is string => !!k);
          const ideal = new Set(g.ideal_achievement_ids);
          const hits = picked.filter((k) => ideal.has(k)).length;
          const shownProjects = [...new Set(picked.map((k) => projectOfKey[k]).filter(Boolean))];
          const idealProjects = new Set(g.ideal_achievement_ids.map((k) => projectOfKey[k]));
          const groups = g.ideal_project_groups;
          const [pr] = await adminDb()
            .select()
            .from(pipelineRuns)
            .where(eq(pipelineRuns.id, run.pipelineRunId));

          return {
            ...row,
            precision: picked.length ? hits / picked.length : 0,
            recall: hits / ideal.size,
            projects: shownProjects as string[],
            projectPrecision: shownProjects.length
              ? shownProjects.filter((p) => idealProjects.has(p)).length / shownProjects.length
              : 0,
            ...(groups
              ? {
                  projectGroupRecall:
                    groups.filter((grp) => grp.some((p) => shownProjects.includes(p))).length /
                    groups.length,
                }
              : {}),
            forbiddenHits: (g.forbidden_project_keys ?? []).filter((p) => shownProjects.includes(p))
              .length,
            fabrications,
            coverage: report.coveragePercent,
            bannedHits: bannedPhrasesIn(allText).length,
            recruiterScore: sim.success ? sim.data.score : null,
            costUsd: Number(pr?.totalCostUsd ?? run.costUsd),
            durationMs: run.durationMs,
            picked,
          };
        } catch (err) {
          console.error(`  ✗ ${g.name}:`, err instanceof Error ? err.message : err);
          return {
            name: g.name,
            roleFamily: '?',
            roleFamilyOk: false,
            keywordRecall: 0,
            error: String(err),
          };
        } finally {
          console.log(`  · ${g.name}`);
        }
      }),
    ),
  );

  const ok = rows.filter((r) => !r.error);
  const mean = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
  };
  const agg = {
    roleFamilyAccuracy: ok.filter((r) => r.roleFamilyOk).length / Math.max(1, ok.length),
    keywordRecall: mean(ok.map((r) => r.keywordRecall)),
    precision: mean(ok.map((r) => r.precision)),
    recall: mean(ok.map((r) => r.recall)),
    projectPrecision: mean(ok.map((r) => r.projectPrecision)),
    projectGroupRecall: mean(ok.map((r) => r.projectGroupRecall)),
    forbiddenHits: ok.reduce((s, r) => s + (r.forbiddenHits ?? 0), 0),
    fabrication: ok.reduce((s, r) => s + (r.fabrications ?? 0), 0),
    coverage: mean(ok.map((r) => r.coverage)),
    bannedHits: ok.reduce((s, r) => s + (r.bannedHits ?? 0), 0),
    recruiterScore: mean(ok.map((r) => r.recruiterScore)),
    // SPEC §13 targets are per run, so the worst run is what's checked; means are reported too.
    costUsd: Math.max(0, ...ok.map((r) => r.costUsd ?? 0)),
    durationMs: Math.max(0, ...ok.map((r) => r.durationMs ?? 0)),
    meanCostUsd: mean(ok.map((r) => r.costUsd)),
    meanDurationMs: mean(ok.map((r) => r.durationMs)),
    errors: rows.length - ok.length,
  };

  const pass = (k: keyof typeof TARGETS, v: number) =>
    k === 'fabrication' || k === 'bannedHits' || k === 'forbiddenHits'
      ? v <= TARGETS[k]
      : k === 'costUsd' || k === 'durationMs'
        ? v < TARGETS[k]
        : v >= TARGETS[k];
  const fmt = (k: string, v: number) =>
    Number.isNaN(v)
      ? '—'
      : k === 'costUsd'
        ? `$${v.toFixed(3)}`
        : k === 'durationMs'
          ? `${(v / 1000).toFixed(1)} s`
          : ['coverage', 'recruiterScore', 'fabrication', 'bannedHits', 'forbiddenHits'].includes(k)
            ? v.toFixed(k === 'recruiterScore' ? 1 : 0)
            : `${Math.round(v * 100)}%`;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const lines = [
    `# Eval report — ${new Date().toISOString()}`,
    '',
    `Golden JDs: ${rows.length}${stage ? ` · stage: ${stage}` : ''} · errors: ${agg.errors}`,
    '',
    '| Metric | Result | Target | |',
    '| --- | --- | --- | --- |',
    ...(Object.keys(TARGETS) as (keyof typeof TARGETS)[])
      .filter(
        (k) => !(stage === 'parse_jd' && !['roleFamilyAccuracy', 'keywordRecall'].includes(k)),
      )
      .map((k) => {
        const v = agg[k];
        const target =
          k === 'costUsd'
            ? '< $0.10 per run'
            : k === 'durationMs'
              ? '< 60 s per run'
              : k === 'fabrication' || k === 'bannedHits' || k === 'forbiddenHits'
                ? '0'
                : k === 'recruiterScore'
                  ? '≥ 7'
                  : k === 'coverage'
                    ? '≥ 80%'
                    : `≥ ${Math.round(TARGETS[k] * 100)}%`;
        return `| ${k} | ${fmt(k, v)} | ${target} | ${Number.isNaN(v) ? '' : pass(k, v) ? '✅' : '❌'} |`;
      }),
    '',
    stage === 'parse_jd'
      ? ''
      : `cost and time above are the worst single run · mean cost: $${agg.meanCostUsd.toFixed(3)} · mean latency: ${(agg.meanDurationMs / 1000).toFixed(1)} s`,
    '',
    '## Per JD',
    '',
    '| JD | family | kw recall | precision | recall | projects | proj precision | fabrication | coverage | banned | recruiter | cost | time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.roleFamily}${r.roleFamilyOk ? '' : ' ❌'} | ${Math.round(r.keywordRecall * 100)}% | ${r.precision === undefined ? '—' : `${Math.round(r.precision * 100)}%`} | ${r.recall === undefined ? '—' : `${Math.round(r.recall * 100)}%`} | ${r.projects?.join(' ') ?? '—'}${r.forbiddenHits ? ' ⛔' : ''} | ${r.projectPrecision === undefined ? '—' : `${Math.round(r.projectPrecision * 100)}%`} | ${r.fabrications ?? '—'} | ${r.coverage ?? '—'} | ${r.bannedHits ?? '—'} | ${r.recruiterScore ?? '—'} | ${r.costUsd === undefined ? '—' : `$${r.costUsd.toFixed(3)}`} | ${r.durationMs === undefined ? '—' : `${(r.durationMs / 1000).toFixed(0)} s`} |${r.error ? ` error: ${r.error.slice(0, 80)}` : ''}`,
    ),
  ];
  await mkdir('evals/reports', { recursive: true });
  const md = `evals/reports/${stamp}.md`;
  await writeFile(md, lines.join('\n') + '\n');
  await writeFile(`evals/reports/${stamp}.json`, JSON.stringify({ aggregate: agg, rows }, null, 2));
  console.log('\n' + lines.slice(0, 24).join('\n'));
  console.log(`\nReport: ${md}`);

  if (stage !== 'parse_jd' && agg.fabrication > 0) {
    console.error(`\nFAIL: ${agg.fabrication} fabricated line(s) in final output.`);
    process.exit(1);
  }
  process.exit(agg.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
