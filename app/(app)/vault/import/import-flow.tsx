'use client';

import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ImportResumeOutput } from '@/lib/llm/schemas/import';
import { cn } from '@/lib/utils';
import { importSourceAction, saveImportAction, type ImportDraft } from './actions';

type Kind = ImportDraft['sourceKind'];
const TABS: { kind: Kind; label: string }[] = [
  { kind: 'resume', label: 'Resume' },
  { kind: 'portfolio', label: 'Portfolio link' },
  { kind: 'brief', label: 'Write a brief' },
];

type Path = (string | number)[];
const key = (p: Path) => p.join('.');

function setAt<T>(obj: T, path: Path, value: unknown): T {
  const copy = structuredClone(obj) as Record<string | number, unknown>;
  let cur = copy;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  cur[path.at(-1)!] = value;
  return copy as T;
}

/** Drops excluded items so only checked rows are saved. */
function filtered(d: ImportResumeOutput, excluded: Set<string>): ImportResumeOutput {
  const keep = <T,>(xs: T[], base: Path) => xs.filter((_, i) => !excluded.has(key([...base, i])));
  const projects = (ps: ImportResumeOutput['side_projects'], base: Path) =>
    ps
      .map((p, j) => ({ ...p, achievements: keep(p.achievements, [...base, j, 'achievements']) }))
      .filter((_, j) => !excluded.has(key([...base, j])));
  return {
    ...d,
    roles: d.roles
      .map((r, i) => ({ ...r, projects: projects(r.projects, ['roles', i, 'projects']) }))
      .filter((_, i) => !excluded.has(key(['roles', i]))),
    side_projects: projects(d.side_projects, ['side_projects']),
    education: keep(d.education, ['education']),
    extras: keep(d.extras, ['extras']),
  };
}

export function ImportFlow() {
  const router = useRouter();
  const [result, setResult] = useState<ImportDraft | null>(null);
  const [draft, setDraft] = useState<ImportResumeOutput | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [kind, setKind] = useState<Kind>('resume');
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const read = (formData: FormData) =>
    startReading(async () => {
      setError(null);
      formData.set('kind', kind);
      const res = await importSourceAction(formData);
      if (!res.ok) return setError(res.error);
      setResult(res.data);
      setDraft(res.data.draft);
      // Likely duplicates of existing vault entries start unticked.
      setExcluded(new Set(res.data.merge.duplicates));
    });

  const save = () =>
    startSaving(async () => {
      if (!draft) return;
      const res = await saveImportAction(filtered(draft, excluded));
      if (!res.ok) return void toast.error(res.error);
      const c = res.data.counts;
      if (res.warning) toast.warning(res.warning);
      toast.success(
        `Added ${c.roles} roles, ${c.projects} projects and ${c.achievements} achievements.`,
      );
      router.push('/vault');
    });

  if (!draft || !result) {
    return (
      <form action={read} className="flex max-w-xl flex-col gap-4">
        <div role="tablist" aria-label="Source" className="flex gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="tab"
              aria-selected={kind === t.kind}
              onClick={() => {
                setKind(t.kind);
                setError(null);
              }}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm',
                kind === t.kind ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {kind === 'resume' &&
          (!showPaste ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="file">Resume (PDF or DOCX, up to 5 MB)</Label>
              <Input
                id="file"
                name="file"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="text">Resume text</Label>
              <Textarea
                id="text"
                name="text"
                rows={14}
                required
                placeholder="Paste the full text of your resume"
              />
            </div>
          ))}

        {kind === 'portfolio' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="url">Portfolio link</Label>
            <Input id="url" name="url" type="url" required placeholder="https://your-site.com" />
            <p className="text-xs text-muted-foreground">
              We read the page and up to 10 project pages on the same site. Works with most personal
              sites, Notion and Behance pages.
            </p>
          </div>
        )}

        {kind === 'brief' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brief">Describe your work in your own words</Label>
            <Textarea
              id="brief"
              name="text"
              rows={14}
              required
              placeholder={
                'Anything your resume leaves out: freelance gigs, side projects, hackathons, research, volunteering…\n\n' +
                'e.g. "In 2024 I built a WhatsApp bot for my aunt’s bakery that took ~40 orders a week. I used Python and Twilio…"'
              }
            />
            <p className="text-xs text-muted-foreground">
              Include numbers only if you’re sure of them — we keep exactly what you write and
              nothing more.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={reading}>
            {reading
              ? 'Reading…'
              : kind === 'portfolio'
                ? 'Read my portfolio'
                : kind === 'brief'
                  ? 'Organise my brief'
                  : 'Read my resume'}
          </Button>
          {kind === 'resume' && (
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setShowPaste((v) => !v)}
            >
              {showPaste ? 'Upload a file instead' : 'Paste text instead'}
            </button>
          )}
        </div>
        {reading && (
          <p className="text-sm text-muted-foreground">
            This usually takes 30–90 seconds. Nothing is saved until you review it.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    );
  }

  const set = (path: Path, value: unknown) => setDraft((d) => (d ? setAt(d, path, value) : d));
  const toggle = (path: Path) =>
    setExcluded((ex) => {
      const next = new Set(ex);
      const k = key(path);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const isOn = (path: Path) => !excluded.has(key(path));

  const flagsFor = (prefix: string) =>
    result.flags.filter((f) => f.path === prefix || f.path.startsWith(`${prefix}.`));

  const dupes = new Set(result.merge.duplicates);
  const projectBlock = (p: ImportResumeOutput['side_projects'][number], base: Path) => (
    <Item key={key(base)} on={isOn(base)} onToggle={() => toggle(base)} label="project">
      {result.merge.projectTargets[key(base)] ? (
        <p className="text-sm">
          <Badge variant="outline">Adds to</Badge>{' '}
          <span className="font-medium">{result.merge.projectTargets[key(base)]}</span>
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Badge>New</Badge>
          <Input
            value={p.name}
            aria-label="Project name"
            onChange={(e) => set([...base, 'name'], e.target.value)}
            className="font-medium"
          />
        </div>
      )}
      <div className="flex flex-col gap-2 pl-2">
        {p.achievements.map((a, k) => {
          const ap = [...base, 'achievements', k];
          const flags = flagsFor(key(ap));
          return (
            <Item
              key={key(ap)}
              on={isOn(ap) && isOn(base)}
              onToggle={() => toggle(ap)}
              label="achievement"
            >
              <Textarea
                rows={2}
                value={a.action}
                aria-label="Action"
                onChange={(e) => set([...ap, 'action'], e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_9rem]">
                <Input
                  value={a.result ?? ''}
                  placeholder="Result (if stated)"
                  aria-label="Result"
                  onChange={(e) => set([...ap, 'result'], e.target.value || null)}
                />
                <Input
                  value={a.metric_value ?? ''}
                  placeholder="Metric"
                  aria-label="Metric"
                  onChange={(e) => set([...ap, 'metric_value'], e.target.value || null)}
                />
                <select
                  aria-label="Metric confidence"
                  value={a.metric_confidence}
                  onChange={(e) => set([...ap, 'metric_confidence'], e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="exact">Exact</option>
                  <option value="estimate">Estimate (~)</option>
                  <option value="none">No number</option>
                </select>
              </div>
              {[...a.skills, ...a.tools, ...a.function_tags].length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {[...a.function_tags, ...a.skills, ...a.tools].map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              {dupes.has(key(ap)) && (
                <Flag>
                  Possible duplicate — this looks like something already in your vault. Unticked.
                </Flag>
              )}
              {flags.map((f) => (
                <Flag key={f.message}>{f.message.replace('your resume', 'your source')}</Flag>
              ))}
            </Item>
          );
        })}
      </div>
    </Item>
  );

  const count = filtered(draft, excluded);
  const nAch = [...count.roles.flatMap((r) => r.projects), ...count.side_projects].reduce(
    (n, p) => n + p.achievements.length,
    0,
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Review what we extracted from{' '}
        <span className="font-medium text-foreground">{result.sourceLabel}</span>. Edit anything
        that’s wrong and untick anything you don’t want. Nothing is saved until you click Save.
      </p>
      {result.flags.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">
            We removed or flagged {result.flags.length} thing(s) that weren’t in your source text:
          </p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {result.flags.slice(0, 8).map((f) => (
              <li key={f.path + f.message}>{f.message.replace('your resume', 'your source')}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="You">
        <div className="grid gap-2 sm:grid-cols-2">
          {(['full_name', 'email', 'phone', 'location'] as const).map((f) => (
            <Input
              key={f}
              value={draft.profile[f] ?? ''}
              placeholder={f.replace('_', ' ')}
              aria-label={f}
              onChange={(e) => set(['profile', f], e.target.value || null)}
            />
          ))}
        </div>
      </Section>

      <Section title="Experience">
        {draft.roles.map((r, i) => {
          const base: Path = ['roles', i];
          return (
            <Item key={key(base)} on={isOn(base)} onToggle={() => toggle(base)} label="role">
              {result.merge.roleTargets[key(base)] ? (
                <p className="text-sm">
                  <Badge variant="outline">Adds to</Badge>{' '}
                  <span className="font-medium">{result.merge.roleTargets[key(base)]}</span>
                </p>
              ) : (
                <>
                  <Badge className="w-fit">New role</Badge>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={r.title}
                      aria-label="Title"
                      onChange={(e) => set([...base, 'title'], e.target.value)}
                      className="font-medium"
                    />
                    <Input
                      value={r.company}
                      aria-label="Company"
                      onChange={(e) => set([...base, 'company'], e.target.value)}
                    />
                    <Input
                      type="month"
                      value={r.start_date ?? ''}
                      aria-label="Start"
                      aria-invalid={!r.start_date}
                      onChange={(e) => set([...base, 'start_date'], e.target.value || null)}
                    />
                    <Input
                      type="month"
                      value={r.end_date ?? ''}
                      aria-label="End (empty = current)"
                      onChange={(e) => set([...base, 'end_date'], e.target.value || null)}
                    />
                  </div>
                  {!r.start_date && (
                    <Flag>Add a start date — it wasn’t in your source and roles need one.</Flag>
                  )}
                </>
              )}
              <div className="flex flex-col gap-2">
                {r.projects.map((p, j) => projectBlock(p, [...base, 'projects', j]))}
              </div>
            </Item>
          );
        })}
      </Section>

      {draft.side_projects.length > 0 && (
        <Section title="Side projects">
          {draft.side_projects.map((p, j) => projectBlock(p, ['side_projects', j]))}
        </Section>
      )}

      {draft.education.length > 0 && (
        <Section title="Education">
          {draft.education.map((e, i) => (
            <Item
              key={i}
              on={isOn(['education', i])}
              onToggle={() => toggle(['education', i])}
              label="education"
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={e.institution ?? ''}
                  placeholder="Institution"
                  aria-label="Institution"
                  onChange={(ev) => set(['education', i, 'institution'], ev.target.value || null)}
                />
                <Input
                  value={[e.degree, e.field].filter(Boolean).join(', ')}
                  disabled
                  aria-label="Degree"
                />
              </div>
            </Item>
          ))}
        </Section>
      )}

      {draft.extras.length > 0 && (
        <Section title="Awards, certifications & leadership">
          {draft.extras.map((x, i) => (
            <Item
              key={i}
              on={isOn(['extras', i])}
              onToggle={() => toggle(['extras', i])}
              label="extra"
            >
              <Input
                value={x.title ?? ''}
                placeholder="Title"
                aria-label="Title"
                onChange={(ev) => set(['extras', i, 'title'], ev.target.value || null)}
              />
            </Item>
          ))}
        </Section>
      )}

      {draft.skills.length > 0 && (
        <Section title="Skills listed on your resume">
          <div className="flex flex-wrap gap-1">
            {draft.skills.map((s) => (
              <Badge key={s} variant="outline">
                {s}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Skills only count when they’re attached to an achievement, so tailored resumes can prove
            them. Add them to the achievements where you used them.
          </p>
        </Section>
      )}

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save ${nAch} achievements to vault`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft(null);
            setResult(null);
          }}
        >
          Start over
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b pb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Item({
  on,
  onToggle,
  label,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex gap-3 rounded-lg border p-3', !on && 'opacity-50')}>
      <Checkbox
        checked={on}
        onCheckedChange={onToggle}
        aria-label={`Include this ${label}`}
        className="mt-2"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
    </div>
  );
}

function Flag({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {children}
    </p>
  );
}
