import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { jobs, roles } from '@/lib/db/schema';
import { parsedJD, type ParsedJD } from '@/lib/llm/schemas/jd';

export type Job = Omit<typeof jobs.$inferSelect, 'parsed' | 'parsedRaw'> & {
  parsed: ParsedJD | null;
  parsedRaw: ParsedJD | null;
};

const asParsed = (v: unknown): ParsedJD | null => {
  const r = parsedJD.safeParse(v);
  return r.success ? r.data : null;
};

export async function createJob(
  userId: string,
  data: { jdText: string; sourceUrl?: string | null },
): Promise<string> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .insert(jobs)
      .values({ userId, jdText: data.jdText, sourceUrl: data.sourceUrl ?? null })
      .returning({ id: jobs.id }),
  );
  return row!.id;
}

/** Stores the model's parse as both the raw record and the editable copy. */
export async function setJobParse(userId: string, jobId: string, parsed: ParsedJD) {
  await withUser(userId, (tx) =>
    tx
      .update(jobs)
      .set({ parsedRaw: parsed, parsed, company: parsed.company, roleTitle: parsed.role_title })
      .where(eq(jobs.id, jobId)),
  );
}

export async function saveJobParse(
  userId: string,
  jobId: string,
  parsed: ParsedJD,
  confirm: boolean,
) {
  await withUser(userId, (tx) =>
    tx
      .update(jobs)
      .set({
        parsed,
        company: parsed.company,
        roleTitle: parsed.role_title,
        ...(confirm ? { userConfirmed: true } : {}),
      })
      .where(eq(jobs.id, jobId)),
  );
}

export async function getJob(userId: string, jobId: string): Promise<Job | null> {
  const [row] = await withUser(userId, (tx) => tx.select().from(jobs).where(eq(jobs.id, jobId)));
  return row ? { ...row, parsed: asParsed(row.parsed), parsedRaw: asParsed(row.parsedRaw) } : null;
}

export async function listJobs(userId: string, limit = 20) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: jobs.id,
        company: jobs.company,
        roleTitle: jobs.roleTitle,
        userConfirmed: jobs.userConfirmed,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .orderBy(desc(jobs.createdAt))
      .limit(limit),
  );
}

export async function roleSpans(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        startDate: roles.startDate,
        endDate: roles.endDate,
        employmentType: roles.employmentType,
      })
      .from(roles),
  );
}
