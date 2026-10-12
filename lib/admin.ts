import 'server-only';
import { notFound } from 'next/navigation';
import { isAdmin, requireUser } from '@/lib/auth';

/** Admin pages 404 for everyone not in ADMIN_EMAILS (SPEC §14 Phase 7). */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return user;
}
