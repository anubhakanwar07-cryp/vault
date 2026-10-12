import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJob, getJob, saveJobParse, setJobParse } from '@/lib/db/queries/jobs';
import { FetchPageError, fetchJD } from '@/lib/import/fetch-jd';
import { parseJD } from '@/lib/pipeline/parse-jd';
import { ensureTestUser } from './helpers';

let userId = '';
const jd = (name: string) => readFile(`evals/jds/${name}.txt`, 'utf8');

beforeAll(async () => {
  userId = await ensureTestUser('jd-it@resume-tailor.test');
});

// Phase 3 acceptance: 5 JDs (paste + URL) parse into a valid ParsedJD.
describe('parseJD on pasted JDs', () => {
  it.each([
    ['ai-pm-edtech', 'ai_pm', /llm|eval/i],
    ['pm-fintech-payments', 'pm', /upi|payment/i],
    ['growth-consumer', 'growth', /a\/b|experiment/i],
    ['product-analyst', 'analyst', /sql/i],
    ['data-pm-healthcare', 'pm', /data|analytics|sql/i],
  ])(
    '%s',
    async (name, family, mustHaveMatch) => {
      const p = await parseJD(userId, await jd(name));
      // data-pm can legitimately be read as "data" or "pm"
      if (name === 'data-pm-healthcare') expect(['pm', 'data']).toContain(p.role_family);
      else expect(p.role_family).toBe(family);
      expect(p.core_problems.length).toBeGreaterThanOrEqual(1);
      expect(p.must_haves.length).toBeGreaterThanOrEqual(2);
      expect(p.must_haves.map((m) => m.req).join(' ')).toMatch(mustHaveMatch);
      expect(p.keywords.length).toBeGreaterThanOrEqual(8);
      expect(p.must_haves.every((m, i) => m.id === `m${i + 1}`)).toBe(true);
    },
    120_000,
  );
});

describe('JD by URL', () => {
  let base = '';
  const server = createServer(async (req, res) => {
    if (req.url === '/jobs/ai-pm') {
      const text = await jd('ai-pm-edtech');
      const body = `<html><head><title>Careers — Brightpath</title><script>alert(1)</script></head><body>
        <nav>Home Careers</nav><main><article>${text
          .split('\n')
          .map((l) => `<p>${l.replace(/</g, '&lt;')}</p>`)
          .join('')}</article></main><footer>© Brightpath</footer></body></html>`;
      res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    } else if (req.url === '/blocked') {
      res.writeHead(403, { 'content-type': 'text/html' }).end('Forbidden');
    } else if (req.url === '/empty') {
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<html><body><div id="root"></div></body></html>');
    } else res.writeHead(404).end();
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => {
    server.close();
  });

  it('extracts and parses a JD from a careers page', async () => {
    const page = await fetchJD(`${base}/jobs/ai-pm`, { allowPrivate: true, render: false });
    expect(page.text).toContain('AI tutor');
    expect(page.text).not.toContain('alert(1)');
    const p = await parseJD(userId, page.text);
    expect(p.role_family).toBe('ai_pm');
  }, 120_000);

  it('a site that blocks fetching falls back to paste with a clear message', async () => {
    await expect(
      fetchJD(`${base}/blocked`, { allowPrivate: true, render: false }),
    ).rejects.toBeInstanceOf(FetchPageError);
    const err = await fetchJD(`${base}/empty`, { allowPrivate: true, render: false }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FetchPageError);
    expect((err as FetchPageError).userMessage).toMatch(/paste/i);
  });

  it('the SSRF guard blocks private addresses by default', async () => {
    await expect(fetchJD(`${base}/jobs/ai-pm`)).rejects.toBeInstanceOf(FetchPageError);
  });
});

describe('prompt injection (SPEC §16)', () => {
  it('instructions inside the JD do not change the output', async () => {
    const p = await parseJD(userId, await jd('injection-test'));
    expect(p.role_title.toLowerCase()).toContain('product manager');
    expect(p.role_title).not.toMatch(/chief executive/i);
    expect(p.role_family).not.toBe('engineering');
    const all = JSON.stringify([...p.knockouts, ...p.must_haves.map((m) => m.req)]);
    expect(all).not.toMatch(/10\+? years/i);
  }, 120_000);
});

describe('confirm screen persistence', () => {
  it('edits on the confirm screen persist and confirmation is recorded', async () => {
    const text = await jd('growth-consumer');
    const jobId = await createJob(userId, { jdText: text });
    const parsed = await parseJD(userId, text);
    await setJobParse(userId, jobId, parsed);

    const edited = {
      ...parsed,
      role_title: 'Growth PM (edited)',
      must_haves: [
        ...parsed.must_haves,
        { id: 'mX', req: 'Referral programs', weight: 4, evidence_type: 'outcome' as const },
      ],
      keywords: parsed.keywords.filter((_, i) => i !== 0),
    };
    await saveJobParse(userId, jobId, edited, true);

    const job = await getJob(userId, jobId);
    expect(job?.userConfirmed).toBe(true);
    expect(job?.parsed?.role_title).toBe('Growth PM (edited)');
    expect(job?.parsed?.must_haves.at(-1)?.req).toBe('Referral programs');
    expect(job?.parsedRaw?.role_title).toBe(parsed.role_title); // raw model output kept separately
  }, 120_000);
});
