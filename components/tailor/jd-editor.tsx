'use client';

import { AlertTriangle, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { saveJobParseAction } from '@/app/(app)/tailor/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { COMPANY_STAGES, EVIDENCE_TYPES, SENIORITIES, type ParsedJD } from '@/lib/llm/schemas/jd';
import { ROLE_FAMILIES } from '@/lib/llm/schemas/vault';
import { knockoutWarnings, type RoleSpan } from '@/lib/vault/experience';

const selectClass =
  'h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const FAMILY_LABELS: Record<string, string> = {
  ai_pm: 'AI product',
  pm: 'Product',
  growth: 'Growth',
  engineering: 'Engineering',
  data: 'Data',
  design: 'Design',
  analyst: 'Analyst',
  ops: 'Operations',
  other: 'Other',
};

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label: string;
  labels?: Record<string, string>;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={selectClass}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

export function JdEditor({
  jobId,
  initial,
  roles,
  sourceUrl,
}: {
  jobId: string;
  initial: ParsedJD;
  roles: RoleSpan[];
  sourceUrl: string | null;
}) {
  const router = useRouter();
  const [jd, setJd] = useState<ParsedJD>(initial);
  const [newKeyword, setNewKeyword] = useState('');
  const [newKnockout, setNewKnockout] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const warnings = useMemo(() => knockoutWarnings(jd.knockouts, roles), [jd.knockouts, roles]);

  const patch = (p: Partial<ParsedJD>) => setJd((cur) => ({ ...cur, ...p }));

  const save = (confirm: boolean) =>
    start(async () => {
      const res = await saveJobParseAction(jobId, jd, confirm);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? { _form: res.error });
        toast.error(res.error);
        return;
      }
      setErrors({});
      if (confirm) router.push(`/tailor/${jobId}/run`);
      else toast.success('Saved');
    });

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> {w}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            You can still tailor — just know this may be screened on.
          </p>
        </div>
      )}

      <Block title="The role">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <Input
              value={jd.role_title}
              onChange={(e) => patch({ role_title: e.target.value })}
              aria-invalid={!!errors.role_title}
            />
          </Field>
          <Field label="Company">
            <Input
              value={jd.company ?? ''}
              onChange={(e) => patch({ company: e.target.value || null })}
            />
          </Field>
          <Field label="Role family">
            <Select
              label="Role family"
              value={jd.role_family}
              options={ROLE_FAMILIES}
              labels={FAMILY_LABELS}
              onChange={(v) => patch({ role_family: v })}
            />
          </Field>
          <Field label="Seniority">
            <Select
              label="Seniority"
              value={jd.seniority}
              options={SENIORITIES}
              onChange={(v) => patch({ seniority: v })}
            />
          </Field>
          <Field label="Company stage">
            <Select
              label="Company stage"
              value={jd.company_stage}
              options={COMPANY_STAGES}
              onChange={(v) => patch({ company_stage: v })}
            />
          </Field>
          {sourceUrl && (
            <Field label="Source">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate pt-1.5 text-sm underline-offset-4 hover:underline"
              >
                {sourceUrl.replace(/^https?:\/\//, '')}
              </a>
            </Field>
          )}
        </div>
      </Block>

      <Block
        title="What this hire will be judged on"
        hint="The three problems the resume should speak to."
      >
        {jd.core_problems.map((p, i) => (
          <div key={i} className="flex gap-2">
            <span className="pt-1.5 text-sm text-muted-foreground">{i + 1}.</span>
            <Input
              value={p}
              aria-label={`Core problem ${i + 1}`}
              onChange={(e) =>
                patch({
                  core_problems: jd.core_problems.map((x, j) => (j === i ? e.target.value : x)),
                })
              }
            />
            {jd.core_problems.length > 1 && (
              <RemoveButton
                label="Remove problem"
                onClick={() => patch({ core_problems: jd.core_problems.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
        {jd.core_problems.length < 3 && (
          <AddButton onClick={() => patch({ core_problems: [...jd.core_problems, ''] })}>
            Add problem
          </AddButton>
        )}
      </Block>

      <Block
        title="Must-haves"
        hint="Weight 5 = critical. These drive which of your achievements are picked."
      >
        {jd.must_haves.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <Input
              value={m.req}
              aria-label={`Must-have ${i + 1}`}
              className="min-w-0 flex-1"
              onChange={(e) =>
                patch({
                  must_haves: jd.must_haves.map((x, j) =>
                    j === i ? { ...x, req: e.target.value } : x,
                  ),
                })
              }
            />
            <Select
              label="Weight"
              value={String(m.weight)}
              options={range(5)}
              onChange={(v) =>
                patch({
                  must_haves: jd.must_haves.map((x, j) =>
                    j === i ? { ...x, weight: Number(v) } : x,
                  ),
                })
              }
            />
            <Select
              label="Evidence type"
              value={m.evidence_type}
              options={EVIDENCE_TYPES}
              onChange={(v) =>
                patch({
                  must_haves: jd.must_haves.map((x, j) =>
                    j === i ? { ...x, evidence_type: v } : x,
                  ),
                })
              }
            />
            <RemoveButton
              label="Remove must-have"
              onClick={() => patch({ must_haves: jd.must_haves.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <AddButton
          onClick={() =>
            patch({
              must_haves: [
                ...jd.must_haves,
                { id: `m${jd.must_haves.length + 1}`, req: '', weight: 3, evidence_type: 'skill' },
              ],
            })
          }
        >
          Add must-have
        </AddButton>
      </Block>

      <Block title="Nice-to-haves">
        {jd.nice_to_haves.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={n.req}
              aria-label={`Nice-to-have ${i + 1}`}
              onChange={(e) =>
                patch({
                  nice_to_haves: jd.nice_to_haves.map((x, j) =>
                    j === i ? { ...x, req: e.target.value } : x,
                  ),
                })
              }
            />
            <Select
              label="Weight"
              value={String(n.weight)}
              options={range(3)}
              onChange={(v) =>
                patch({
                  nice_to_haves: jd.nice_to_haves.map((x, j) =>
                    j === i ? { ...x, weight: Number(v) } : x,
                  ),
                })
              }
            />
            <RemoveButton
              label="Remove nice-to-have"
              onClick={() => patch({ nice_to_haves: jd.nice_to_haves.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <AddButton
          onClick={() =>
            patch({
              nice_to_haves: [
                ...jd.nice_to_haves,
                { id: `n${jd.nice_to_haves.length + 1}`, req: '', weight: 2 },
              ],
            })
          }
        >
          Add nice-to-have
        </AddButton>
      </Block>

      <Block
        title="Keywords"
        hint="Used only where they truthfully describe your work. Click the number to change weight."
      >
        <div className="flex flex-wrap gap-1.5">
          {jd.keywords.map((k, i) => (
            <Badge
              key={k.term}
              variant="secondary"
              className="gap-1.5"
              title={k.synonyms.length ? `Also: ${k.synonyms.join(', ')}` : undefined}
            >
              {k.term}
              <button
                type="button"
                aria-label={`Weight ${k.weight}, click to change`}
                className="rounded bg-background/60 px-1 text-[10px] tabular-nums"
                onClick={() =>
                  patch({
                    keywords: jd.keywords.map((x, j) =>
                      j === i ? { ...x, weight: (x.weight % 5) + 1 } : x,
                    ),
                  })
                }
              >
                {k.weight}
              </button>
              <button
                type="button"
                aria-label={`Remove ${k.term}`}
                onClick={() => patch({ keywords: jd.keywords.filter((_, j) => j !== i) })}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const term = newKeyword.trim();
            if (term && !jd.keywords.some((k) => k.term.toLowerCase() === term.toLowerCase())) {
              patch({ keywords: [...jd.keywords, { term, synonyms: [], weight: 3 }] });
            }
            setNewKeyword('');
          }}
        >
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add a keyword"
            aria-label="New keyword"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </form>
      </Block>

      <Block title="Knockouts" hint="Hard filters: years, location, degree, work authorisation.">
        {jd.knockouts.map((k, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={k}
              aria-label={`Knockout ${i + 1}`}
              onChange={(e) =>
                patch({ knockouts: jd.knockouts.map((x, j) => (j === i ? e.target.value : x)) })
              }
            />
            <RemoveButton
              label="Remove knockout"
              onClick={() => patch({ knockouts: jd.knockouts.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newKnockout.trim()) patch({ knockouts: [...jd.knockouts, newKnockout.trim()] });
            setNewKnockout('');
          }}
        >
          <Input
            value={newKnockout}
            onChange={(e) => setNewKnockout(e.target.value)}
            placeholder="e.g. 3+ years of product experience"
            aria-label="New knockout"
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            Add
          </Button>
        </form>
      </Block>

      {errors._form && (
        <p role="alert" className="text-sm text-destructive">
          {errors._form}
        </p>
      )}
      {Object.keys(errors).filter((k) => k !== '_form').length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Fix: {Object.values(errors).join('; ')}
        </p>
      )}

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button onClick={() => save(true)} disabled={pending}>
          {pending ? 'Saving…' : 'Looks right → Tailor'}
        </Button>
        <Button variant="ghost" onClick={() => save(false)} disabled={pending}>
          Save for later
        </Button>
      </div>
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Wraps the control in its <label>, so screen readers announce the field name. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm leading-none font-medium select-none">{label}</span>
      {children}
    </label>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" size="icon-sm" variant="ghost" aria-label={label} onClick={onClick}>
      <X />
    </Button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={onClick}>
      <Plus /> {children}
    </Button>
  );
}
