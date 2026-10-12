'use client';

import { ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import type { ImportFlag } from '@/lib/import/source-check';
import type { ChatMessage, ProposedAchievement } from '@/lib/llm/schemas/interviewer';
import { cn } from '@/lib/utils';
import { acceptProposalsAction, interviewTurnAction } from '../actions';

export type ExistingSummary = {
  id: string;
  situation: string | null;
  action: string;
  result: string | null;
  metricValue: string | null;
  metricConfidence: string;
};

const FIELDS: { key: keyof ProposedAchievement; label: string; existing: keyof ExistingSummary }[] =
  [
    { key: 'situation', label: 'Situation', existing: 'situation' },
    { key: 'action', label: 'Action', existing: 'action' },
    { key: 'result', label: 'Result', existing: 'result' },
    { key: 'metric_value', label: 'Metric', existing: 'metricValue' },
    { key: 'metric_confidence', label: 'Confidence', existing: 'metricConfidence' },
  ];

export function InterviewChat({
  projectId,
  existing,
}: {
  projectId: string;
  existing: ExistingSummary[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [proposals, setProposals] = useState<ProposedAchievement[] | null>(null);
  const [flags, setFlags] = useState<ImportFlag[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const [saving, startSaving] = useTransition();
  const started = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const turn = (next: ChatMessage[], finish: boolean) =>
    startThinking(async () => {
      setError(null);
      const res = await interviewTurnAction(projectId, next, finish);
      if (!res.ok) return setError(res.error);
      if (res.data.done) {
        setProposals(res.data.proposals);
        setFlags(res.data.flags);
        setAccepted(new Set(res.data.proposals.map((_, i) => i)));
      } else {
        setMessages([...next, { role: 'assistant', content: res.data.question }]);
      }
    });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    turn([], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages, thinking]);

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || thinking) return;
    const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setDraft('');
    turn(next, /^done\.?$/i.test(text));
  };

  const answered = messages.filter((m) => m.role === 'user').length;

  if (proposals) {
    const byId = new Map(existing.map((a) => [a.id, a]));
    const save = () =>
      startSaving(async () => {
        const res = await acceptProposalsAction(
          projectId,
          proposals.filter((_, i) => accepted.has(i)),
        );
        if (!res.ok) return void toast.error(res.error);
        if (res.warning) toast.warning(res.warning);
        toast.success(`Saved ${res.data.saved} achievement${res.data.saved === 1 ? '' : 's'}.`);
        router.push('/vault');
      });

    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Here’s what I’d add or change. Accept the ones that are right.
        </p>
        {flags.length > 0 && (
          <ul className="list-disc rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 pl-8 text-sm">
            {flags.map((f) => (
              <li key={f.path + f.message}>{f.message.replace('your resume', 'your answers')}</li>
            ))}
          </ul>
        )}
        {proposals.map((p, i) => {
          const old = p.existing_id ? byId.get(p.existing_id) : undefined;
          const on = accepted.has(i);
          return (
            <div
              key={i}
              className={cn('flex gap-3 rounded-lg border p-3 text-sm', !on && 'opacity-50')}
            >
              <Checkbox
                className="mt-1"
                checked={on}
                aria-label="Accept this change"
                onCheckedChange={() =>
                  setAccepted((s) => {
                    const n = new Set(s);
                    if (n.has(i)) n.delete(i);
                    else n.add(i);
                    return n;
                  })
                }
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Badge variant={old ? 'outline' : 'default'}>{old ? 'Update' : 'New'}</Badge>
                {FIELDS.map(({ key, label, existing: ek }) => {
                  const next = (p[key] as string | null) ?? '';
                  const prev = old ? ((old[ek] as string | null) ?? '') : '';
                  if (!next && !prev) return null;
                  const changed = old && next !== prev;
                  return (
                    <div key={key} className="grid gap-1 sm:grid-cols-[6rem_1fr]">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <div className="flex flex-col gap-0.5">
                        {changed && prev && (
                          <span className="text-rose-600 line-through dark:text-rose-400">
                            {prev}
                          </span>
                        )}
                        <span className={cn(changed && 'text-emerald-700 dark:text-emerald-400')}>
                          {next || '—'}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {[...p.skills, ...p.tools].length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {[...p.skills, ...p.tools].map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || accepted.size === 0}>
            {saving ? 'Saving…' : `Save ${accepted.size} to vault`}
          </Button>
          <Button variant="ghost" onClick={() => setProposals(null)}>
            Back to chat
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap',
              m.role === 'assistant'
                ? 'self-start bg-muted'
                : 'self-end bg-primary text-primary-foreground',
            )}
          >
            {m.content}
          </div>
        ))}
        {thinking && (
          <div className="self-start rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            …
          </div>
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}{' '}
          <button className="underline" onClick={() => turn(messages, false)}>
            Retry
          </button>
        </p>
      )}
      <form onSubmit={send} className="flex flex-col gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          rows={3}
          placeholder="Your answer (Enter to send, Shift+Enter for a new line)"
          disabled={thinking || messages.length === 0}
          aria-label="Your answer"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={thinking || !draft.trim()}>
            Send <ArrowRight />
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={thinking || answered === 0}
            onClick={() => turn(messages, true)}
          >
            Done — show me the results
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {answered} answered · usually 6–8 questions
          </span>
        </div>
      </form>
    </div>
  );
}
