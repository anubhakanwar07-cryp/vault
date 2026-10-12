'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createApplicationAction,
  deleteApplicationAction,
  updateNotesAction,
  updateStatusAction,
} from '@/app/(app)/applications/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ApplicationRow } from '@/lib/db/queries/applications';
import { ROLE_FAMILIES } from '@/lib/llm/schemas/vault';
import { APPLICATION_STATUSES } from '@/lib/tracker/stats';
import { cn } from '@/lib/utils';

const selectClass = 'h-8 rounded-lg border border-input bg-transparent px-2 text-sm';
const STATUS_TONE: Record<string, string> = {
  saved: 'text-muted-foreground',
  applied: '',
  callback: 'text-sky-700 dark:text-sky-400',
  interview: 'text-violet-700 dark:text-violet-400',
  offer: 'text-emerald-700 dark:text-emerald-400 font-medium',
  rejected: 'text-rose-700 dark:text-rose-400',
  ghosted: 'text-muted-foreground',
};

type ResumeOption = {
  id: string;
  version: number;
  status: string;
  company: string | null;
  roleTitle: string | null;
};
type Prefill = {
  resumeId: string;
  company: string | null;
  roleTitle: string | null;
  roleFamily: string | null;
} | null;

export function ApplicationsView({
  apps,
  resumes,
  prefill,
}: {
  apps: ApplicationRow[];
  resumes: ResumeOption[];
  prefill: Prefill;
}) {
  const [open, setOpen] = useState(prefill !== null);
  const [, start] = useTransition();
  const router = useRouter();

  const setStatus = (id: string, status: string) =>
    start(async () => {
      const res = await updateStatusAction(id, status);
      if (!res.ok) toast.error(res.error);
    });
  const setNotes = (id: string, notes: string) =>
    start(async () => {
      const res = await updateNotesAction(id, notes);
      if (!res.ok) toast.error(res.error);
    });
  const remove = (id: string) => {
    if (!confirm('Delete this application?')) return;
    start(async () => {
      await deleteApplicationAction(id);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {apps.length} application{apps.length === 1 ? '' : 's'} logged
        </p>
        <Button onClick={() => setOpen(true)}>
          <Plus /> Log application
        </Button>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed p-6 text-sm">
          <p className="font-medium">No applications yet.</p>
          <p className="text-muted-foreground">
            Log each application with the exact resume you sent. Also log a few sent with your usual
            resume — that’s how you’ll see whether tailoring actually gets more callbacks.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  {['Company', 'Role', 'Applied', 'Channel', 'Status', 'Resume', 'Notes', ''].map(
                    (h) => (
                      <th key={h} className="px-2 py-2 font-medium">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {apps.map((a) => (
                  <tr key={a.id} className="border-b align-top">
                    <td className="px-2 py-2 font-medium">{a.company ?? '—'}</td>
                    <td className="px-2 py-2">{a.roleTitle ?? '—'}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{a.appliedAt ?? '—'}</td>
                    <td className="px-2 py-2">{a.channel ?? '—'}</td>
                    <td className="px-2 py-2">
                      <StatusSelect value={a.status} onChange={(s) => setStatus(a.id, s)} />
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <ResumeCell a={a} />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        defaultValue={a.notes ?? ''}
                        aria-label="Notes"
                        className="h-7 min-w-40"
                        onBlur={(e) =>
                          e.target.value !== (a.notes ?? '') && setNotes(a.id, e.target.value)
                        }
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete"
                        onClick={() => remove(a.id)}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {apps.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{a.company ?? '—'}</p>
                    <p className="text-muted-foreground">{a.roleTitle}</p>
                  </div>
                  <StatusSelect value={a.status} onChange={(s) => setStatus(a.id, s)} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {a.appliedAt && <span>{a.appliedAt}</span>}
                  {a.channel && <span>· {a.channel}</span>}
                  <ResumeCell a={a} />
                </div>
                <Input
                  defaultValue={a.notes ?? ''}
                  placeholder="Notes"
                  aria-label="Notes"
                  onBlur={(e) =>
                    e.target.value !== (a.notes ?? '') && setNotes(a.id, e.target.value)
                  }
                />
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o && prefill) router.replace('/applications');
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Log an application</DialogTitle>
          </DialogHeader>
          <LogForm
            resumes={resumes}
            prefill={prefill}
            onDone={() => {
              setOpen(false);
              router.replace('/applications');
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return (
    <select
      aria-label="Status"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(selectClass, STATUS_TONE[value])}
    >
      {APPLICATION_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}

function ResumeCell({ a }: { a: ApplicationRow }) {
  if (!a.isTailored) return <Badge variant="outline">Baseline</Badge>;
  if (!a.resumeId || !a.jobId) return <Badge>Tailored</Badge>;
  return (
    <Link
      href={`/tailor/${a.jobId}/resume/${a.resumeId}`}
      className="underline-offset-4 hover:underline"
    >
      <Badge>Tailored v{a.resumeVersion}</Badge>
    </Link>
  );
}

function LogForm({
  resumes,
  prefill,
  onDone,
}: {
  resumes: ResumeOption[];
  prefill: Prefill;
  onDone: () => void;
}) {
  const [baseline, setBaseline] = useState(false);
  const [resumeId, setResumeId] = useState(prefill?.resumeId ?? '');
  const [company, setCompany] = useState(prefill?.company ?? '');
  const [roleTitle, setRoleTitle] = useState(prefill?.roleTitle ?? '');
  const [roleFamily, setRoleFamily] = useState(prefill?.roleFamily ?? '');
  const [appliedAt, setAppliedAt] = useState(new Date().toISOString().slice(0, 10));
  const [channel, setChannel] = useState('portal');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const pickResume = (id: string) => {
    setResumeId(id);
    const r = resumes.find((x) => x.id === id);
    if (r) {
      setCompany(r.company ?? company);
      setRoleTitle(r.roleTitle ?? roleTitle);
    }
  };

  const submit = () =>
    start(async () => {
      const res = await createApplicationAction({
        resumeId: baseline ? '' : resumeId,
        company,
        roleTitle,
        roleFamily,
        isTailored: !baseline,
        appliedAt,
        channel,
        status: 'applied',
        notes,
      });
      if (!res.ok) return setErrors(res.fieldErrors ?? { _form: res.error });
      toast.success('Application logged');
      onDone();
    });

  const err = (k: string) => errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <label className="flex items-center gap-2">
        <Checkbox checked={baseline} onCheckedChange={(c) => setBaseline(c === true)} />I sent my
        usual (baseline) resume, not a tailored one
      </label>
      {!baseline && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="resume">Resume version sent</Label>
          <select
            id="resume"
            value={resumeId}
            onChange={(e) => pickResume(e.target.value)}
            className={selectClass}
          >
            <option value="">Choose…</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roleTitle ?? 'Resume'} · {r.company ?? '—'} · v{r.version} ({r.status})
              </option>
            ))}
          </select>
          {err('resumeId')}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company">Company</Label>
          <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
          {err('company')}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">Role</Label>
          <Input id="role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
          {err('roleTitle')}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="family">Role family</Label>
          <select
            id="family"
            value={roleFamily}
            onChange={(e) => setRoleFamily(e.target.value)}
            className={selectClass}
          >
            <option value="">{baseline ? 'Choose…' : 'From the job'}</option>
            {ROLE_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          {err('roleFamily')}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="applied">Applied on</Label>
          <Input
            id="applied"
            type="date"
            value={appliedAt}
            onChange={(e) => setAppliedAt(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="channel">Channel</Label>
          <select
            id="channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={selectClass}
          >
            {['portal', 'referral', 'cold-email', 'linkedin'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Input
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Referrer, recruiter name…"
        />
      </div>
      {errors._form && <p className="text-xs text-destructive">{errors._form}</p>}
      <Button onClick={submit} disabled={pending}>
        {pending ? 'Saving…' : 'Log application'}
      </Button>
    </div>
  );
}
