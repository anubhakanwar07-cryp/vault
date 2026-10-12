import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { CallbackWidget } from '@/components/tracker/callback-widget';
import { buttonVariants } from '@/components/ui/button';
import { ScoreBar } from '@/components/vault/score-bar';
import { requireUser } from '@/lib/auth';
import { listApplications } from '@/lib/db/queries/applications';
import { getProfile, getVaultTree } from '@/lib/db/queries/vault';
import { callbackStats } from '@/lib/tracker/stats';
import { average, DEEPEN_THRESHOLD } from '@/lib/vault/completeness';

export default async function DashboardPage() {
  const user = await requireUser();
  const [tree, profile, apps] = await Promise.all([
    getVaultTree(user.id),
    getProfile(user.id),
    listApplications(user.id),
  ]);

  const projects = [
    ...tree.roles.flatMap((r) =>
      r.projects.map((p) => ({ ...p, where: `${r.title}, ${r.company}` })),
    ),
    ...tree.sideProjects.map((p) => ({ ...p, where: 'Side project' })),
  ];
  const scores = projects.flatMap((p) => p.achievements.map((a) => a.completenessScore));
  const vaultAvg = average(scores);
  const toDeepen = projects
    .map((p) => ({ ...p, avg: average(p.achievements.map((a) => a.completenessScore)) }))
    .filter((p) => p.avg === null || p.avg < DEEPEN_THRESHOLD)
    .slice(0, 5);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile?.fullName ? `Hi, ${profile.fullName.split(' ')[0]}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-muted-foreground">Signed in as {user.email}.</p>
      </div>

      {!profile && (
        <div className="flex flex-col items-start gap-2 rounded-xl border p-4">
          <p className="text-sm">
            Add your name and contact details — they go in every resume header.
          </p>
          <Link href="/profile" className={buttonVariants({ size: 'sm' })}>
            Set up profile
          </Link>
        </div>
      )}

      <section className="flex flex-col items-start gap-2 rounded-xl border p-4">
        <h2 className="font-semibold">Tailor a resume</h2>
        <p className="text-sm text-muted-foreground">
          Paste a job description and get a one-page resume built from your vault.
        </p>
        <Link href="/tailor/new" className={buttonVariants({ size: 'sm' })}>
          New tailored resume
        </Link>
      </section>

      <CallbackWidget stats={callbackStats(apps)} />

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Career vault</h2>
          <Link href="/vault" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            Open vault
          </Link>
        </div>
        {vaultAvg === null ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-muted-foreground">No achievements yet.</p>
            <Link href="/vault/import" className={buttonVariants({ size: 'sm' })}>
              Import your current resume
            </Link>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 text-sm">
              Average completeness <ScoreBar score={vaultAvg} />
              <span className="text-muted-foreground">
                across {scores.length} achievement{scores.length === 1 ? '' : 's'}
              </span>
            </div>
            {toDeepen.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  These projects are thin. A few minutes with the AI interviewer makes them much
                  more useful:
                </p>
                {toDeepen.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      {p.name} <span className="text-muted-foreground">· {p.where}</span>
                    </span>
                    <Link
                      href={`/vault/interview/${p.id}`}
                      className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                    >
                      <Sparkles /> Deepen
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
