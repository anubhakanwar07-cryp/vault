// pnpm debug:select <jobId> [--all]
// Diagnoses project selection for a job: every project in the job owner's vault, how much material it
// has (achievement count, average completeness), its project-level score + reason for this JD, and
// which MAX_PROJECTS Stage A picks. --all repeats this for every job the same user owns.
// Makes one fast-tier LLM call per job (logged to llm_runs as stage "score_projects").
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

async function main() {
  const jobId = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const all = process.argv.includes('--all');
  if (!jobId) {
    console.error('Usage: pnpm debug:select <jobId> [--all]');
    process.exit(1);
  }

  const { and, desc, eq } = await import('drizzle-orm');
  const { adminDb, withUser } = await import('@/lib/db/client');
  const { achievements, jobs, projects, resumes, roles } = await import('@/lib/db/schema');
  const { getJob } = await import('@/lib/db/queries/jobs');
  const { loadAllRecords } = await import('@/lib/pipeline/records');
  const { byProject, scoreProjects } = await import('@/lib/pipeline/score-projects');
  const { MAX_PROJECTS, rankProjects } = await import('@/lib/pipeline/select');
  const { requirementsOf } = await import('@/lib/pipeline/types');
  const { resumeDoc } = await import('@/lib/resume/types');

  // Developer tool: find the job's owner, then read everything else as that user (RLS).
  const [owner] = await adminDb()
    .select({ userId: jobs.userId })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  if (!owner) throw new Error(`No job ${jobId}`);
  const userId = owner.userId;

  const jobIds = all
    ? (
        await withUser(userId, (tx) =>
          tx.select({ id: jobs.id }).from(jobs).orderBy(desc(jobs.createdAt)),
        )
      ).map((j) => j.id)
    : [jobId];

  // The vault, once: every project (even empty ones) with achievement counts and completeness.
  const vault = await withUser(userId, async (tx) => ({
    projects: await tx
      .select({ id: projects.id, name: projects.name, role: roles.title, company: roles.company })
      .from(projects)
      .leftJoin(roles, eq(roles.id, projects.roleId)),
    achs: await tx
      .select({
        id: achievements.id,
        projectId: achievements.projectId,
        completeness: achievements.completenessScore,
        archived: achievements.isArchived,
      })
      .from(achievements),
  }));
  const records = await withUser(userId, (tx) => loadAllRecords(tx));
  const groups = byProject(records);

  const stats = (pid: string) => {
    const live = vault.achs.filter((a) => a.projectId === pid && !a.archived);
    const archived = vault.achs.filter((a) => a.projectId === pid && a.archived).length;
    const avg = live.length
      ? Math.round(live.reduce((s, a) => s + a.completeness, 0) / live.length)
      : 0;
    return { count: live.length, archived, avg };
  };

  console.log(`\nVault: ${vault.projects.length} projects, ${records.length} live achievements`);
  const orphans = vault.achs.filter((a) => !a.projectId && !a.archived).length;
  if (orphans) console.log(`  ${orphans} achievements have no project (never selectable)`);

  for (const id of jobIds) {
    const job = await getJob(userId, id);
    if (!job?.parsed) {
      console.log(`\n=== Job ${id}: not parsed — skipped`);
      continue;
    }
    const jd = job.parsed;
    const reqs = requirementsOf(jd);
    console.log(`\n=== Job ${id} — ${jd.role_title}${jd.company ? ` @ ${jd.company}` : ''}`);
    for (const r of reqs) console.log(`  ${r.id} [${r.kind} w${r.weight}] ${r.req}`);

    const scores = await scoreProjects({ userId, jd, records });
    const chosen = rankProjects(scores, reqs, groups.keys(), MAX_PROJECTS);

    const [latest] = await withUser(userId, (tx) =>
      tx
        .select({ content: resumes.content, version: resumes.version })
        .from(resumes)
        .where(and(eq(resumes.jobId, id)))
        .orderBy(desc(resumes.version))
        .limit(1),
    );
    const shown = latest ? resumeDoc.safeParse(latest.content) : null;

    const rows = vault.projects
      .map((p) => {
        const st = stats(p.id);
        const sc = scores[p.id];
        return {
          rank: chosen.includes(p.id) ? `★${chosen.indexOf(p.id) + 1}` : '',
          project: p.name.slice(0, 34),
          where: p.role ? `${p.role} @ ${p.company}`.slice(0, 28) : 'side project',
          achs: st.count,
          archived: st.archived,
          avgComplete: st.avg,
          score: sc ? sc.score : '—',
          proves: sc?.requirementsProven.join(',') ?? '',
          reason: sc ? sc.reason.slice(0, 70) : 'no achievements → not scored',
        };
      })
      .sort(
        (a, b) =>
          (typeof b.score === 'number' ? b.score : -1) -
          (typeof a.score === 'number' ? a.score : -1),
      );
    console.table(rows);
    console.log(
      `  Stage A picks: ${chosen.map((c) => vault.projects.find((p) => p.id === c)?.name).join(' · ')}`,
    );
    if (shown?.success) {
      const d = shown.data;
      const names = [
        ...d.experience.flatMap((e) =>
          e.projects?.length ? e.projects.map((p) => p.name) : [`(${e.title} bullets)`],
        ),
        ...d.projects.map((p) => p.name),
      ];
      console.log(`  Latest resume v${latest!.version} shows: ${names.join(' · ')}`);
    }
  }
}

void main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
