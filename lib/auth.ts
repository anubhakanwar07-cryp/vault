import 'server-only';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { adminEmails } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type CurrentUser = { id: string; email: string | null };

/** The signed-in user, or a redirect to /login. Call inside a Suspense boundary. */
export async function requireUser(): Promise<CurrentUser> {
  // Session checks compare token expiry against Date.now(); mark this as request-time work.
  await connection();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return { id: user.id, email: user.email ?? null };
}

export function isAdmin(user: CurrentUser): boolean {
  return !!user.email && adminEmails().includes(user.email.toLowerCase());
}
