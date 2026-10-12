import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listJobs } from '@/lib/db/queries/jobs';
import { NewJobForm } from './new-job-form';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

export default async function NewTailorPage() {
  const user = await requireUser();
  const jobs = await listJobs(user.id, 10);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tailor a resume</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job description. You’ll check what we understood before anything is written.
        </p>
      </div>
      <NewJobForm />
      {jobs.length > 0 && (
        <section className="flex max-w-2xl flex-col gap-2">
          <h2 className="border-b pb-2 text-sm font-semibold">Recent jobs</h2>
          {jobs.map((j) => (
            <Link
              key={j.id}
              href={`/tailor/${j.id}/confirm`}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
            >
              <span className="truncate">
                {j.roleTitle ?? 'Untitled role'}
                {j.company ? <span className="text-muted-foreground"> · {j.company}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {j.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
