import { readFile } from 'node:fs/promises';
import { and, desc, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminDb } from '@/lib/db/client';
import { createJob, saveJobParse } from '@/lib/db/queries/jobs';
import { getResume } from '@/lib/db/queries/resumes';
import { resumeBullets, resumes, userEdits } from '@/lib/db/schema';
import { seedFixtureVault } from '@/lib/evals/seed';
import { renderDocx } from '@/lib/export/docx';
import { exportFilename } from '@/lib/export/filename';
import { renderPdf } from '@/lib/export/pdf';
import { SECTION_HEADINGS } from '@/lib/export/template';
import { parseJD } from '@/lib/pipeline/parse-jd';
import { runTailorPipeline } from '@/lib/pipeline/run';
import { bulletIds, findBullet } from '@/lib/resume/doc-ops';
import { alternativesFor, editBullet, markFinal, swapBullet } from '@/lib/resume/editor';
import { allBullets } from '@/lib/resume/types';
import { ensureTestUser } from './helpers';

let userId = '';
let jobId = '';
let resumeId = '';

beforeAll(async () => {
  userId = await ensureTestUser('editor-it@resume-tailor.test');
  await seedFixtureVault(userId);
  const text = await readFile('evals/jds/growth-consumer.txt', 'utf8');
  jobId = await createJob(userId, { jdText: text });
  await saveJobParse(userId, jobId, await parseJD(userId, text), true);
  resumeId = (await runTailorPipeline({ userId, jobId })).resumeId;
}, 300_000);

// PDF text breaks lines at hyphens ("in-\nhouse"); rejoin those before comparing.
const norm = (s: string) =>
  s.replace(/[‐-―]/g, '-').replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim();

describe('editor (Phase 5 acceptance)', () => {
  it('inline edits persist, create user_edits rows, and re-run code verification', async () => {
    const before = (await getResume(userId, resumeId))!.content;
    const target = bulletIds(before)[0]!;
    const original = findBullet(before, target)!.text;

    const edited = original.replace(/^\w+/, 'Shipped');
    const res = await editBullet(userId, resumeId, target, edited);
    expect(res.resumeId).toBe(resumeId);
    expect(findBullet(res.doc, target)?.text).toBe(edited);
    expect(res.warnings).toEqual([]);

    const [row] = await adminDb().select().from(resumeBullets).where(eq(resumeBullets.id, target));
    expect(row!.finalText).toBe(edited);
    expect(row!.generatedText).toBe(original); // model output kept for learning
    const [edit] = await adminDb()
      .select()
      .from(userEdits)
      .where(eq(userEdits.resumeBulletId, target))
      .orderBy(desc(userEdits.createdAt));
    expect(edit).toMatchObject({ before: original, after: edited, editKind: 'rewrite' });
    expect(Array.isArray(edit!.diff)).toBe(true);

    // A number the vault doesn't support gets flagged immediately.
    const fake = await editBullet(
      userId,
      resumeId,
      target,
      `${edited} reaching 987 enterprise customers`,
    );
    expect(fake.warnings?.join(' ')).toMatch(/987/);
  }, 120_000);

  it('swap shows alternatives ranked by score and replaces the bullet with a verified rewrite', async () => {
    const doc = (await getResume(userId, resumeId))!.content;
    const target = bulletIds(doc)[1]!;
    const alts = await alternativesFor(userId, resumeId, target);
    expect(alts.length).toBeGreaterThan(0);
    const scores = alts.map((a) => a.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // Alternatives never include achievements already on the page.
    const rows = await adminDb()
      .select({ a: resumeBullets.achievementId, id: resumeBullets.id })
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, resumeId));
    const onPage = new Set(rows.filter((r) => bulletIds(doc).includes(r.id)).map((r) => r.a));
    expect(alts.some((a) => onPage.has(a.achievementId))).toBe(false);

    const res = await swapBullet(userId, resumeId, target, alts[0]!.achievementId);
    expect(bulletIds(res.doc)).not.toContain(target);
    expect(res.bulletId && bulletIds(res.doc)).toContain(res.bulletId);
    const [newRow] = await adminDb()
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.id, res.bulletId!));
    expect(newRow!.achievementId).toBe(alts[0]!.achievementId);
    const swaps = await adminDb()
      .select()
      .from(userEdits)
      .where(and(eq(userEdits.resumeBulletId, target), eq(userEdits.editKind, 'swap')));
    expect(swaps).toHaveLength(1);
  }, 120_000);

  it('editing a final version forks a new draft version', async () => {
    await markFinal(userId, resumeId);
    const doc = (await getResume(userId, resumeId))!.content;
    const target = bulletIds(doc)[2]!;
    const res2 = await editBullet(
      userId,
      resumeId,
      target,
      findBullet(doc, target)!.text.replace(/^\w+/, 'Drove'),
    );
    expect(res2.resumeId).not.toBe(resumeId);
    const versions = await adminDb()
      .select({ id: resumes.id, v: resumes.version, s: resumes.status })
      .from(resumes)
      .where(eq(resumes.jobId, jobId));
    expect(versions.find((v) => v.id === resumeId)?.s).toBe('final');
    expect(versions.find((v) => v.id === res2.resumeId)).toMatchObject({ s: 'draft' });
    expect((await getResume(userId, resumeId))!.content).toEqual(doc); // the final version is untouched
  }, 120_000);
});

describe('export (Phase 5 acceptance)', () => {
  it('PDF has real selectable text with every bullet present in order', async () => {
    const doc = (await getResume(userId, resumeId))!.content;
    const pdf = await renderPdf(doc);
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: pdf });
    const text = norm((await parser.getText()).text);
    await parser.destroy();

    let cursor = 0;
    for (const b of allBullets(doc)) {
      // Line wrapping can split words with spaces/hyphens; compare on normalised text.
      const needle = norm(b.text);
      const at = text.indexOf(needle, cursor);
      expect(at, `missing or out of order: ${needle}`).toBeGreaterThanOrEqual(0);
      cursor = at + needle.length;
    }
    for (const h of Object.values(SECTION_HEADINGS).filter(
      (h) => h !== SECTION_HEADINGS.extras || doc.extras.length,
    )) {
      if (h === 'Projects' && !doc.projects.length) continue;
      if (h === 'Education' && !doc.education.length) continue;
      expect(text.toUpperCase()).toContain(h.toUpperCase());
    }
  }, 120_000);

  it('DOCX opens and has the correct headings in order', async () => {
    const doc = (await getResume(userId, resumeId))!.content;
    const buf = await renderDocx(doc);
    const mammoth = await import('mammoth');
    const html = (await mammoth.convertToHtml({ buffer: buf })).value;
    const headings = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map((m) =>
      m[1]!.replace(/<[^>]+>/g, '').replace('&amp;', '&'),
    );
    const expected = [
      doc.education.length ? 'Education' : null,
      'Experience',
      doc.projects.length ? 'Projects' : null,
      doc.skills.length ? 'Skills' : null,
      doc.extras.length ? SECTION_HEADINGS.extras : null,
    ].filter(Boolean);
    expect(headings).toEqual(expected);
    const raw = norm((await mammoth.extractRawText({ buffer: buf })).value);
    for (const b of allBullets(doc)) expect(raw).toContain(norm(b.text));
  }, 60_000);

  it('names files {FullName}_{Company}_{RoleTitle}', () => {
    expect(exportFilename('Aarav Mehta', 'Habitly', 'Growth Product Manager', 'pdf')).toBe(
      'AaravMehta_Habitly_GrowthProductManager.pdf',
    );
  });
});
