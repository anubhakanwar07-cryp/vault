import 'server-only';
import { UPLOADS_BUCKET } from '@/lib/storage';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/**
 * "Delete my account and data" (SPEC §16): removes the user's Storage objects, then the auth user.
 * Every table's user_id references auth.users ON DELETE CASCADE, so all rows go with it.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const storage = admin.storage.from(UPLOADS_BUCKET);

  // Storage "folders" are prefixes; walk userId/ recursively.
  const paths: string[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await storage.list(prefix, { limit: 100, offset });
      if (error) {
        if (/not found/i.test(error.message)) return;
        throw error;
      }
      for (const item of data) {
        const path = `${prefix}/${item.name}`;
        if (item.id === null)
          await walk(path); // folder
        else paths.push(path);
      }
      if (data.length < 100) return;
    }
  };
  await walk(userId);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage.remove(paths.slice(i, i + 100));
    if (error) throw error;
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}
