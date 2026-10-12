import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { requireAdmin } from '@/lib/admin';
import { adminGetCall, adminGetRun } from '@/lib/db/queries/admin';
import { costUsd } from '@/lib/llm/pricing';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Call = NonNullable<Awaited<ReturnType<typeof adminGetCall>>>;

function CallDetails({ c, t0, span }: { c: Call; t0: number; span: number }) {
  const start = c.createdAt.getTime() - (c.latencyMs ?? 0) - t0;
  return (
    <details className="rounded-lg border p-2 text-sm">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <span className="w-28 font-medium">{c.stage}</span>
        <span className="relative h-2 min-w-40 flex-1 rounded bg-muted">
          <span
            className={`absolute h-2 rounded ${c.zodValid ? 'bg-emerald-500' : 'bg-rose-500'}`}
            style={{
              left: `${(Math.max(0, start) / span) * 100}%`,
              width: `${Math.max(0.5, ((c.latencyMs ?? 0) / span) * 100)}%`,
            }}
          />
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {c.latencyMs} ms · {c.inputTokens}/{c.outputTokens} tok · $
          {costUsd(c.model ?? '', c.inputTokens ?? 0, c.outputTokens ?? 0).toFixed(4)}
          {c.retries ? ` · retry ${c.retries}` : ''}
        </span>
        {!c.zodValid && <Badge variant="destructive">invalid</Badge>}
      </summary>
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">
            Input · {c.model} · prompt {c.promptVersion}
          </p>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
            {JSON.stringify(c.input, null, 2)}
          </pre>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Output{c.error ? ` · ${c.error}` : ''}</p>
          <pre className="max-h-96 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
            {JSON.stringify(c.output, null, 2)}
          </pre>
        </div>
      </div>
    </details>
  );
}

export default async function AdminRunPage({ params }: PageProps<'/admin/runs/[id]'>) {
  await requireAdmin();
  const { id } = await params;

  if (id.startsWith('call-') && UUID.test(id.slice(5))) {
    const c = await adminGetCall(id.slice(5));
    if (!c) notFound();
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">LLM call · {c.stage}</h1>
        <CallDetails
          c={c}
          t0={c.createdAt.getTime() - (c.latencyMs ?? 0)}
          span={c.latencyMs || 1}
        />
      </div>
    );
  }
  if (!UUID.test(id)) notFound();
  const data = await adminGetRun(id);
  if (!data) notFound();
  const { run, calls } = data;
  const t0 = Math.min(
    ...calls.map((c) => c.createdAt.getTime() - (c.latencyMs ?? 0)),
    run.createdAt.getTime(),
  );
  const span = Math.max(1, ...calls.map((c) => c.createdAt.getTime() - t0));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Run · {data.roleTitle ?? 'job'}
          {data.company ? ` · ${data.company}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.email} · {run.status} ·{' '}
          {run.durationMs ? `${(run.durationMs / 1000).toFixed(1)} s` : '—'} ·{' '}
          {run.totalTokens ?? 0} tokens · ${Number(run.totalCostUsd ?? 0).toFixed(4)} ·{' '}
          {calls.length} LLM calls
        </p>
        {run.error && <p className="text-sm text-destructive">{run.error}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        {calls.map((c) => (
          <CallDetails key={c.id} c={c} t0={t0} span={span} />
        ))}
      </div>
    </div>
  );
}
