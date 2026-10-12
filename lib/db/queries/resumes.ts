import 'server-only';
import { asc, desc, eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/client';
import { jobs, resumeBullets, resumes } from '@/lib/db/schema';
import { recruiterSimOutput, type RecruiterSim } from '@/lib/llm/schemas/pipeline';
import { matchReport, resumeDoc, type MatchReport, type ResumeDoc } from '@/lib/resume/types';

export type ResumeRow = Omit<
  typeof resumes.$inferSelect,
  'content' | 'matchReport' | 'recruiterSim'
> & {
  content: ResumeDoc;
  matchReport: MatchReport | null;
  recruiterSim: RecruiterSim | null;
};

export async function getResume(userId: string, resumeId: string): Promise<ResumeRow | null> {
  const [row] = await withUser(userId, (tx) =>
    tx.select().from(resumes).where(eq(resumes.id, resumeId)),
  );
  if (!row) return null;
  const report = matchReport.safeParse(row.matchReport);
  const sim = recruiterSimOutput.safeParse(row.recruiterSim);
  return {
    ...row,
    content: resumeDoc.parse(row.content),
    matchReport: report.success ? report.data : null,
    recruiterSim: sim.success ? sim.data : null,
  };
}

export async function getBullets(userId: string, resumeId: string) {
  return withUser(userId, (tx) =>
    tx
      .select()
      .from(resumeBullets)
      .where(eq(resumeBullets.resumeId, resumeId))
      .orderBy(asc(resumeBullets.position)),
  );
}

export async function listResumeVersions(userId: string, jobId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: resumes.id,
        version: resumes.version,
        status: resumes.status,
        createdAt: resumes.createdAt,
      })
      .from(resumes)
      .where(eq(resumes.jobId, jobId))
      .orderBy(desc(resumes.version)),
  );
}

/** Resume versions the user can attach to an application (newest first). */
export async function listResumesForLinking(userId: string, limit = 50) {
  return withUser(userId, (tx) =>
    tx
      .select({
        id: resumes.id,
        version: resumes.version,
        status: resumes.status,
        company: jobs.company,
        roleTitle: jobs.roleTitle,
      })
      .from(resumes)
      .innerJoin(jobs, eq(jobs.id, resumes.jobId))
      .orderBy(desc(resumes.createdAt))
      .limit(limit),
  );
}
