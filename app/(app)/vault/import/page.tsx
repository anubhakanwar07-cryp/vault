import { FileText, Globe, PenLine } from 'lucide-react';
import { requireUser } from '@/lib/auth';
import { listVaultSources } from '@/lib/db/queries/vault';
import { ImportFlow } from './import-flow';

const ICONS = { resume: FileText, portfolio: Globe, brief: PenLine } as const;

export default async function ImportPage() {
  const user = await requireUser();
  const sources = await listVaultSources(user.id);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add to your vault</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          A resume rarely shows everything you’ve done. Add your resume, your portfolio site, or
          just write about your work — each one fills in more of your vault, so tailored resumes
          have more to choose from. We only keep what’s actually written; anything that isn’t in
          your source is removed.
        </p>
      </div>
      <ImportFlow />
      {sources.length > 0 && (
        <section className="flex max-w-xl flex-col gap-2">
          <h2 className="border-b pb-2 text-sm font-semibold">Added so far</h2>
          {sources.map((s) => {
            const Icon = ICONS[s.kind];
            return (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  {s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-4 hover:underline"
                    >
                      {s.title || s.url}
                    </a>
                  ) : (
                    s.title || s.kind
                  )}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {s.createdAt.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
