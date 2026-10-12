import { ApplicationsView } from '@/components/tracker/applications-view';
import { requireUser } from '@/lib/auth';
import { listApplications, prefillFromResume } from '@/lib/db/queries/applications';
import { listResumesForLinking } from '@/lib/db/queries/resumes';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

export default async function ApplicationsPage({ searchParams }: PageProps<'/applications'>) {
  const sp = await searchParams;
  const user = await requireUser();
  const logId = typeof sp.log === 'string' && /^[0-9a-f-]{36}$/i.test(sp.log) ? sp.log : null;
  const [apps, resumes, prefill] = await Promise.all([
    listApplications(user.id),
    listResumesForLinking(user.id),
    logId ? prefillFromResume(user.id, logId) : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="text-sm text-muted-foreground">
          Every application, with the exact resume version you sent.
        </p>
      </div>
      <ApplicationsView
        apps={apps}
        resumes={resumes}
        prefill={
          prefill
            ? {
                resumeId: prefill.resumeId,
                company: prefill.company,
                roleTitle: prefill.roleTitle,
                roleFamily: prefill.roleFamily,
              }
            : null
        }
      />
    </div>
  );
}
