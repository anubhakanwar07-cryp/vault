import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { MIN_N_TO_COMPARE, type CallbackStats, type GroupStat } from '@/lib/tracker/stats';

const pct = (g: GroupStat) => (g.rate === null ? '—' : `${Math.round(g.rate * 100)}%`);

function Cell({ g }: { g: GroupStat }) {
  return (
    <div className="flex flex-col">
      <span className="text-xl font-semibold tabular-nums">{pct(g)}</span>
      <span className="text-xs text-muted-foreground">
        {g.callbacks}/{g.n} sent{!g.enough && g.n > 0 ? ' · too few to compare' : ''}
      </span>
    </div>
  );
}

/** SPEC §12 dashboard widget: callback rate, tailored vs baseline, overall and by role family. */
export function CallbackWidget({ stats }: { stats: CallbackStats }) {
  const total = stats.tailored.n + stats.baseline.n;
  return (
    <section className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Callback rate</h2>
        <Link href="/applications" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          Applications
        </Link>
      </div>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Log applications (and a few sent with your usual resume) to see whether tailoring gets you
          more callbacks.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Tailored</p>
              <Cell g={stats.tailored} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Baseline</p>
              <Cell g={stats.baseline} />
            </div>
          </div>
          {stats.byFamily.length > 1 && (
            <table className="text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Role family</th>
                  <th className="py-1 font-medium">Tailored</th>
                  <th className="py-1 font-medium">Baseline</th>
                </tr>
              </thead>
              <tbody>
                {stats.byFamily.map((f) => (
                  <tr key={f.family}>
                    <td className="py-1">{f.family}</td>
                    <td className="py-1 tabular-nums">
                      {pct(f.tailored)}{' '}
                      <span className="text-xs text-muted-foreground">(N={f.tailored.n})</span>
                    </td>
                    <td className="py-1 tabular-nums">
                      {pct(f.baseline)}{' '}
                      <span className="text-xs text-muted-foreground">(N={f.baseline.n})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-muted-foreground">
            Callback = reached callback, interview or offer at any point. Groups under{' '}
            {MIN_N_TO_COMPARE} applications are too small to compare fairly.
          </p>
        </>
      )}
    </section>
  );
}
