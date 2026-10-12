import { notFound } from 'next/navigation';
import { ResumeEditor, type SourceSummary } from '@/components/resume/resume-editor';
import { requireUser } from '@/lib/auth';
import { getJob } from '@/lib/db/queries/jobs';
import { getResume, listResumeVersions } from '@/lib/db/queries/resumes';
import { allWarnings, sourcesFor } from '@/lib/resume/editor';

export default async function ResumePage({
  params,
}: PageProps<'/tailor/[jobId]/resume/[resumeId]'>) {
  const { jobId, resumeId } = await params;
  const user = await requireUser();
  const resume = await getResume(user.id, resumeId).catch(() => null);
  if (!resume || resume.jobId !== jobId || !resume.matchReport) notFound();

  const [job, versions, sources, warnings] = await Promise.all([
    getJob(user.id, jobId),
    listResumeVersions(user.id, jobId),
    sourcesFor(user.id, resumeId),
    allWarnings(user.id, resumeId),
  ]);

  const summaries: Record<string, SourceSummary> = Object.fromEntries(
    Object.entries(sources).map(([bulletId, r]) => [
      bulletId,
      {
        achievementId: r.id,
        action: r.action,
        result: r.result,
        metricValue: r.metricValue,
        metricConfidence: r.metricConfidence,
        tools: r.tools,
        where: r.role
          ? `${r.role.title}, ${r.role.company} · ${r.project?.name ?? ''}`
          : (r.project?.name ?? 'Side project'),
      },
    ]),
  );

  return (
    <ResumeEditor
      key={resumeId}
      jobId={jobId}
      resumeId={resumeId}
      status={resume.status}
      version={resume.version}
      versions={versions}
      doc={resume.content}
      report={resume.matchReport}
      sim={resume.recruiterSim}
      sources={summaries}
      warnings={warnings}
      title={`${job?.roleTitle ?? 'Resume'}${job?.company ? ` · ${job.company}` : ''}`}
    />
  );
}
