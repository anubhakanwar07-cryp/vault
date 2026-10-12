import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminDb, withUser } from '@/lib/db/client';
import { roles } from '@/lib/db/schema';
import { ensureTestUser } from './helpers';

// Phase 1 acceptance: user A cannot read (or write) user B's rows.
describe('row level security', () => {
  let a = '';
  let b = '';
  let roleOfB = '';

  beforeAll(async () => {
    a = await ensureTestUser('rls-a@resume-tailor.test');
    b = await ensureTestUser('rls-b@resume-tailor.test');
    const [row] = await withUser(b, (tx) =>
      tx
        .insert(roles)
        .values({ userId: b, company: 'B Corp', title: 'Secret role', startDate: '2024-01-01' })
        .returning({ id: roles.id }),
    );
    roleOfB = row!.id;
  });

  afterAll(async () => {
    if (roleOfB) await adminDb().delete(roles).where(eq(roles.id, roleOfB));
  });

  it('owner can read their row', async () => {
    const rows = await withUser(b, (tx) => tx.select().from(roles).where(eq(roles.id, roleOfB)));
    expect(rows).toHaveLength(1);
  });

  it('another user cannot read it', async () => {
    const rows = await withUser(a, (tx) => tx.select().from(roles).where(eq(roles.id, roleOfB)));
    expect(rows).toHaveLength(0);
  });

  it('another user cannot update or delete it', async () => {
    const updated = await withUser(a, (tx) =>
      tx.update(roles).set({ title: 'hacked' }).where(eq(roles.id, roleOfB)).returning(),
    );
    const deleted = await withUser(a, (tx) =>
      tx.delete(roles).where(eq(roles.id, roleOfB)).returning(),
    );
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it('a user cannot insert rows owned by someone else', async () => {
    await expect(
      withUser(a, (tx) =>
        tx.insert(roles).values({ userId: b, company: 'X', title: 'Y', startDate: '2024-01-01' }),
      ),
    ).rejects.toThrow();
  });

  it('the anon role sees nothing', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data } = await anon.from('roles').select('id').eq('id', roleOfB);
    expect(data ?? []).toHaveLength(0);
  });
});
