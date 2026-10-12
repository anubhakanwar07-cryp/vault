import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { requireAdmin } from '@/lib/admin';
import { costUsd } from '@/lib/llm/pricing';
import { adminListRuns, adminRecentStandaloneCalls } from '@/lib/db/queries/admin';

// Depends on the signed-in user; navigation blocks on the server (see app/(app)/layout.tsx).
export const instant = false;

export default async function AdminRunsPage() {
  await requireAdmin();
  const [runs, calls] = await Promise.all([adminListRuns(), adminRecentStandaloneCalls()]);
  const done = runs.filter((r) => r.status === 'done');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline runs</h1>
        <p className="text-sm text-muted-foreground">
          {runs.length} recent · avg ${avg(done.map((r) => Number(r.totalCostUsd ?? 0))).toFixed(3)}{' '}
          · {(avg(done.map((r) => r.durationMs ?? 0)) / 1000).toFixed(1)} s ·{' '}
          {runs.filter((r) => r.status === 'failed').length} failed
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b">
              {['When', 'User', 'Job', 'Status', 'Stage', 'Tokens', 'Cost', 'Time'].map((h) => (
                <th key={h} className="px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/50">
                <td className="px-2 py-1.5 whitespace-nowrap">
                  <Link href={`/admin/runs/${r.id}`} className="underline-offset-4 hover:underline">
                    {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </Link>
                </td>
                <td className="px-2 py-1.5">{r.email}</td>
                <td className="px-2 py-1.5">
                  {r.roleTitle ?? '—'}
                  {r.company ? ` · ${r.company}` : ''}
                </td>
                <td className="px-2 py-1.5">
                  <Badge
                    variant={
                      r.status === 'failed'
                        ? 'destructive'
                        : r.status === 'done'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
                <td className="px-2 py-1.5">{r.stage}</td>
                <td className="px-2 py-1.5 tabular-nums">{r.totalTokens ?? '—'}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {r.totalCostUsd ? `$${Number(r.totalCostUsd).toFixed(3)}` : '—'}
                </td>
                <td className="px-2 py-1.5 tabular-nums">
                  {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Other LLM calls</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <Link
                      href={`/admin/runs/call-${c.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {c.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">{c.stage}</td>
                  <td className="px-2 py-1.5">{c.email}</td>
                  <td className="px-2 py-1.5">{c.model}</td>
                  <td className="px-2 py-1.5">
                    {c.zodValid ? '✓' : <span className="text-destructive">invalid</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{c.latencyMs} ms</td>
                  <td className="px-2 py-1.5 tabular-nums">
                    ${costUsd(c.model ?? '', c.inputTokens ?? 0, c.outputTokens ?? 0).toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
