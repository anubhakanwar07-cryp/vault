import { notFound } from 'next/navigation';
import { RESUME_CSS, ResumeTemplate } from '@/lib/export/template';
import { requireUser } from '@/lib/auth';
import { getResume } from '@/lib/db/queries/resumes';

// Phase 4 view: preview + match summary. Phase 5 turns this into the full editor.
export default async function ResumePage({
  params,
}: PageProps<'/tailor/[jobId]/resume/[resumeId]'>) {
  const { resumeId } = await params;
  const user = await requireUser();
  const resume = await getResume(user.id, resumeId).catch(() => null);
  if (!resume) notFound();
  const r = resume.matchReport;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <style>{RESUME_CSS}</style>
      <div className="overflow-x-auto rounded-lg border bg-white shadow-sm lg:w-[60%]">
        <ResumeTemplate doc={resume.content} />
      </div>
      <aside className="flex flex-col gap-4 text-sm lg:w-[40%]">
        {r && (
          <section className="flex flex-col gap-2">
            <h2 className="font-semibold">Match: {r.coveragePercent}% of must-haves covered</h2>
            {r.mustHaveCoverage.map((m) => (
              <p key={m.reqId} className="flex gap-2">
                <span
                  className={
                    m.bestScore >= 2
                      ? 'text-emerald-600'
                      : m.bestScore === 1
                        ? 'text-amber-600'
                        : 'text-rose-600'
                  }
                >
                  ●
                </span>
                {m.req}
              </p>
            ))}
            {r.gaps.map((g) => (
              <p key={g.reqId} className="text-muted-foreground">
                {g.suggestion}
              </p>
            ))}
          </section>
        )}
        {resume.recruiterSim && (
          <section className="flex flex-col gap-1">
            <h2 className="font-semibold">Recruiter view: {resume.recruiterSim.score}/10</h2>
            <p className="text-muted-foreground">{resume.recruiterSim.ten_second_impression}</p>
          </section>
        )}
      </aside>
    </div>
  );
}
