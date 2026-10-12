import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminDb } from '@/lib/db/client';
import { createJob, saveJobParse } from '@/lib/db/queries/jobs';
import { pipelineRuns, resumeBullets, resumes } from '@/lib/db/schema';
import { seedFixtureVault } from '@/lib/evals/seed';
import { numbersIn } from '@/lib/import/source-check';
import { parseJD } from '@/lib/pipeline/parse-jd';
import { loadRecords } from '@/lib/pipeline/records';
import { runTailorPipeline } from '@/lib/pipeline/run';
import type { ProgressEvent } from '@/lib/pipeline/types';
import { verifyBullet } from '@/lib/pipeline/verify-code';
import { withUser } from '@/lib/db/client';
import { allBullets, resumeDoc } from '@/lib/resume/types';
import { ensureTestUser } from './helpers';

let userId = '';
let jobId = '';
let ids: Record<string, string> = {};

beforeAll(async () => {
  userId = await ensureTestUser('pipeline-it@resume-tailor.test');
  ids = await seedFixtureVault(userId);
  const text = await readFile('evals/jds/ai-pm-edtech.txt', 'utf8');
  jobId = await createJob(userId, { jdText: text });
  const parsed = await parseJD(userId, text);
  await saveJobParse(userId, jobId, parsed, true);
}, 240_000);

describe('tailoring pipeline (Phase 4 acceptance)', () => {
  it('runs end to end on the fixture vault: < 60 s, < $0.10, fabrications caught, zero code-level failures', async () => {
    const FAKE = ' and grew revenue by 73%';
    let corrupted: string | null = null;
    const events: ProgressEvent[] = [];

    const result = await runTailorPipeline({
      userId,
      jobId,
      onEvent: (e) => events.push(e),
      hooks: {
        // Inject a fabricated number into the first rewrite of one bullet.
        corruptRewrite: (achievementId, attempt, text) => {
          if (attempt === 0 && corrupted === null) {
            corrupted = achievementId;
            return text.replace(/\.?$/, FAKE);
          }
          return text;
        },
      },
    });

    console.log(`pipeline: ${result.durationMs} ms, $${result.costUsd.toFixed(4)}`);
    expect(result.durationMs).toBeLessThan(60_000);
    expect(result.costUsd).toBeLessThan(0.1);
    expect(events.map((e) => e.stage)).toEqual(
      expect.arrayContaining([
        'retrieve',
        'score',
        'select',
        'rewrite',
        'verify',
        'assemble',
        'done',
      ]),
    );

    const [resume] = await adminDb().select().from(resumes).where(eq(resumes.id, result.resumeId));
    const doc = resumeDoc.parse(resume!.content);
    const bullets = await adminDb()
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, result.resumeId));

    // Every bullet traces to a vault achievement.
    expect(bullets.length).toBeGreaterThanOrEqual(6);
    expect(bullets.every((b) => b.achievementId)).toBe(true);
    expect(
      allBullets(doc)
        .map((b) => b.bulletId)
        .sort(),
    ).toEqual(bullets.map((b) => b.id).sort());

    // The injected fake number was caught and is not in the final output.
    expect(corrupted).not.toBeNull();
    const hit = bullets.find((b) => b.achievementId === corrupted)!;
    const notes = hit.verifierNotes as {
      attempts: { text: string; reasons: string[] }[];
      fallback: boolean;
    };
    expect(notes.attempts[0]!.text).toContain('73%');
    expect(notes.attempts[0]!.reasons.join(' ')).toMatch(/73/);
    expect(hit.finalText).not.toContain('73%');

    // Zero code-level verification failures in the final output.
    const records = await withUser(userId, (tx) =>
      loadRecords(
        tx,
        bullets.map((b) => b.achievementId!),
      ),
    );
    const byId = new Map(records.map((r) => [r.id, r]));
    const vaultTools = [...new Set(records.flatMap((r) => [...r.tools, ...r.skills]))];
    const jd = await import('@/lib/db/queries/jobs').then((m) => m.getJob(userId, jobId));
    for (const b of bullets) {
      const reasons = verifyBullet(b.finalText, byId.get(b.achievementId!)!, {
        vaultTools,
        jdKeywords: jd!.parsed!.keywords,
        targetCompany: jd!.parsed!.company,
      });
      expect(reasons, `${b.finalText}`).toEqual([]);
    }
    // No number anywhere on the page that isn't in the vault fixture.
    const fixtureText = await readFile('evals/fixtures/vault.json', 'utf8');
    const fixtureNums = new Set(numbersIn(fixtureText));
    for (const line of [doc.headline, doc.summary, ...allBullets(doc).map((b) => b.text)]) {
      for (const n of numbersIn(line)) expect(fixtureNums.has(n), `${n} in "${line}"`).toBe(true);
    }

    // The JD's core skills are well covered by this vault.
    const report = resume!.matchReport as { coveragePercent: number; fallbackBullets: string[] };
    console.log(
      'coverage',
      report.coveragePercent,
      'fallbacks',
      report.fallbackBullets.length,
      'bullets',
      bullets.length,
    );
    expect(report.coveragePercent).toBeGreaterThanOrEqual(60);
    expect(resume!.recruiterSim).toBeTruthy();

    const [run] = await adminDb()
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, result.pipelineRunId));
    expect(run).toMatchObject({ status: 'done' });
    expect(run!.totalTokens).toBeGreaterThan(0);
    expect(Object.keys(ids).length).toBeGreaterThan(50);
  }, 180_000);
});
