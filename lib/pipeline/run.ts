import 'server-only';
import { and, desc, eq, max, sql } from 'drizzle-orm';
import { adminDb, withUser } from '@/lib/db/client';
import { getProfile } from '@/lib/db/queries/vault';
import { getJob, roleSpans } from '@/lib/db/queries/jobs';
import {
  achievements,
  education as educationT,
  extras as extrasT,
  llmRuns,
  pipelineRuns,
  resumeBullets,
  resumes,
  styleRules,
} from '@/lib/db/schema';
import { callLLM } from '@/lib/llm/client';
import { costUsd } from '@/lib/llm/pricing';
import * as simPrompt from '@/lib/llm/prompts/recruiterSim';
import { recruiterSimOutput, type RecruiterSim } from '@/lib/llm/schemas/pipeline';
import { resumeToText } from '@/lib/resume/plain-text';
import type { MatchReport, ResumeDoc } from '@/lib/resume/types';
import { knockoutWarnings } from '@/lib/vault/experience';
import { buildMatchReport, groupSkills, pickExtras } from './assemble-utils';
import { retrieve } from './retrieve';
import type { RewriteContext } from './rewrite';
import { scoreEvidence } from './score';
import { baseValue, select, selectedIds } from './select';
import { requirementsOf, type ProgressEvent } from './types';
import { rewriteAndVerifyBullets, type RewriteHooks } from './verify';
import { leadVerb, type VerifyContext } from './verify-code';

export class PipelineError extends Error {
  constructor(
    message: string,
    readonly userMessage: string,
  ) {
    super(message);
  }
}

export type RunResult = {
  resumeId: string;
  pipelineRunId: string;
  durationMs: number;
  costUsd: number;
};

const MAX_VERB_USES = 2;

/**
 * The tailoring pipeline (SPEC §7, stages 3–8). Stage 1 (parse) and 2 (confirm) already happened.
 * Progress is reported through `onEvent` for the SSE stream.
 */
export async function runTailorPipeline(opts: {
  userId: string;
  jobId: string;
  onEvent?: (e: ProgressEvent) => void;
  hooks?: RewriteHooks;
}): Promise<RunResult> {
  const { userId, jobId } = opts;
  const emit = (e: ProgressEvent) => opts.onEvent?.(e);
  const started = Date.now();

  const job = await getJob(userId, jobId);
  if (!job?.parsed) throw new PipelineError('job not parsed', 'This job hasn’t been read yet.');
  if (!job.userConfirmed)
    throw new PipelineError('job not confirmed', 'Confirm the job details first.');
  const jd = job.parsed;
  const requirements = requirementsOf(jd);

  const [run] = await withUser(userId, (tx) =>
    tx
      .insert(pipelineRuns)
      .values({ userId, jobId, status: 'running', stage: 'retrieve' })
      .returning({ id: pipelineRuns.id }),
  );
  const pipelineRunId = run!.id;
  const setStage = (stage: string) =>
    withUser(userId, (tx) =>
      tx.update(pipelineRuns).set({ stage }).where(eq(pipelineRuns.id, pipelineRunId)),
    );

  try {
    // ---- Stage 3: retrieve
    emit({ stage: 'retrieve', status: 'start', message: 'Matching your work…' });
    const candidates = await retrieve(userId, jd);
    if (candidates.length === 0) {
      throw new PipelineError(
        'empty vault',
        'Your vault has no achievements yet. Add some work first.',
      );
    }
    emit({
      stage: 'retrieve',
      status: 'done',
      message: `Found ${candidates.length} relevant achievements`,
    });

    // ---- Stage 4: score
    await setStage('score');
    emit({
      stage: 'score',
      status: 'start',
      message: 'Weighing your evidence against each requirement…',
    });
    const matrix = await scoreEvidence({
      userId,
      pipelineRunId,
      requirements,
      records: candidates,
    });
    emit({ stage: 'score', status: 'done', message: 'Scored' });

    // ---- Stage 5: select
    await setStage('select');
    const profile = await getProfile(userId);
    const selection = select({ requirements, matrix, records: candidates });
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const chosen = selectedIds(selection).map((id) => byId.get(id)!);
    emit({ stage: 'select', status: 'done', message: `Picked ${chosen.length} achievements` });

    // Shared context for writing + verification.
    const [rules, vaultToolRows, vaultSkillRows, eduRows, extraRows, spans] = await Promise.all([
      withUser(userId, (tx) =>
        tx
          .select({ rule: styleRules.rule })
          .from(styleRules)
          .where(eq(styleRules.active, true))
          .orderBy(desc(styleRules.evidenceCount)),
      ),
      withUser(userId, (tx) =>
        tx
          .select({ t: sql<string>`distinct unnest(${achievements.tools})` })
          .from(achievements)
          .where(eq(achievements.isArchived, false)),
      ),
      withUser(userId, (tx) =>
        tx
          .select({ s: sql<string>`distinct unnest(${achievements.skills})` })
          .from(achievements)
          .where(eq(achievements.isArchived, false)),
      ),
      withUser(userId, (tx) => tx.select().from(educationT).orderBy(desc(educationT.endDate))),
      withUser(userId, (tx) => tx.select().from(extrasT)),
      roleSpans(userId),
    ]);
    const ctx: RewriteContext = {
      userId,
      pipelineRunId,
      jd,
      requirements,
      matrix,
      styleRules: rules.map((r) => r.rule),
    };
    const verifyCtx: VerifyContext = {
      vaultTools: vaultToolRows.map((r) => r.t),
      jdKeywords: jd.keywords,
      targetCompany: jd.company,
    };

    // ---- Stages 6–7: rewrite + verify (bullets)
    await setStage('rewrite');
    emit({ stage: 'rewrite', status: 'start', message: 'Writing bullets…' });
    const outcomes = await rewriteAndVerifyBullets({
      ctx,
      records: chosen,
      verifyCtx,
      hooks: opts.hooks,
    });
    emit({ stage: 'verify', status: 'start', message: 'Fact-checking…' });

    // ---- Verb rule (SPEC §8.10): each lead verb at most twice; regenerate later bullets.
    const order = selectedIds(selection);
    const verbCount = new Map<string, number>();
    const overused: Record<string, { avoidVerbs: string[] }> = {};
    for (const id of order) {
      const v = leadVerb(outcomes[id]!.text);
      const n = (verbCount.get(v) ?? 0) + 1;
      verbCount.set(v, n);
      if (v && n > MAX_VERB_USES && !outcomes[id]!.fallback) overused[id] = { avoidVerbs: [] };
    }
    if (Object.keys(overused).length) {
      const saturated = [...verbCount.entries()]
        .filter(([, n]) => n >= MAX_VERB_USES)
        .map(([v]) => v);
      for (const id of Object.keys(overused)) overused[id] = { avoidVerbs: saturated };
      const redo = await rewriteAndVerifyBullets({
        ctx,
        records: Object.keys(overused).map((id) => byId.get(id)!),
        verifyCtx,
        extra: overused,
        // Swapping the opening verb is a light edit; the fast tier is enough (output is re-verified).
        tier: 'fast',
      });
      // Keep a regenerated bullet only if it verified; otherwise the original (verified) one stays.
      for (const [id, o] of Object.entries(redo)) if (o.verified) outcomes[id] = o;
    }

    emit({ stage: 'verify', status: 'done', message: 'Every line checked against your vault' });

    // ---- Stage 8: assemble
    await setStage('assemble');
    emit({ stage: 'assemble', status: 'start', message: 'Laying out your page…' });
    const bulletIdByAchievement: Record<string, string> = {};
    for (const id of order) bulletIdByAchievement[id] = crypto.randomUUID();
    const bulletFor = (id: string) => ({
      bulletId: bulletIdByAchievement[id]!,
      text: outcomes[id]!.text,
    });
    const anyRecord = (projectId: string) => chosen.find((c) => c.project?.id === projectId)!;

    const skillGroups = groupSkills(
      verifyCtx.vaultTools,
      vaultSkillRows.map((r) => r.s),
      chosen,
      jd.keywords,
      jd.role_family,
    );
    const doc: ResumeDoc = {
      header: {
        name: profile?.fullName ?? '',
        email: profile?.email ?? null,
        phone: profile?.phone ?? null,
        location: profile?.location ?? null,
        links: profile?.links ?? [],
      },
      headline: '',
      summary: '',
      experience: selection.roles.map((r) => {
        const role = chosen.find((c) => c.role?.id === r.roleId)!.role!;
        // Projects render as "Name — one-liner" sub-heads (SPEC §11). Only a lone project with no
        // one-liner puts its bullets directly under the role.
        const grouped =
          r.projects.length > 1 || r.projects.some((p) => anyRecord(p.projectId).project!.oneLiner);
        return {
          roleId: role.id,
          company: role.company,
          title: role.title,
          location: role.location,
          start: role.startDate,
          end: role.endDate,
          bullets: grouped ? [] : r.projects.flatMap((p) => p.achievementIds.map(bulletFor)),
          ...(grouped
            ? {
                projects: r.projects.map((p) => ({
                  name: anyRecord(p.projectId).project!.name,
                  oneLiner: anyRecord(p.projectId).project!.oneLiner,
                  bullets: p.achievementIds.map(bulletFor),
                })),
              }
            : {}),
        };
      }),
      projects: selection.sideProjects.map((p) => {
        const proj = anyRecord(p.projectId).project!;
        return {
          projectId: proj.id,
          name: proj.name,
          url: proj.proofUrl,
          start: proj.startDate,
          end: proj.endDate,
          bullets: p.achievementIds.map(bulletFor),
        };
      }),
      skills: skillGroups.flatMap((g) => g.items),
      skillGroups,
      emphasis: [...jd.keywords]
        .sort((a, b) => b.weight - a.weight)
        .flatMap((k) => [k.term, ...k.synonyms]),
      education: eduRows.map((e) => ({
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        start: e.startDate,
        end: e.endDate,
        grade: e.grade,
      })),
      extras: pickExtras(extraRows, jd.keywords).map((x) => ({
        kind: x.kind,
        title: x.title,
        issuer: x.issuer,
        date: x.date,
        description: x.description,
      })),
    };

    const fallbackBullets = order
      .filter((id) => outcomes[id]!.fallback)
      .map((id) => bulletIdByAchievement[id]!);
    const lines = order.map((id) => ({ id: bulletIdByAchievement[id]!, text: outcomes[id]!.text }));
    const report: MatchReport = buildMatchReport({
      jd,
      requirements,
      selection,
      bulletIdByAchievement,
      lines,
      knockoutWarnings: knockoutWarnings(jd.knockouts, spans),
      fallbackBullets,
      candidates: candidates.map((c) => ({
        achievementId: c.id,
        value: Math.round(baseValue(c, requirements, matrix, new Date()) * 100) / 100,
        scores: Object.fromEntries(
          Object.entries(matrix[c.id] ?? {}).map(([req, v]) => [req, v.score]),
        ),
      })),
    });

    const resumeId = await withUser(userId, async (tx) => {
      const [{ v } = { v: 0 }] = await tx
        .select({ v: max(resumes.version) })
        .from(resumes)
        .where(eq(resumes.jobId, jobId));
      const [row] = await tx
        .insert(resumes)
        .values({
          userId,
          jobId,
          version: (v ?? 0) + 1,
          content: doc,
          matchReport: report,
          pipelineRunId,
        })
        .returning({ id: resumes.id });
      await tx.insert(resumeBullets).values(
        order.map((id, position) => {
          const o = outcomes[id]!;
          const r = byId.get(id)!;
          return {
            id: bulletIdByAchievement[id]!,
            userId,
            resumeId: row!.id,
            achievementId: id,
            section: r.role ? ('experience' as const) : ('projects' as const),
            position,
            generatedText: o.generatedText || o.text,
            finalText: o.text,
            keywordsUsed: report.keywords
              .filter((k) => k.where.includes(bulletIdByAchievement[id]!))
              .map((k) => k.term),
            requirementsCovered: requirements
              .filter((q) => (matrix[id]?.[q.id]?.score ?? 0) >= 2)
              .map((q) => q.id),
            verified: o.verified,
            verifierNotes: {
              attempts: o.attempts,
              fallback: o.fallback,
              pickValue: selection.pickValue[id] ?? null,
            },
          };
        }),
      );
      return row!.id;
    });
    emit({ stage: 'assemble', status: 'done', message: 'Resume assembled' });

    // ---- Recruiter sim (once; SPEC §7.8 — no auto-loop)
    await setStage('recruiter_sim');
    emit({ stage: 'recruiter_sim', status: 'start', message: 'Reading it like a recruiter…' });
    try {
      const sim = await runRecruiterSim(userId, pipelineRunId, jd, doc);
      await withUser(userId, (tx) =>
        tx.update(resumes).set({ recruiterSim: sim }).where(eq(resumes.id, resumeId)),
      );
      emit({ stage: 'recruiter_sim', status: 'done', message: `Recruiter score ${sim.score}/10` });
    } catch (err) {
      console.error('[pipeline] recruiter sim failed', err);
      emit({
        stage: 'recruiter_sim',
        status: 'error',
        message: 'Recruiter view unavailable for this run',
      });
    }

    const totals = await finishRun(userId, pipelineRunId, started, 'done');
    emit({ stage: 'done', status: 'done', message: 'Done', resumeId });
    return { resumeId, pipelineRunId, durationMs: totals.durationMs, costUsd: totals.costUsd };
  } catch (err) {
    await finishRun(
      userId,
      pipelineRunId,
      started,
      'failed',
      err instanceof Error ? err.message : String(err),
    ).catch(() => {});
    throw err;
  }
}

export async function runRecruiterSim(
  userId: string,
  pipelineRunId: string | undefined,
  jd: { company_stage: string; seniority: string; role_title: string; core_problems: string[] },
  doc: ResumeDoc,
): Promise<RecruiterSim> {
  return callLLM({
    stage: 'recruiter_sim',
    tier: 'strong',
    temperature: 0.3,
    system: simPrompt.system,
    user: simPrompt.buildUser({
      companyStage: jd.company_stage,
      seniority: jd.seniority,
      roleTitle: jd.role_title,
      coreProblems: jd.core_problems,
      resumeText: resumeToText(doc),
    }),
    schema: recruiterSimOutput,
    promptVersion: simPrompt.version,
    userId,
    pipelineRunId,
    maxTokens: 1500,
  });
}

/** Totals tokens and cost from llm_runs and closes the pipeline_runs row. */
async function finishRun(
  userId: string,
  pipelineRunId: string,
  started: number,
  status: 'done' | 'failed',
  error?: string,
) {
  const rows = await adminDb()
    .select({ model: llmRuns.model, i: llmRuns.inputTokens, o: llmRuns.outputTokens })
    .from(llmRuns)
    .where(and(eq(llmRuns.pipelineRunId, pipelineRunId), eq(llmRuns.userId, userId)));
  const tokens = rows.reduce((s, r) => s + (r.i ?? 0) + (r.o ?? 0), 0);
  const cost = rows.reduce((s, r) => s + costUsd(r.model ?? '', r.i ?? 0, r.o ?? 0), 0);
  const durationMs = Date.now() - started;
  await withUser(userId, (tx) =>
    tx
      .update(pipelineRuns)
      .set({
        status,
        stage: status === 'done' ? 'done' : undefined,
        error: error ?? null,
        totalTokens: tokens,
        totalCostUsd: cost.toFixed(5),
        durationMs,
      })
      .where(eq(pipelineRuns.id, pipelineRunId)),
  );
  return { tokens, costUsd: cost, durationMs };
}
