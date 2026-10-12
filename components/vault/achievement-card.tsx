import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import type { AchievementCard as Card } from '@/lib/db/queries/vault';
import { ScoreBar } from './score-bar';

export function AchievementCard({ a }: { a: Card }) {
  const firstLine = a.action.split('\n')[0];
  const tags = [...a.functionTags, ...a.skills, ...a.tools].slice(0, 5);
  return (
    <Link
      href={`/vault/achievement/${a.id}`}
      className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2">{firstLine}</p>
        {a.metricValue && a.metricConfidence !== 'none' && (
          <Badge variant="outline" className="shrink-0">
            {a.metricConfidence === 'estimate' ? '~' : ''}
            {a.metricValue}
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ScoreBar score={a.completenessScore} />
        {tags.map((t) => (
          <span key={t} className="text-xs text-muted-foreground">
            #{t}
          </span>
        ))}
        {!a.hasEmbedding && <span className="text-xs text-amber-600">not indexed</span>}
      </div>
    </Link>
  );
}
