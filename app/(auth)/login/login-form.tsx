'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';
  const callbackError = params.get('error');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>(
    callbackError
      ? { kind: 'error', message: 'That sign-in link didn’t work. Request a new one.' }
      : { kind: 'idle' },
  );

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'sending' });
    const { error } = await createSupabaseBrowserClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    setStatus(error ? { kind: 'error', message: error.message } : { kind: 'sent' });
  }

  async function signInWithGoogle() {
    const { error } = await createSupabaseBrowserClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo() },
    });
    if (error) setStatus({ kind: 'error', message: error.message });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in to Resume Tailor</CardTitle>
        <CardDescription>We’ll email you a link. No password needed.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status.kind === 'sent' ? (
          <p className="text-sm">
            Check <span className="font-medium">{email}</span> for a sign-in link. Open it in this
            browser.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={status.kind === 'sending'}>
              {status.kind === 'sending' ? 'Sending…' : 'Email me a link'}
            </Button>
          </form>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Separator className="flex-1" /> or <Separator className="flex-1" />
        </div>
        <Button variant="outline" onClick={signInWithGoogle}>
          Continue with Google
        </Button>
        {status.kind === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {status.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
