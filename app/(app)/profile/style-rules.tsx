'use client';

import { Trash2 } from 'lucide-react';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { deleteStyleRuleAction, toggleStyleRuleAction } from './actions';

export function StyleRules({
  rules,
}: {
  rules: { id: string; rule: string; evidenceCount: number; active: boolean }[];
}) {
  const [, start] = useTransition();
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-semibold">Your writing style</h2>
        <p className="text-xs text-muted-foreground">
          Learned from your edits (every 5 edits). Active rules are applied to every new bullet.
        </p>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing learned yet — edit a few bullets in the resume editor.
        </p>
      ) : (
        rules.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={r.active}
              aria-label={r.active ? 'Turn off this rule' : 'Turn on this rule'}
              onCheckedChange={(c) =>
                start(async () => void (await toggleStyleRuleAction(r.id, c === true)))
              }
            />
            <span className={r.active ? '' : 'text-muted-foreground line-through'}>{r.rule}</span>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              seen {r.evidenceCount}×
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete rule"
              onClick={() => start(async () => void (await deleteStyleRuleAction(r.id)))}
            >
              <Trash2 />
            </Button>
          </div>
        ))
      )}
    </section>
  );
}
