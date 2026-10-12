import { notFound } from 'next/navigation';
import { JdEditor } from '@/components/tailor/jd-editor';
import { requireUser } from '@/lib/auth';
import { getJob, roleSpans } from '@/lib/db/queries/jobs';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

export default async function ConfirmPage({ params }: PageProps<'/tailor/[jobId]/confirm'>) {
  const { jobId } = await params;
  const user = await requireUser();
  const job = await getJob(user.id, jobId).catch(() => null);
  if (!job) notFound();
  const roles = await roleSpans(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Check what we understood</h1>
        <p className="text-sm text-muted-foreground">
          Fix anything that’s off — your edits decide which of your work gets picked and how it’s
          framed.
        </p>
      </div>
      {job.parsed ? (
        <JdEditor jobId={job.id} initial={job.parsed} roles={roles} sourceUrl={job.sourceUrl} />
      ) : (
        <p className="text-sm text-destructive">
          We couldn’t read this job description. Go back and try pasting it again.
        </p>
      )}
    </div>
  );
}
