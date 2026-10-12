import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getJob } from '@/lib/db/queries/jobs';
import { RunProgress } from './run-progress';

export default async function RunPage({ params }: PageProps<'/tailor/[jobId]/run'>) {
  const { jobId } = await params;
  const user = await requireUser();
  const job = await getJob(user.id, jobId).catch(() => null);
  if (!job) notFound();
  if (!job.userConfirmed) redirect(`/tailor/${jobId}/confirm`);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Tailoring for {job.roleTitle ?? 'this role'}
          {job.company ? ` at ${job.company}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          Every line will trace back to something in your vault.
        </p>
      </div>
      <RunProgress jobId={jobId} />
    </div>
  );
}
