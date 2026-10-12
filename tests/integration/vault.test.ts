import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminDb } from '@/lib/db/client';
import { getVaultTree, saveAchievement, saveProject, saveRole } from '@/lib/db/queries/vault';
import { achievements, education, extras, profiles, projects, roles } from '@/lib/db/schema';
import { extractResumeText } from '@/lib/import/parse-resume';
import { saveImport } from '@/lib/import/save-import';
import { checkImport, normaliseSource, numbersIn } from '@/lib/import/source-check';
import { structureSource } from '@/lib/import/structure';
import { achievementInput, projectInput, roleInput } from '@/lib/llm/schemas/vault';
import { refreshAchievements } from '@/lib/vault/embed';
import { acceptProposals, runInterviewTurn } from '@/lib/vault/interview';
import { ensureTestUser } from './helpers';

let userId = '';

async function wipeVault(uid: string) {
  const db = adminDb();
  await db.delete(roles).where(eq(roles.userId, uid));
  await db.delete(projects).where(eq(projects.userId, uid));
  await db.delete(achievements).where(eq(achievements.userId, uid));
  await db.delete(education).where(eq(education.userId, uid));
  await db.delete(extras).where(eq(extras.userId, uid));
  await db.delete(profiles).where(eq(profiles.userId, uid));
}

beforeAll(async () => {
  userId = await ensureTestUser('vault-it@resume-tailor.test');
  await wipeVault(userId);
});

describe('resume text extraction', () => {
  it('reads PDF and DOCX', async () => {
    for (const [file, kind] of [
      ['sample-resume.pdf', 'pdf'],
      ['sample-resume.docx', 'docx'],
    ] as const) {
      const text = await extractResumeText(
        new Uint8Array(await readFile(`tests/fixtures/${file}`)),
        kind,
      );
      expect(text).toContain('LearnLoop');
      expect(text).toContain('12,000');
    }
  });
});

describe('resume import (Phase 2 acceptance)', () => {
  it('produces roles/projects/achievements with no facts the resume did not contain', async () => {
    const text = await extractResumeText(
      new Uint8Array(await readFile('tests/fixtures/sample-resume.pdf')),
      'pdf',
    );
    const { draft } = await structureSource(userId, 'resume', text);
    const source = normaliseSource(text);

    expect(draft.roles.map((r: { company: string }) => r.company).sort()).toEqual([
      'LearnLoop',
      'PayNest',
    ]);
    const allAch = [...draft.roles.flatMap((r) => r.projects), ...draft.side_projects].flatMap(
      (p) => p.achievements,
    );
    expect(allAch.length).toBeGreaterThanOrEqual(7);

    // Every metric number appears in the source; re-checking yields no metric removals.
    for (const a of allAch) {
      for (const n of numbersIn(a.metric_value ?? '')) expect(source).toContain(n);
    }
    expect(
      checkImport(draft, text).flags.filter((f) => f.message.startsWith('Removed metric')),
    ).toHaveLength(0);

    // Hedged figures stay estimates.
    const kyc = allAch.find((a) => /kyc/i.test(a.action + (a.result ?? '')));
    expect(kyc?.metric_confidence).toBe('estimate');
    // Unstated fields stay empty: no company_context for PayNest beyond "fintech", no proof URL on work projects.
    expect(
      draft.roles
        .flatMap((r) => r.projects)
        .every(
          (p) =>
            !p.proof_url || source.includes(p.proof_url.toLowerCase().replace(/^https?:\/\//, '')),
        ),
    ).toBe(true);

    const saved = await saveImport(userId, draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const { embeddingError } = await refreshAchievements(userId, saved.achievementIds);
    expect(embeddingError).toBeNull();

    const tree = await getVaultTree(userId);
    expect(tree.roles).toHaveLength(2);
    const cards = tree.roles.flatMap((r) => r.projects).flatMap((p) => p.achievements);
    expect(cards.every((c) => c.hasEmbedding)).toBe(true);
    expect(cards.every((c) => c.completenessScore > 0)).toBe(true);
  });
});

describe('embeddings', () => {
  it('editing an achievement updates its embedding', async () => {
    const roleId = await saveRole(
      userId,
      null,
      roleInput.parse({ company: 'EmbedCo', title: 'PM', startDate: '2020-01' }),
    );
    const projectId = await saveProject(
      userId,
      null,
      projectInput.parse({ roleId, name: 'Search' }),
    );
    const id = await saveAchievement(
      userId,
      null,
      achievementInput.parse({ projectId, action: 'Shipped a search bar' }),
    );
    await refreshAchievements(userId, [id]);
    const read = async () =>
      (
        await adminDb()
          .select({ e: achievements.embedding })
          .from(achievements)
          .where(eq(achievements.id, id))
      )[0]!.e;
    const before = await read();

    await saveAchievement(
      userId,
      id,
      achievementInput.parse({
        projectId,
        action: 'Negotiated a vendor contract for payroll software',
      }),
    );
    await refreshAchievements(userId, [id]);
    const after = await read();

    expect(before).toHaveLength(1536);
    expect(after).toHaveLength(1536);
    expect(after).not.toEqual(before);
  });
});

describe('AI interviewer (Phase 2 acceptance)', () => {
  it('produces at least one new or updated achievement after a 6-question session', async () => {
    const tree = await getVaultTree(userId);
    const project = tree.roles.find((r) => r.company === 'LearnLoop')!.projects[0]!;
    const answers = [
      'Students were stuck on homework at night when no tutor was online, so they churned.',
      'I owned the product spec and the eval harness; 3 engineers built the backend with me.',
      'Grade 8–10 students on our tutoring app, mostly in Tier-2 cities.',
      'Weekly active students on the helper went from 0 to 12,000 in 3 months.',
      'GPT-4, LangChain, Python for evals, Amplitude for tracking.',
      'The hardest part was stopping it from just giving answers — we added a hint-first mode.',
    ];
    const messages: { role: 'assistant' | 'user'; content: string }[] = [];
    let turn = await runInterviewTurn(userId, project.id, messages, false);
    for (const answer of answers) {
      expect(turn.done).toBe(false);
      if (turn.done) break;
      messages.push(
        { role: 'assistant', content: turn.question },
        { role: 'user', content: answer },
      );
      turn = await runInterviewTurn(userId, project.id, messages, false);
    }
    if (!turn.done) turn = await runInterviewTurn(userId, project.id, messages, true);
    expect(turn.done).toBe(true);
    if (!turn.done) return;
    expect(turn.proposals.length).toBeGreaterThanOrEqual(1);

    // Hard rule: no number the candidate didn't say.
    const said = normaliseSource(answers.join(' ') + JSON.stringify(project.achievements));
    for (const p of turn.proposals)
      for (const n of numbersIn(p.metric_value ?? '')) expect(said).toContain(n);

    const { ids, embeddingError } = await acceptProposals(userId, project.id, turn.proposals);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(embeddingError).toBeNull();
  }, 300_000);
});

describe('more sources: brief + portfolio', () => {
  it('a brief adds to an existing project and creates a new side project, with no invented numbers', async () => {
    const before = await getVaultTree(userId);
    const learnloop = before.roles.find((r) => r.company === 'LearnLoop')!;
    const brief = `At LearnLoop, on the AI homework helper, I also designed a hint-first mode so students get nudges
before answers; parent complaints about answer-copying dropped to 3 per week.
Separately, in 2024 I built a WhatsApp ordering bot for a local bakery using Python and Twilio. It handled about 40 orders a week.`;

    const { draft, merge } = await structureSource(userId, 'brief', brief);

    // Work at an existing employer attaches to the existing role — never a duplicate role.
    const merged = draft.roles.find((r) => r.existing_role_id === learnloop.id);
    expect(merged, 'should attach to the existing LearnLoop role').toBeTruthy();
    expect(merge.roleTargets).toBeTruthy();
    expect(draft.roles.filter((r) => !r.existing_role_id)).toHaveLength(0);
    expect(draft.side_projects.length).toBeGreaterThanOrEqual(1);

    const source = normaliseSource(brief);
    const all = [...draft.roles.flatMap((r) => r.projects), ...draft.side_projects].flatMap(
      (p) => p.achievements,
    );
    for (const a of all)
      for (const n of numbersIn(a.metric_value ?? '')) expect(source).toContain(n);
    // "about 40 orders a week" must keep its hedge wherever it lands.
    expect(all.some((a) => /\b40\b/.test(`${a.metric_value} ${a.result}`))).toBe(true);
    for (const a of all.filter((x) => numbersIn(x.metric_value ?? '').includes('40'))) {
      expect(a.metric_confidence).toBe('estimate');
    }
    // No two achievements in one project share the same action.
    for (const p of [...draft.roles.flatMap((r) => r.projects), ...draft.side_projects]) {
      const actions = p.achievements.map((a) => a.action.toLowerCase());
      expect(new Set(actions).size).toBe(actions.length);
    }

    const saved = await saveImport(userId, draft);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.counts.roles).toBe(0); // nothing duplicated

    const after = await getVaultTree(userId);
    expect(after.roles).toHaveLength(before.roles.length);
    const count = (t: typeof before) =>
      t.roles
        .find((r) => r.id === learnloop.id)!
        .projects.reduce((n, p) => n + p.achievements.length, 0);
    expect(count(after)).toBeGreaterThan(count(before));
    expect(after.sideProjects.length).toBeGreaterThan(before.sideProjects.length);
  }, 180_000);

  it('reads a multi-page portfolio site and turns it into vault entries', async () => {
    const { createServer } = await import('node:http');
    const pages: Record<string, string> = {
      '/': `<html><head><title>Priya Sharma — Portfolio</title></head><body>
        <h1>Priya Sharma</h1><p>Product manager. Selected work below.</p>
        <a href="/projects/study-planner">Study planner</a> <a href="/projects/ngo-dashboard">NGO dashboard</a>
        <a href="https://twitter.com/x">Twitter</a></body></html>`,
      '/projects/study-planner': `<html><head><title>Study planner</title></head><body><article><h1>Study planner app</h1>
        <p>${'A side project. '.repeat(5)}I designed and built a React Native study planner for exam prep with spaced repetition.
        It reached 1,500 downloads on the Play Store in the first two months. Tools: React Native, Firebase.</p></article></body></html>`,
      '/projects/ngo-dashboard': `<html><head><title>NGO dashboard</title></head><body><article><h1>Volunteer: NGO impact dashboard</h1>
        <p>${'Volunteer work. '.repeat(5)}I volunteered with Teach Forward to build a Google Data Studio dashboard tracking attendance
        across 12 schools, replacing a weekly manual Excel report.</p></article></body></html>`,
    };
    const server = createServer((req, res) => {
      const body = pages[req.url ?? ''];
      res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }).end(body ?? 'not found');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };

    try {
      const { fetchPortfolio } = await import('@/lib/import/fetch-page');
      // The private-address guard is on in the app; the local test server needs it off.
      await expect(fetchPortfolio(`http://127.0.0.1:${port}/`)).rejects.toThrow();
      const site = await fetchPortfolio(`http://127.0.0.1:${port}/`, {
        allowPrivate: true,
        render: false,
      });
      expect(site.pages).toHaveLength(3);
      expect(site.text).toContain('1,500 downloads');

      const { draft } = await structureSource(userId, 'portfolio', site.text);
      const names = draft.side_projects.map((p) => p.name.toLowerCase()).join(' | ');
      expect(names).toMatch(/study planner/);
      expect(names).toMatch(/ngo|dashboard|teach forward/);
      const all = draft.side_projects.flatMap((p) => p.achievements);
      const source = normaliseSource(site.text);
      for (const a of all)
        for (const n of numbersIn(a.metric_value ?? '')) expect(source).toContain(n);
    } finally {
      server.close();
    }
  }, 180_000);
});
