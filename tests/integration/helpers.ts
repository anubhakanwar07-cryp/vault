import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/** Creates (or reuses) a confirmed test user and returns its id. */
export async function ensureTestUser(email: string): Promise<string> {
  const admin = createSupabaseAdminClient();
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.data.user) return created.data.user.id;
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
  }
  throw created.error ?? new Error(`could not create or find ${email}`);
}
