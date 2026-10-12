import { cn } from '@/lib/utils';

export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const tone = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className={cn('flex items-center gap-2', className)} title={`Completeness ${score}/100`}>
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Completeness"
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{score}</span>
    </div>
  );
}
