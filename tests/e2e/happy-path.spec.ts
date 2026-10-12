import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const EMAIL = 'e2e@resume-tailor.test';

/** Signs in through /auth/confirm with an admin-generated magic link (no inbox needed). */
async function magicLinkUrl(next = '/dashboard') {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
    },
  );
  await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true }).catch(() => {});
  // Fresh start: delete and recreate so the vault is empty.
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data.users.find((u) => u.email === EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: EMAIL,
  });
  if (error) throw error;
  return `/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;
}

test('sign in → import resume → paste JD → confirm → tailor → edit → export PDF → log application', async ({
  page,
}) => {
  // 1. Sign in
  await page.goto(await magicLinkUrl('/vault/import'));
  await expect(page.getByRole('heading', { name: 'Add to your vault' })).toBeVisible();

  // 2. Import resume
  await page.getByLabel(/Resume \(PDF or DOCX/).setInputFiles('tests/fixtures/sample-resume.pdf');
  await page.getByRole('button', { name: 'Read my resume' }).click();
  await expect(page.getByText(/Review what we extracted/)).toBeVisible({ timeout: 180_000 });
  await page.getByRole('button', { name: /Save \d+ achievements to vault/ }).click();
  await expect(page).toHaveURL(/\/vault$/, { timeout: 120_000 });
  await expect(page.getByText('LearnLoop').first()).toBeVisible();

  // 3. Paste a JD
  await page.goto('/tailor/new');
  await page
    .getByRole('textbox', { name: 'Job description' })
    .fill(await readFile('evals/jds/ai-pm-edtech.txt', 'utf8'));
  await page.getByRole('button', { name: 'Read the JD' }).click();

  // 4. Confirm
  await expect(page.getByRole('heading', { name: 'Check what we understood' })).toBeVisible({
    timeout: 90_000,
  });
  await page.getByRole('button', { name: 'Looks right → Tailor' }).click();

  // 5. Tailor (SSE progress → editor)
  await expect(page.getByText('Writing bullets…')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/resume\/[0-9a-f-]{36}$/, { timeout: 180_000 });
  await expect(page.getByRole('tab', { name: 'Match report' })).toBeVisible();

  // 6. Edit a bullet inline
  const firstBullet = page.locator('[data-bullet-id] [role="button"]').first();
  const original = (await firstBullet.textContent())!.trim();
  await firstBullet.click();
  const editor = page.getByLabel('Edit bullet');
  const edited = original.replace(/^\w+/, 'Shipped');
  await editor.fill(edited);
  await editor.press('Enter');
  await expect(page.locator('[data-bullet-id] [role="button"]').first()).toHaveText(edited);
  await page.reload();
  await expect(page.locator('[data-bullet-id] [role="button"]').first()).toHaveText(edited);

  // 7. Export PDF
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');

  // 8. Log application (pre-filled from the editor)
  await page.getByRole('link', { name: 'Log application' }).click();
  await expect(page.getByRole('heading', { name: 'Log an application' })).toBeVisible();
  await expect(page.getByLabel('Company')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Log application' }).last().click();
  await expect(page.getByText(/1 application logged/)).toBeVisible();
  await expect(page.getByText(/Tailored v\d+/).first()).toBeVisible();

  // 9. Admin pages are restricted to ADMIN_EMAILS (this test user isn't one).
  await page.goto('/admin/runs');
  await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
});
