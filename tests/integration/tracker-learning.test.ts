import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminDb, withUser } from '@/lib/db/client';
import {
  createApplication,
  listApplications,
  updateApplicationStatus,
} from '@/lib/db/queries/applications';
import { createJob } from '@/lib/db/queries/jobs';
import { applications, resumes, styleRules, userEdits } from '@/lib/db/schema';
import { seedFixtureVault } from '@/lib/evals/seed';
import { maybeDeriveStyleRules } from '@/lib/learning/style-rules';
import { parsedJD } from '@/lib/llm/schemas/jd';
import { loadRecords } from '@/lib/pipeline/records';
import { rewriteBullet } from '@/lib/pipeline/rewrite';
import { requirementsOf } from '@/lib/pipeline/types';
import { callbackStats } from '@/lib/tracker/stats';
import { ensureTestUser } from './helpers';

let userId = '';
let ids: Record<string, string> = {};

beforeAll(async () => {
  userId = await ensureTestUser('tracker-it@resume-tailor.test');
  ids = await seedFixtureVault(userId); // also wipes previous applications, jobs and style rules
  await adminDb().delete(userEdits).where(eq(userEdits.userId, userId));
}, 180_000);

describe('application tracker (Phase 6 acceptance)', () => {
  it('records every status change in status_history', async () => {
    const id = await createApplication(userId, {
      resumeId: null,
      company: 'Habitly',
      roleTitle: 'Growth PM',
      roleFamily: 'growth',
      isTailored: false,
      appliedAt: '2026-10-01',
      channel: 'portal',
      status: 'applied',
      notes: null,
    });
    for (const s of ['callback', 'interview', 'rejected'] as const)
      await updateApplicationStatus(userId, id, s);
    await updateApplicationStatus(userId, id, 'rejected'); // no-op: same status
    const [row] = await adminDb().select().from(applications).where(eq(applications.id, id));
    expect(row!.status).toBe('rejected');
    expect(row!.statusHistory.map((h) => h.status)).toEqual([
      'applied',
      'callback',
      'interview',
      'rejected',
    ]);
    expect(row!.statusHistory.every((h) => !Number.isNaN(Date.parse(h.at)))).toBe(true);
  });

  it('dashboard stats split tailored vs baseline with N shown', async () => {
    // A tailored application linked to an exact resume version.
    const jobId = await createJob(userId, { jdText: 'Growth PM at Habitly…' });
    const [resume] = await withUser(userId, (tx) =>
      tx
        .insert(resumes)
        .values({ userId, jobId, version: 1, status: 'final', content: {} })
        .returning({ id: resumes.id }),
    );
    const tailoredId = await createApplication(userId, {
      resumeId: resume!.id,
      company: 'Habitly',
      roleTitle: 'Growth PM',
      roleFamily: 'growth',
      isTailored: true,
      appliedAt: '2026-10-02',
      channel: 'referral',
      status: 'applied',
      notes: null,
    });
    await updateApplicationStatus(userId, tailoredId, 'interview');

    const apps = await listApplications(userId);
    const tailored = apps.find((a) => a.id === tailoredId)!;
    expect(tailored).toMatchObject({ resumeId: resume!.id, resumeVersion: 1, isTailored: true });

    const s = callbackStats(apps);
    expect(s.tailored).toMatchObject({ n: 1, callbacks: 1, enough: false });
    expect(s.baseline).toMatchObject({ n: 1, callbacks: 1, enough: false }); // reached callback before rejection
    expect(s.byFamily.map((f) => f.family)).toEqual(['growth']);
  });
});

describe('learning from edits (Phase 6 acceptance)', () => {
  it('after 5 consistent edits a style rule appears and the next rewrite honours it', async () => {
    const pairs = [
      [
        'Built an onboarding quiz that personalised study plans for new learners',
        'Shipped an onboarding quiz that personalised study plans for new learners',
      ],
      [
        'Built a referral loop that rewarded both learners with premium days',
        'Shipped a referral loop that rewarded both learners with premium days',
      ],
      [
        'Built a teacher dashboard for coaching centres to track batches',
        'Shipped a teacher dashboard for coaching centres to track batches',
      ],
      [
        'Built a mandate retry system that recovered failed UPI payments',
        'Shipped a mandate retry system that recovered failed UPI payments',
      ],
      [
        'Built an evaluation suite that graded tutor answers before release',
        'Shipped an evaluation suite that graded tutor answers before release',
      ],
    ];
    for (const [before, after] of pairs) {
      await withUser(userId, (tx) =>
        tx.insert(userEdits).values({ userId, before, after, editKind: 'rewrite', diff: null }),
      );
    }
    await maybeDeriveStyleRules(userId);
    const rules = await adminDb().select().from(styleRules).where(eq(styleRules.userId, userId));
    expect(rules.length).toBeGreaterThanOrEqual(1);
    const rule = rules.find((r) => /shipped/i.test(r.rule));
    expect(rule, JSON.stringify(rules.map((r) => r.rule))).toBeTruthy();
    expect(rule!.active).toBe(true);

    // The next rewrite of a "Built …" achievement follows the rule.
    const [record] = await withUser(userId, (tx) => loadRecords(tx, [ids.a40!]));
    expect(record!.action.startsWith('Built')).toBe(true);
    const jd = parsedJD.parse({
      role_title: 'AI Product Manager',
      role_family: 'ai_pm',
      seniority: 'mid',
      company_stage: 'growth',
      core_problems: ['Ship LLM features that users love'],
      must_haves: [
        { id: 'm1', req: 'Shipped AI/ML products', weight: 5, evidence_type: 'outcome' },
      ],
      keywords: [{ term: 'embeddings', synonyms: [], weight: 4 }],
      tone: 'builder culture',
    });
    const out = await rewriteBullet(
      {
        userId,
        jd,
        requirements: requirementsOf(jd),
        matrix: { [record!.id]: { m1: { score: 3, reason: '' } } },
        styleRules: rules.filter((r) => r.active).map((r) => r.rule),
      },
      record!,
    );
    expect(out.bullet.split(/\s+/)[0]).toBe('Shipped');
  }, 120_000);
});
