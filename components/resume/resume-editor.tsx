'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  FileSearch,
  Loader2,
  RefreshCw,
  Replace,
  Sparkles,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  alternativesAction,
  deleteBulletAction,
  editBulletAction,
  improveWeakestAction,
  markFinalAction,
  moveBulletAction,
  regenerateBulletAction,
  swapBulletAction,
} from '@/app/(app)/tailor/[jobId]/resume/[resumeId]/actions';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ActionResult } from '@/lib/actions';
import { RESUME_CSS, ResumeTemplate } from '@/lib/export/template';
import type { RecruiterSim } from '@/lib/llm/schemas/pipeline';
import { estimateLines, LINES_PER_PAGE } from '@/lib/resume/doc-ops';
import type { Alternative, EditResult } from '@/lib/resume/editor';
import type { MatchReport, ResumeDoc } from '@/lib/resume/types';
import { cn } from '@/lib/utils';

export type SourceSummary = {
  achievementId: string;
  action: string;
  result: string | null;
  metricValue: string | null;
  metricConfidence: string;
  tools: string[];
  where: string;
};

type Props = {
  jobId: string;
  resumeId: string;
  status: 'draft' | 'final';
  version: number;
  versions: { id: string; version: number; status: string }[];
  doc: ResumeDoc;
  report: MatchReport;
  sim: RecruiterSim | null;
  sources: Record<string, SourceSummary>;
  warnings: Record<string, string[]>;
  title: string;
};

type Tab = 'match' | 'recruiter' | 'vault';

export function ResumeEditor(props: Props) {
  const router = useRouter();
  const [doc, setDoc] = useState(props.doc);
  const [report, setReport] = useState(props.report);
  const [status, setStatus] = useState(props.status);
  const [warnings, setWarnings] = useState(props.warnings);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('match');
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<Alternative[] | null>(null);
  const [sourceFor, setSourceFor] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const lines = estimateLines(doc);
  const overflow = lines > LINES_PER_PAGE;

  /** Applies an edit result; navigates if the edit forked a new draft version from a final one. */
  const apply = (res: ActionResult<EditResult>, label?: string) => {
    if (!res.ok) return void toast.error(res.error);
    const r = res.data;
    if (r.resumeId !== props.resumeId) {
      toast.info('This version was final, so your edit started a new draft version.');
      router.replace(`/tailor/${props.jobId}/resume/${r.resumeId}`);
      return;
    }
    setDoc(r.doc);
    setReport(r.report);
    setStatus('draft');
    if (r.bulletId && r.warnings) setWarnings((w) => ({ ...w, [r.bulletId!]: r.warnings! }));
    if (label) toast.success(label);
  };

  const act = (
    bulletId: string | null,
    fn: () => Promise<ActionResult<EditResult>>,
    label?: string,
  ) =>
    startTransition(async () => {
      setBusy(bulletId ?? 'page');
      try {
        apply(await fn(), label);
      } finally {
        setBusy(null);
      }
    });

  const openSwap = (bulletId: string) =>
    startTransition(async () => {
      setSwapFor(bulletId);
      setAlternatives(null);
      const res = await alternativesAction(props.resumeId, bulletId);
      if (!res.ok) {
        toast.error(res.error);
        setSwapFor(null);
      } else setAlternatives(res.data);
    });

  const renderBullet = (b: { bulletId: string; text: string }): ReactNode => (
    <EditableBullet
      key={b.bulletId}
      text={b.text}
      busy={busy === b.bulletId}
      editing={editing === b.bulletId}
      warnings={warnings[b.bulletId] ?? []}
      fallback={report.fallbackBullets.includes(b.bulletId)}
      onStartEdit={() => setEditing(b.bulletId)}
      onCommit={(text) => {
        setEditing(null);
        if (text.trim() !== b.text)
          act(b.bulletId, () => editBulletAction(props.resumeId, b.bulletId, text));
      }}
      onCancel={() => setEditing(null)}
      onRegenerate={() =>
        act(
          b.bulletId,
          () => regenerateBulletAction(props.resumeId, b.bulletId),
          'Rewritten and fact-checked',
        )
      }
      onSwap={() => openSwap(b.bulletId)}
      onDelete={() => act(b.bulletId, () => deleteBulletAction(props.resumeId, b.bulletId))}
      onSource={() => setSourceFor(b.bulletId)}
      onMove={(dir) => act(b.bulletId, () => moveBulletAction(props.resumeId, b.bulletId, dir))}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <style>{RESUME_CSS}</style>
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto truncate text-lg font-semibold tracking-tight">{props.title}</h1>
        <select
          aria-label="Version"
          value={props.resumeId}
          onChange={(e) => router.push(`/tailor/${props.jobId}/resume/${e.target.value}`)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
        >
          {props.versions.map((v) => (
            <option key={v.id} value={v.id}>
              v{v.version} · {v.status}
            </option>
          ))}
        </select>
        <Badge variant={status === 'final' ? 'default' : 'outline'}>
          {status === 'final' ? 'Final' : 'Draft'}
        </Badge>
        {status === 'draft' && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              startTransition(async () => {
                const res = await markFinalAction(props.resumeId, props.jobId);
                if (res.ok) {
                  setStatus('final');
                  toast.success('Marked as final. Further edits start a new version.');
                } else toast.error(res.error);
              })
            }
          >
            Mark as final
          </Button>
        )}
        <a
          href={`/api/export/${props.resumeId}?format=pdf`}
          className={buttonVariants({ size: 'sm' })}
          onClick={() => setStatus('final')}
        >
          <Download /> PDF
        </a>
        <a
          href={`/api/export/${props.resumeId}?format=docx`}
          className={buttonVariants({ size: 'sm', variant: 'outline' })}
          onClick={() => setStatus('final')}
        >
          <Download /> DOCX
        </a>
        <Link
          href={`/applications?log=${props.resumeId}`}
          className={buttonVariants({ size: 'sm', variant: 'ghost' })}
        >
          Log application
        </Link>
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        {/* Preview — 60% */}
        <div className="flex flex-col gap-2 xl:w-[60%]">
          <div
            className={cn(
              'flex items-center gap-2 text-xs',
              overflow ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
            )}
          >
            {overflow && <AlertTriangle className="size-3.5" />}≈ {lines} / {LINES_PER_PAGE} lines
            {overflow
              ? ' — likely spills onto a second page. Delete or shorten a bullet.'
              : ' — fits on one page'}
            {busy === 'page' && <Loader2 className="size-3.5 animate-spin" />}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-white text-black shadow-sm">
            <ResumeTemplate doc={doc} renderBullet={renderBullet} />
          </div>
          <p className="text-xs text-muted-foreground">
            Click a bullet to edit it. Hover for more actions.
          </p>
        </div>

        {/* Side panel — 40% */}
        <aside className="flex flex-col gap-4 xl:w-[40%]">
          <div role="tablist" className="flex gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ['match', 'Match report'],
                ['recruiter', 'Recruiter view'],
                ['vault', 'Vault'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm',
                  tab === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'match' && (
            <MatchPanel
              report={report}
              onFocus={(id) =>
                document
                  .querySelector(`[data-bullet-id="${id}"]`)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            />
          )}
          {tab === 'recruiter' && (
            <RecruiterPanel
              sim={props.sim}
              busy={busy !== null}
              onImprove={() =>
                act(
                  null,
                  () => improveWeakestAction(props.resumeId),
                  'Weakest line rewritten and fact-checked',
                )
              }
            />
          )}
          {tab === 'vault' && <VaultPanel sources={props.sources} doc={doc} />}
        </aside>
      </div>

      <Dialog open={swapFor !== null} onOpenChange={(o) => !o && setSwapFor(null)}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Swap for another achievement</DialogTitle>
          </DialogHeader>
          {!alternatives ? (
            <p className="text-sm text-muted-foreground">Finding alternatives…</p>
          ) : alternatives.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No other achievements in your vault prove these requirements.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                Ranked by how strongly each proves what this bullet covers.
              </p>
              {alternatives.map((a) => (
                <button
                  key={a.achievementId}
                  className="flex flex-col gap-0.5 rounded-lg border p-2 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    const target = swapFor!;
                    setSwapFor(null);
                    act(
                      target,
                      () => swapBulletAction(props.resumeId, target, a.achievementId),
                      'Swapped and fact-checked',
                    );
                  }}
                >
                  <span className="line-clamp-2">{a.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.where} · score {a.score}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={sourceFor !== null} onOpenChange={(o) => !o && setSourceFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Source in your vault</DialogTitle>
          </DialogHeader>
          {sourceFor && props.sources[sourceFor] ? (
            <SourceCard s={props.sources[sourceFor]!} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This bullet was swapped in during this session — reload to see its source.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditableBullet(p: {
  text: string;
  busy: boolean;
  editing: boolean;
  warnings: string[];
  fallback: boolean;
  onStartEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onSwap: () => void;
  onDelete: () => void;
  onSource: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (p.editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [p.editing]);

  if (p.editing) {
    return (
      <textarea
        ref={ref}
        defaultValue={p.text}
        aria-label="Edit bullet"
        className="w-full resize-none rounded border border-blue-400 bg-blue-50/50 p-0.5 font-[inherit] text-[inherit] leading-[inherit] outline-none"
        onInput={(e) => {
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
        }}
        onBlur={(e) => p.onCommit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') p.onCancel();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  const tool = (label: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
    >
      {icon}
    </button>
  );

  return (
    <span className="group/bullet relative inline">
      <span
        role="button"
        tabIndex={0}
        onClick={p.onStartEdit}
        onKeyDown={(e) => e.key === 'Enter' && p.onStartEdit()}
        className={cn(
          'cursor-text rounded-sm hover:bg-yellow-50',
          p.busy && 'animate-pulse text-neutral-400',
          (p.warnings.length > 0 || p.fallback) &&
            'underline decoration-amber-500 decoration-wavy underline-offset-2',
        )}
        title={
          p.warnings.length
            ? p.warnings.join('\n')
            : p.fallback
              ? 'Couldn’t verify a rewrite — showing your vault text verbatim.'
              : undefined
        }
      >
        {p.text}
      </span>
      {p.warnings.length > 0 && (
        <span
          className="ml-1 inline-flex align-middle text-amber-600"
          title={p.warnings.join('\n')}
        >
          <AlertTriangle className="size-3" />
        </span>
      )}
      <span className="absolute -top-7 right-0 z-10 hidden items-center gap-0.5 rounded-md border bg-white p-0.5 shadow-sm group-hover/bullet:flex group-focus-within/bullet:flex">
        {tool('Regenerate', <RefreshCw className="size-3.5" />, p.onRegenerate)}
        {tool('Swap', <Replace className="size-3.5" />, p.onSwap)}
        {tool('Show source', <FileSearch className="size-3.5" />, p.onSource)}
        {tool('Move up', <ArrowUp className="size-3.5" />, () => p.onMove(-1))}
        {tool('Move down', <ArrowDown className="size-3.5" />, () => p.onMove(1))}
        {tool('Delete', <Trash2 className="size-3.5" />, p.onDelete)}
      </span>
    </span>
  );
}

function Dot({ score }: { score: number }) {
  return (
    <span
      className={cn(
        'mt-1.5 size-2 shrink-0 rounded-full',
        score >= 2 ? 'bg-emerald-500' : score === 1 ? 'bg-amber-500' : 'bg-rose-500',
      )}
      aria-label={score >= 2 ? 'covered' : score === 1 ? 'weak' : 'gap'}
    />
  );
}

function MatchPanel({
  report,
  onFocus,
}: {
  report: MatchReport;
  onFocus: (bulletId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5 text-sm">
      <div>
        <p className="text-3xl font-semibold tabular-nums">{report.coveragePercent}%</p>
        <p className="text-xs text-muted-foreground">
          of must-haves covered, weighted by importance
        </p>
      </div>
      {report.knockoutWarnings.map((w) => (
        <p
          key={w}
          className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
        >
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600" /> {w}
        </p>
      ))}
      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">Must-haves</h3>
        {report.mustHaveCoverage.map((m) => (
          <button
            key={m.reqId}
            disabled={!m.coveredBy}
            onClick={() => m.coveredBy && onFocus(m.coveredBy)}
            className="flex gap-2 text-left disabled:cursor-default"
          >
            <Dot score={m.bestScore} />
            <span>
              {m.req} <span className="text-xs text-muted-foreground">· weight {m.weight}</span>
            </span>
          </button>
        ))}
      </section>
      {report.niceToHaveCoverage.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="font-medium">Nice-to-haves</h3>
          {report.niceToHaveCoverage.map((m) => (
            <button
              key={m.reqId}
              disabled={!m.coveredBy}
              onClick={() => m.coveredBy && onFocus(m.coveredBy)}
              className="flex gap-2 text-left disabled:cursor-default"
            >
              <Dot score={m.bestScore} />
              <span>{m.req}</span>
            </button>
          ))}
        </section>
      )}
      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">Keywords</h3>
        <div className="flex flex-wrap gap-1">
          {report.keywords.map((k) => (
            <Badge
              key={k.term}
              variant={k.used ? 'secondary' : 'outline'}
              className={cn(!k.used && 'text-muted-foreground')}
            >
              {k.used ? '✓ ' : ''}
              {k.term}
            </Badge>
          ))}
        </div>
      </section>
      {report.gaps.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Gaps</h3>
          {report.gaps.map((g) => (
            <div key={g.reqId} className="flex flex-col items-start gap-1 rounded-lg border p-2">
              <p className="text-xs">{g.suggestion}</p>
              <Link
                href={`/vault/achievement/new?note=${encodeURIComponent(`Evidence for: ${g.req}`)}`}
                className={buttonVariants({ size: 'xs', variant: 'outline' })}
              >
                Add to vault
              </Link>
            </div>
          ))}
        </section>
      )}
      {report.fallbackBullets.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {report.fallbackBullets.length} bullet(s) are shown as written in your vault because no
          rewrite passed fact-checking.
        </p>
      )}
    </div>
  );
}

function RecruiterPanel({
  sim,
  busy,
  onImprove,
}: {
  sim: RecruiterSim | null;
  busy: boolean;
  onImprove: () => void;
}) {
  if (!sim)
    return (
      <p className="text-sm text-muted-foreground">
        The recruiter view isn’t available for this version.
      </p>
    );
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex items-baseline gap-3">
        <p className="text-3xl font-semibold tabular-nums">{sim.score}/10</p>
        <Badge variant={sim.shortlist ? 'default' : 'outline'}>
          {sim.shortlist ? 'Would shortlist' : 'Wouldn’t shortlist yet'}
        </Badge>
      </div>
      <Block title="10-second impression">{sim.ten_second_impression}</Block>
      <Block title="Strongest line">“{sim.strongest_line}”</Block>
      <Block title="Weakest line">
        “{sim.weakest_line}”
        <p className="mt-1 text-xs text-muted-foreground">{sim.weakest_line_critique}</p>
        {sim.score < 7 && (
          <Button size="sm" className="mt-2" disabled={busy} onClick={onImprove}>
            <Sparkles /> Improve weakest line
          </Button>
        )}
      </Block>
      {sim.missing_for_this_role.length > 0 && (
        <Block title="Missing for this role">
          <ul className="list-disc pl-4">
            {sim.missing_for_this_role.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Block>
      )}
      {sim.would_ask_in_interview.length > 0 && (
        <Block title="They’d ask you">
          <ul className="list-disc pl-4">
            {sim.would_ask_in_interview.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}

function VaultPanel({ sources, doc }: { sources: Record<string, SourceSummary>; doc: ResumeDoc }) {
  const onPage = Object.entries(sources).filter(([id]) => JSON.stringify(doc).includes(id));
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">
        Every bullet on the page comes from one of these vault entries.
      </p>
      {onPage.map(([id, s]) => (
        <SourceCard key={id} s={s} />
      ))}
      <Link href="/vault" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
        Open your vault
      </Link>
    </div>
  );
}

function SourceCard({ s }: { s: SourceSummary }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-2 text-sm">
      <p>{s.action}</p>
      {s.result && <p className="text-muted-foreground">→ {s.result}</p>}
      <p className="text-xs text-muted-foreground">
        {s.where}
        {s.metricValue ? ` · metric ${s.metricValue} (${s.metricConfidence})` : ''}
        {s.tools.length ? ` · ${s.tools.join(', ')}` : ''}
      </p>
      <Link
        href={`/vault/achievement/${s.achievementId}`}
        className="text-xs underline-offset-4 hover:underline"
      >
        Edit in vault
      </Link>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  );
}
