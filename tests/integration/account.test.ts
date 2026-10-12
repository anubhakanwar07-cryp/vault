import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteAccount } from '@/lib/account';
import { adminDb, withUser } from '@/lib/db/client';
import { achievements, projects, roles } from '@/lib/db/schema';
import { UPLOADS_BUCKET, uploadUserFile } from '@/lib/storage';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ensureTestUser } from './helpers';

describe('delete my account and data (SPEC §16)', () => {
  it('removes every row, every stored file and the auth user', async () => {
    const userId = await ensureTestUser('delete-me@resume-tailor.test');
    await withUser(userId, async (tx) => {
      const [r] = await tx
        .insert(roles)
        .values({ userId, company: 'X', title: 'Y', startDate: '2024-01-01' })
        .returning({ id: roles.id });
      const [p] = await tx
        .insert(projects)
        .values({ userId, roleId: r!.id, name: 'P' })
        .returning({ id: projects.id });
      await tx
        .insert(achievements)
        .values({ userId, projectId: p!.id, roleId: r!.id, action: 'Did a thing' });
    });
    await uploadUserFile(
      userId,
      'imports',
      'resume.pdf',
      new TextEncoder().encode('%PDF-test'),
      'application/pdf',
    );
    await uploadUserFile(
      userId,
      'exports',
      'out.pdf',
      new TextEncoder().encode('%PDF-test'),
      'application/pdf',
    );

    await deleteAccount(userId);

    expect(await adminDb().select().from(roles).where(eq(roles.userId, userId))).toHaveLength(0);
    expect(
      await adminDb().select().from(achievements).where(eq(achievements.userId, userId)),
    ).toHaveLength(0);
    const admin = createSupabaseAdminClient();
    for (const folder of ['imports', 'exports']) {
      const { data } = await admin.storage.from(UPLOADS_BUCKET).list(`${userId}/${folder}`);
      expect(data ?? []).toHaveLength(0);
    }
    const { data: u } = await admin.auth.admin.getUserById(userId);
    expect(u.user).toBeNull();
  });
});
