'use client';

import { Check, Circle, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import type { ProgressEvent, StageName } from '@/lib/pipeline/types';
import { cn } from '@/lib/utils';

const STEPS: { stage: StageName; label: string }[] = [
  { stage: 'score_projects', label: 'Choosing your most relevant projects…' },
  { stage: 'score', label: 'Weighing your evidence against each requirement…' },
  { stage: 'rewrite', label: 'Writing bullets…' },
  { stage: 'verify', label: 'Fact-checking every line against your vault…' },
  { stage: 'assemble', label: 'Laying out your page…' },
  { stage: 'recruiter_sim', label: 'Reading it like a recruiter…' },
];

type Status = 'pending' | 'active' | 'done' | 'error';

export function RunProgress({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [detail, setDetail] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    // Opened once per page view. Deliberately not closed on effect cleanup: React's dev double-mount
    // would otherwise kill the stream; it closes itself when the run finishes.
    if (opened.current) return;
    opened.current = true;
    const es = new EventSource(`/api/tailor/${jobId}/stream`);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ProgressEvent;
      if (e.stage === 'done') {
        es.close();
        if (e.status === 'error') setError(e.message);
        else if (e.resumeId) router.replace(`/tailor/${jobId}/resume/${e.resumeId}`);
        return;
      }
      const key = e.stage === 'select' ? 'score' : e.stage;
      setStatus((s) => ({
        ...s,
        [key]: e.status === 'start' ? 'active' : e.status === 'error' ? 'error' : 'done',
      }));
      if (e.status !== 'start') setDetail((d) => ({ ...d, [key]: e.message }));
    };
    // EventSource reconnects by itself; the server then attaches to the run already in progress.
    // Give up only after a few failed reconnects.
    let reconnects = 0;
    es.onopen = () => {
      reconnects = 0;
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING && ++reconnects <= 3) return;
      es.close();
      setError(
        (cur) =>
          cur ??
          'Lost connection to the server. Refresh — if your resume finished, you’ll be taken to it.',
      );
    };
  }, [jobId, router]);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <ol className="flex flex-col gap-3">
        {STEPS.map(({ stage, label }) => {
          const s = status[stage] ?? 'pending';
          const Icon = s === 'done' ? Check : s === 'active' ? Loader2 : s === 'error' ? X : Circle;
          return (
            <li key={stage} className="flex items-start gap-3 text-sm">
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  s === 'active' && 'animate-spin',
                  s === 'done' && 'text-emerald-600',
                  s === 'pending' && 'text-muted-foreground/40',
                  s === 'error' && 'text-amber-600',
                )}
              />
              <div>
                <p className={cn(s === 'pending' && 'text-muted-foreground')}>{label}</p>
                {detail[stage] && <p className="text-xs text-muted-foreground">{detail[stage]}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm">
          <p role="alert">{error}</p>
          <Link
            href={`/tailor/${jobId}/confirm`}
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            Back to the job
          </Link>
        </div>
      )}
      {!error && (
        <p className="text-xs text-muted-foreground">Usually 30–50 seconds. Keep this tab open.</p>
      )}
    </div>
  );
}
