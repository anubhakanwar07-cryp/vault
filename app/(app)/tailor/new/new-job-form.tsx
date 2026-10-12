'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createJobAction } from '../actions';

type Mode = 'paste' | 'url';

export function NewJobForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('paste');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [lastUrl, setLastUrl] = useState('');

  const submit = (fd: FormData) =>
    start(async () => {
      setError(null);
      fd.set('mode', mode);
      if (mode === 'url') setLastUrl(String(fd.get('url') ?? ''));
      const res = await createJobAction(fd);
      if (!res.ok) {
        setError(res.error);
        if (res.fallbackToPaste) setMode('paste');
        return;
      }
      router.push(`/tailor/${res.data.jobId}/confirm`);
    });

  return (
    <form action={submit} className="flex max-w-2xl flex-col gap-4">
      <div
        role="tablist"
        aria-label="Job description source"
        className="flex gap-1 rounded-lg bg-muted p-1"
      >
        {(['paste', 'url'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              'flex-1 rounded-md px-3 py-1.5 text-sm',
              mode === m ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
            )}
          >
            {m === 'paste' ? 'Paste the JD' : 'Job link'}
          </button>
        ))}
      </div>

      {mode === 'paste' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="text">Job description</Label>
          <Textarea
            id="text"
            name="text"
            rows={16}
            required
            autoFocus
            placeholder="Paste the full job description"
          />
          {lastUrl && <input type="hidden" name="sourceUrl" value={lastUrl} />}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="url">Job link</Label>
          <Input
            id="url"
            name="url"
            type="url"
            required
            autoFocus
            placeholder="https://jobs.example.com/…"
          />
          <p className="text-xs text-muted-foreground">
            Works for most company career pages. Some job boards (e.g. LinkedIn) block automated
            reading — paste the text instead.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Reading the JD…' : 'Read the JD'}
        </Button>
        {pending && <span className="text-sm text-muted-foreground">About 10–20 seconds.</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
