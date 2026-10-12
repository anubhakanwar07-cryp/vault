'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteAccountAction } from './actions';

export function DangerZone() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-destructive/30 p-4">
      <h2 className="font-semibold">Delete my account and data</h2>
      <p className="text-sm text-muted-foreground">
        Permanently deletes your vault, jobs, resumes, applications, uploaded files and exports.
        This can’t be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type DELETE"
          aria-label="Type DELETE to confirm"
          className="max-w-40"
        />
        <Button
          variant="destructive"
          disabled={pending || text.trim().toUpperCase() !== 'DELETE'}
          onClick={() =>
            start(async () => {
              const res = await deleteAccountAction(text);
              if (!res.ok) return setError(res.error);
              router.replace('/');
              router.refresh();
            })
          }
        >
          {pending ? 'Deleting…' : 'Delete everything'}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
