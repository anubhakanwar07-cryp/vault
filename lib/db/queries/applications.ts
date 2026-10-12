import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { applications, jobs, resumes } from '@/lib/db/schema';
import { parsedJD } from '@/lib/llm/schemas/jd';
import { withStatusChange, type ApplicationStatus } from '@/lib/tracker/stats';

export type ApplicationRow = {
  id: string;
  jobId: string | null;
  resumeId: string | null;
  company: string | null;
  roleTitle: string | null;
  resumeVersion: number | null;
  isTailored: boolean;
  roleFamily: string | null;
  appliedAt: string | null;
  channel: 'portal' | 'referral' | 'cold-email' | 'linkedin' | null;
  status: ApplicationStatus;
  statusHistory: { status: string; at: string }[];
  notes: string | null;
};

export async function listApplications(userId: string): Promise<ApplicationRow[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        a: applications,
        company: jobs.company,
        roleTitle: jobs.roleTitle,
        version: resumes.version,
      })
      .from(applications)
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(resumes, eq(resumes.id, applications.resumeId))
      .orderBy(desc(applications.appliedAt), desc(applications.createdAt)),
  );
  return rows.map(({ a, company, roleTitle, version }) => ({
    id: a.id,
    jobId: a.jobId,
    resumeId: a.resumeId,
    company,
    roleTitle,
    resumeVersion: version,
    isTailored: a.isTailored,
    roleFamily: a.roleFamily,
    appliedAt: a.appliedAt,
    channel: a.channel,
    status: a.status,
    statusHistory: a.statusHistory,
    notes: a.notes,
  }));
}

/** Prefill for "Log application" from the editor: the resume's job, company, role and family. */
export async function prefillFromResume(userId: string, resumeId: string) {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({
        resumeId: resumes.id,
        version: resumes.version,
        jobId: jobs.id,
        company: jobs.company,
        roleTitle: jobs.roleTitle,
        parsed: jobs.parsed,
      })
      .from(resumes)
      .innerJoin(jobs, eq(jobs.id, resumes.jobId))
      .where(eq(resumes.id, resumeId)),
  );
  if (!row) return null;
  const p = parsedJD.safeParse(row.parsed);
  return { ...row, parsed: undefined, roleFamily: p.success ? p.data.role_family : null };
}

export type NewApplication = {
  resumeId: string | null;
  company: string;
  roleTitle: string;
  roleFamily: string | null;
  isTailored: boolean;
  appliedAt: string | null;
  channel: ApplicationRow['channel'];
  status: ApplicationStatus;
  notes: string | null;
};

/**
 * Logs an application. Tailored ones link to the exact resume version (and its job); baseline ones
 * get a minimal job record so company/role live in one place.
 */
export async function createApplication(userId: string, a: NewApplication): Promise<string> {
  return withUser(userId, async (tx) => {
    let jobId: string | null = null;
    let roleFamily = a.roleFamily;
    if (a.resumeId) {
      const [r] = await tx
        .select({ jobId: resumes.jobId })
        .from(resumes)
        .where(eq(resumes.id, a.resumeId));
      if (!r) throw new Error('Resume not found');
      jobId = r.jobId;
      if (jobId && !roleFamily) {
        const [j] = await tx.select({ parsed: jobs.parsed }).from(jobs).where(eq(jobs.id, jobId));
        const p = parsedJD.safeParse(j?.parsed);
        roleFamily = p.success ? p.data.role_family : null;
      }
    } else {
      const [j] = await tx
        .insert(jobs)
        .values({ userId, company: a.company, roleTitle: a.roleTitle, jdText: '' })
        .returning({ id: jobs.id });
      jobId = j!.id;
    }
    const [row] = await tx
      .insert(applications)
      .values({
        userId,
        jobId,
        resumeId: a.resumeId,
        isTailored: a.isTailored,
        roleFamily,
        appliedAt: a.appliedAt,
        channel: a.channel,
        status: a.status,
        statusHistory: [{ status: a.status, at: new Date().toISOString() }],
        notes: a.notes,
      })
      .returning({ id: applications.id });
    return row!.id;
  });
}

export async function updateApplicationStatus(
  userId: string,
  id: string,
  status: ApplicationStatus,
) {
  await withUser(userId, async (tx) => {
    const [a] = await tx
      .select({ status: applications.status, statusHistory: applications.statusHistory })
      .from(applications)
      .where(eq(applications.id, id));
    if (!a) throw new Error('Application not found');
    const next = withStatusChange(a, status);
    if (next === a) return;
    await tx
      .update(applications)
      .set({ status: next.status as ApplicationStatus, statusHistory: next.statusHistory })
      .where(eq(applications.id, id));
  });
}

export async function updateApplicationNotes(userId: string, id: string, notes: string | null) {
  await withUser(userId, (tx) =>
    tx.update(applications).set({ notes }).where(eq(applications.id, id)),
  );
}

export async function deleteApplication(userId: string, id: string) {
  await withUser(userId, (tx) => tx.delete(applications).where(eq(applications.id, id)));
}
