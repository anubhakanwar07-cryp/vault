import 'server-only';
import { diffWords } from 'diff';
import { desc, eq, max, sql } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { getJob } from '@/lib/db/queries/jobs';
import { achievements, resumeBullets, resumes, styleRules, userEdits } from '@/lib/db/schema';
import { similarity } from '@/lib/import/merge';
import type { ParsedJD } from '@/lib/llm/schemas/jd';
import { recruiterSimOutput, type RecruiterSim } from '@/lib/llm/schemas/pipeline';
import { buildMatchReport, weightedCoverage } from '@/lib/pipeline/assemble-utils';
import { loadRecords } from '@/lib/pipeline/records';
import type { RewriteContext } from '@/lib/pipeline/rewrite';
import {
  requirementsOf,
  type AchievementRecord,
  type EvidenceMatrix,
  type Requirement,
  type Score,
} from '@/lib/pipeline/types';
import { rewriteAndVerifyBullets } from '@/lib/pipeline/verify';
import { verifyBullet, type VerifyContext } from '@/lib/pipeline/verify-code';
import {
  bulletIds,
  findBullet,
  moveBullet as moveInDoc,
  removeBullet,
  replaceBullet,
  setBulletText,
} from './doc-ops';
import {
  matchReport as matchReportSchema,
  resumeDoc,
  type MatchReport,
  type ResumeDoc,
} from './types';

export class EditorError extends Error {}

type Loaded = {
  resumeId: string;
  jobId: string;
  status: 'draft' | 'final';
  doc: ResumeDoc;
  report: MatchReport;
  sim: RecruiterSim | null;
  jd: ParsedJD;
  bullets: Map<
    string,
    { id: string; achievementId: string | null; finalText: string; requirementsCovered: string[] }
  >;
  /** Set when this draft was just forked from a final version: old bullet id → new bullet id. */
  remap?: Map<string, string>;
};

async function load(userId: string, resumeId: string): Promise<Loaded> {
  const [row] = await withUser(userId, (tx) =>
    tx.select().from(resumes).where(eq(resumes.id, resumeId)),
  );
  if (!row?.jobId) throw new EditorError('Resume not found');
  const job = await getJob(userId, row.jobId);
  if (!job?.parsed) throw new EditorError('Job not found');
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: resumeBullets.id,
        achievementId: resumeBullets.achievementId,
        finalText: resumeBullets.finalText,
        requirementsCovered: resumeBullets.requirementsCovered,
      })
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, resumeId)),
  );
  const sim = recruiterSimOutput.safeParse(row.recruiterSim);
  return {
    resumeId,
    jobId: row.jobId,
    status: row.status,
    doc: resumeDoc.parse(row.content),
    report: matchReportSchema.parse(row.matchReport),
    sim: sim.success ? sim.data : null,
    jd: job.parsed,
    bullets: new Map(rows.map((r) => [r.id, r])),
  };
}

function matrixFrom(report: MatchReport): EvidenceMatrix {
  const m: EvidenceMatrix = {};
  for (const c of report.candidates) {
    m[c.achievementId] = Object.fromEntries(
      Object.entries(c.scores).map(([req, s]) => [req, { score: s as Score, reason: '' }]),
    );
  }
  return m;
}

async function contexts(
  userId: string,
  l: Loaded,
): Promise<{ ctx: RewriteContext; verifyCtx: VerifyContext; requirements: Requirement[] }> {
  const requirements = requirementsOf(l.jd);
  const [rules, tools] = await Promise.all([
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
  ]);
  return {
    requirements,
    ctx: {
      userId,
      jd: l.jd,
      requirements,
      matrix: matrixFrom(l.report),
      styleRules: rules.map((r) => r.rule),
    },
    verifyCtx: {
      vaultTools: tools.map((t) => t.t),
      jdKeywords: l.jd.keywords,
      targetCompany: l.jd.company,
    },
  };
}

async function records(userId: string, ids: string[]): Promise<Map<string, AchievementRecord>> {
  const rs = await withUser(userId, (tx) => loadRecords(tx, ids));
  return new Map(rs.map((r) => [r.id, r]));
}

/** Keyword usage and requirement coverage follow the current text and achievements on the page. */
function refreshReport(
  l: Loaded,
  doc: ResumeDoc,
  achievementByBullet: Map<string, string>,
): MatchReport {
  const requirements = requirementsOf(l.jd);
  const scores = new Map(l.report.candidates.map((c) => [c.achievementId, c.scores]));
  const coverage: Record<string, { bestScore: number; achievementId: string | null }> = {};
  for (const r of requirements) {
    let best = 0;
    let by: string | null = null;
    for (const id of bulletIds(doc)) {
      const a = achievementByBullet.get(id);
      const s = a ? (scores.get(a)?.[r.id] ?? 0) : 0;
      if (s > best) {
        best = s;
        by = a ?? null;
      }
    }
    coverage[r.id] = { bestScore: best, achievementId: by };
  }
  const bulletIdByAchievement = Object.fromEntries(
    [...achievementByBullet.entries()].map(([b, a]) => [a, b]),
  );
  const lines = [
    ...bulletIds(doc).map((id) => ({ id, text: findBullet(doc, id)!.text })),
    { id: 'headline', text: doc.headline },
    { id: 'summary', text: doc.summary },
  ];
  const next = buildMatchReport({
    jd: l.jd,
    requirements,
    selection: { roles: [], sideProjects: [], coverage, gaps: [], pickValue: {} },
    bulletIdByAchievement,
    lines,
    knockoutWarnings: l.report.knockoutWarnings,
    fallbackBullets: l.report.fallbackBullets.filter((id) => bulletIds(doc).includes(id)),
    candidates: l.report.candidates,
  });
  next.coveragePercent = weightedCoverage(next.mustHaveCoverage);
  return next;
}

/**
 * Editing a final resume forks a new draft version (SPEC §10: versions are created on
 * "Mark as final" / export, never on every keystroke). Bullet ids are re-minted for the copy.
 */
async function ensureDraft(userId: string, l: Loaded): Promise<Loaded> {
  if (l.status === 'draft') return l;
  const forked = await withUser(userId, async (tx) => {
    const [{ v } = { v: 0 }] = await tx
      .select({ v: max(resumes.version) })
      .from(resumes)
      .where(eq(resumes.jobId, l.jobId));
    const [orig] = await tx.select().from(resumes).where(eq(resumes.id, l.resumeId));
    const oldRows = await tx
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, l.resumeId));
    const remap = new Map(oldRows.map((b) => [b.id, crypto.randomUUID()]));
    let doc = l.doc;
    for (const [oldId, newId] of remap) {
      const b = findBullet(doc, oldId);
      if (b) doc = replaceBullet(doc, oldId, { bulletId: newId, text: b.text });
    }
    const report: MatchReport = {
      ...l.report,
      mustHaveCoverage: l.report.mustHaveCoverage.map((c) => ({
        ...c,
        coveredBy: c.coveredBy ? (remap.get(c.coveredBy) ?? null) : null,
      })),
      niceToHaveCoverage: l.report.niceToHaveCoverage.map((c) => ({
        ...c,
        coveredBy: c.coveredBy ? (remap.get(c.coveredBy) ?? null) : null,
      })),
      keywords: l.report.keywords.map((k) => ({
        ...k,
        where: k.where.map((w) => remap.get(w) ?? w),
      })),
      fallbackBullets: l.report.fallbackBullets.map((f) => remap.get(f) ?? f),
    };
    const [row] = await tx
      .insert(resumes)
      .values({
        userId,
        jobId: l.jobId,
        version: (v ?? 0) + 1,
        status: 'draft',
        content: doc,
        matchReport: report,
        recruiterSim: orig!.recruiterSim,
        pipelineRunId: orig!.pipelineRunId,
      })
      .returning({ id: resumes.id });
    if (oldRows.length) {
      await tx.insert(resumeBullets).values(
        oldRows.map((b) => ({
          userId: b.userId,
          achievementId: b.achievementId,
          section: b.section,
          position: b.position,
          generatedText: b.generatedText,
          finalText: b.finalText,
          keywordsUsed: b.keywordsUsed,
          requirementsCovered: b.requirementsCovered,
          verified: b.verified,
          verifierNotes: b.verifierNotes,
          id: remap.get(b.id)!,
          resumeId: row!.id,
        })),
      );
    }
    return { id: row!.id, doc, report, remap };
  });
  return { ...(await load(userId, forked.id)), remap: forked.remap };
}

export type EditResult = {
  resumeId: string;
  doc: ResumeDoc;
  report: MatchReport;
  bulletId?: string;
  warnings?: string[];
};

async function save(userId: string, l: Loaded, doc: ResumeDoc): Promise<EditResult> {
  const achievementByBullet = new Map<string, string>();
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: resumeBullets.id, a: resumeBullets.achievementId })
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, l.resumeId)),
  );
  for (const r of rows) if (r.a) achievementByBullet.set(r.id, r.a);
  const report = refreshReport(l, doc, achievementByBullet);
  await withUser(userId, async (tx) => {
    await tx
      .update(resumes)
      .set({ content: doc, matchReport: report })
      .where(eq(resumes.id, l.resumeId));
    // Positions follow page order.
    const ids = bulletIds(doc);
    for (const [position, id] of ids.entries()) {
      await tx.update(resumeBullets).set({ position }).where(eq(resumeBullets.id, id));
    }
  });
  return { resumeId: l.resumeId, doc, report };
}

const mapId = (l: Loaded, bulletId: string) => l.remap?.get(bulletId) ?? bulletId;

async function logEdit(
  userId: string,
  bulletId: string,
  kind: 'rewrite' | 'swap' | 'delete' | 'reorder',
  before: string | null,
  after: string | null,
) {
  await withUser(userId, (tx) =>
    tx.insert(userEdits).values({
      userId,
      resumeBulletId: bulletId,
      before,
      after,
      diff:
        before !== null && after !== null
          ? diffWords(before, after).filter((p) => p.added || p.removed)
          : null,
      editKind: kind,
    }),
  );
}

/** Inline edit (SPEC §10): save final_text, log a user_edits row, re-run code-level verification. */
export async function editBullet(
  userId: string,
  resumeId: string,
  bulletId: string,
  text: string,
): Promise<EditResult> {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) throw new EditorError('A bullet can’t be empty — delete it instead.');
  const l = await ensureDraft(userId, await load(userId, resumeId));
  const id = mapId(l, bulletId);
  const before = findBullet(l.doc, id)?.text;
  if (before === undefined) throw new EditorError('Bullet not found');
  if (before === clean)
    return {
      resumeId: l.resumeId,
      doc: l.doc,
      report: l.report,
      bulletId: id,
      warnings: await warningsFor(userId, l, id, clean),
    };

  await withUser(userId, (tx) =>
    tx.update(resumeBullets).set({ finalText: clean }).where(eq(resumeBullets.id, id)),
  );
  await logEdit(userId, id, 'rewrite', before, clean);
  const res = await save(userId, l, setBulletText(l.doc, id, clean));
  return { ...res, bulletId: id, warnings: await warningsFor(userId, l, id, clean) };
}

async function warningsFor(
  userId: string,
  l: Loaded,
  bulletId: string,
  text: string,
): Promise<string[]> {
  const a = l.bullets.get(bulletId)?.achievementId;
  if (!a) return [];
  const [recs, { verifyCtx }] = await Promise.all([records(userId, [a]), contexts(userId, l)]);
  const r = recs.get(a);
  return r ? verifyBullet(text, r, verifyCtx) : [];
}

/** Code-level warnings for every bullet currently on the page (shown as badges in the editor). */
export async function allWarnings(
  userId: string,
  resumeId: string,
): Promise<Record<string, string[]>> {
  const l = await load(userId, resumeId);
  const ids = bulletIds(l.doc);
  const achIds = ids.map((id) => l.bullets.get(id)?.achievementId).filter((x): x is string => !!x);
  const [recs, { verifyCtx }] = await Promise.all([records(userId, achIds), contexts(userId, l)]);
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    const r = recs.get(l.bullets.get(id)?.achievementId ?? '');
    const w = r ? verifyBullet(findBullet(l.doc, id)!.text, r, verifyCtx) : [];
    if (w.length) out[id] = w;
  }
  return out;
}

/** Regenerate one bullet with the strong model + full verification (optionally with a critique). */
export async function regenerateBullet(
  userId: string,
  resumeId: string,
  bulletId: string,
  critique?: string,
): Promise<EditResult> {
  const l = await ensureDraft(userId, await load(userId, resumeId));
  const id = mapId(l, bulletId);
  const achievementId = l.bullets.get(id)?.achievementId;
  if (!achievementId) throw new EditorError('This bullet isn’t linked to a vault achievement.');
  const [recs, { ctx, verifyCtx }] = await Promise.all([
    records(userId, [achievementId]),
    contexts(userId, l),
  ]);
  const record = recs.get(achievementId);
  if (!record) throw new EditorError('The source achievement was deleted from your vault.');

  const out = await rewriteAndVerifyBullets({
    ctx,
    records: [record],
    verifyCtx,
    extra: critique ? { [achievementId]: { critique } } : undefined,
  });
  const o = out[achievementId]!;
  await withUser(userId, (tx) =>
    tx
      .update(resumeBullets)
      .set({
        finalText: o.text,
        generatedText: o.generatedText || o.text,
        verified: o.verified,
        verifierNotes: { attempts: o.attempts, fallback: o.fallback },
      })
      .where(eq(resumeBullets.id, id)),
  );
  const res = await save(userId, l, setBulletText(l.doc, id, o.text));
  return {
    ...res,
    bulletId: id,
    warnings: o.fallback ? ['Couldn’t produce a verified rewrite; showing your vault text.'] : [],
  };
}

export type Alternative = { achievementId: string; score: number; action: string; where: string };

/** Swap candidates (SPEC §10): achievements not on the page, ranked by score on this bullet's requirements. */
export async function alternativesFor(
  userId: string,
  resumeId: string,
  bulletId: string,
): Promise<Alternative[]> {
  const l = await load(userId, resumeId);
  const current = l.bullets.get(bulletId);
  if (!current) throw new EditorError('Bullet not found');
  const onPage = new Set(bulletIds(l.doc).map((id) => l.bullets.get(id)?.achievementId));
  const weights = new Map(requirementsOf(l.jd).map((r) => [r.id, r.weight]));
  const reqs = current.requirementsCovered.length
    ? current.requirementsCovered
    : [...weights.keys()];
  const ranked = l.report.candidates
    .filter((c) => !onPage.has(c.achievementId))
    .map((c) => ({
      id: c.achievementId,
      score: reqs.reduce((s, r) => s + (weights.get(r) ?? 1) * (c.scores[r] ?? 0), 0),
      value: c.value,
    }))
    .filter((c) => c.score > 0 || c.value > 0)
    .sort((a, b) => b.score - a.score || b.value - a.value)
    .slice(0, 8);
  const recs = await records(
    userId,
    ranked.map((r) => r.id),
  );
  return ranked
    .filter((r) => recs.has(r.id))
    .map((r) => {
      const rec = recs.get(r.id)!;
      return {
        achievementId: r.id,
        score: r.score,
        action: rec.action,
        where: rec.role
          ? `${rec.role.title}, ${rec.role.company}`
          : (rec.project?.name ?? 'Side project'),
      };
    });
}

/** Replace a bullet with a rewrite of another vault achievement (logged as a 'swap' edit). */
export async function swapBullet(
  userId: string,
  resumeId: string,
  bulletId: string,
  achievementId: string,
): Promise<EditResult> {
  const l = await ensureDraft(userId, await load(userId, resumeId));
  const id = mapId(l, bulletId);
  const before = findBullet(l.doc, id)?.text ?? null;
  const [recs, { ctx, verifyCtx, requirements }] = await Promise.all([
    records(userId, [achievementId]),
    contexts(userId, l),
  ]);
  const record = recs.get(achievementId);
  if (!record) throw new EditorError('That achievement isn’t in your vault any more.');

  const o = (await rewriteAndVerifyBullets({ ctx, records: [record], verifyCtx }))[achievementId]!;
  const newId = crypto.randomUUID();
  const scores = l.report.candidates.find((c) => c.achievementId === achievementId)?.scores ?? {};
  await withUser(userId, (tx) =>
    tx.insert(resumeBullets).values({
      id: newId,
      userId,
      resumeId: l.resumeId,
      achievementId,
      section: record.role ? 'experience' : 'projects',
      position: 0,
      generatedText: o.generatedText || o.text,
      finalText: o.text,
      requirementsCovered: requirements.filter((r) => (scores[r.id] ?? 0) >= 2).map((r) => r.id),
      verified: o.verified,
      verifierNotes: { attempts: o.attempts, fallback: o.fallback, swappedFrom: id },
    }),
  );
  await logEdit(userId, id, 'swap', before, o.text);
  const res = await save(userId, l, replaceBullet(l.doc, id, { bulletId: newId, text: o.text }));
  return { ...res, bulletId: newId };
}

export async function deleteBullet(
  userId: string,
  resumeId: string,
  bulletId: string,
): Promise<EditResult> {
  const l = await ensureDraft(userId, await load(userId, resumeId));
  const id = mapId(l, bulletId);
  await logEdit(userId, id, 'delete', findBullet(l.doc, id)?.text ?? null, null);
  return save(userId, l, removeBullet(l.doc, id));
}

export async function moveBullet(
  userId: string,
  resumeId: string,
  bulletId: string,
  dir: -1 | 1,
): Promise<EditResult> {
  const l = await ensureDraft(userId, await load(userId, resumeId));
  const id = mapId(l, bulletId);
  await logEdit(userId, id, 'reorder', null, null);
  return save(userId, l, moveInDoc(l.doc, id, dir));
}

export async function markFinal(userId: string, resumeId: string) {
  await withUser(userId, (tx) =>
    tx.update(resumes).set({ status: 'final' }).where(eq(resumes.id, resumeId)),
  );
}

/** "Improve weakest line" (SPEC §7.8): regenerate the bullet the recruiter sim flagged, with its critique. */
export async function improveWeakestLine(userId: string, resumeId: string): Promise<EditResult> {
  const l = await load(userId, resumeId);
  if (!l.sim) throw new EditorError('No recruiter view for this resume.');
  let best: string | null = null;
  let bestSim = 0;
  for (const id of bulletIds(l.doc)) {
    const s = similarity(findBullet(l.doc, id)!.text, l.sim.weakest_line);
    if (s > bestSim) {
      bestSim = s;
      best = id;
    }
  }
  if (!best || bestSim < 0.3)
    throw new EditorError('The weakest line isn’t a bullet (it may be the headline or summary).');
  return regenerateBullet(userId, resumeId, best, l.sim.weakest_line_critique);
}

export async function sourcesFor(
  userId: string,
  resumeId: string,
): Promise<Record<string, AchievementRecord>> {
  const l = await load(userId, resumeId);
  const ids = bulletIds(l.doc)
    .map((id) => l.bullets.get(id)?.achievementId)
    .filter((x): x is string => !!x);
  const recs = await records(userId, ids);
  const out: Record<string, AchievementRecord> = {};
  for (const id of bulletIds(l.doc)) {
    const a = l.bullets.get(id)?.achievementId;
    if (a && recs.has(a)) out[id] = recs.get(a)!;
  }
  return out;
}
