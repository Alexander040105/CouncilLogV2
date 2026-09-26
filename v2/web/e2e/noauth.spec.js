import { test, expect } from '@playwright/test';

// Flows that must work without a session.
test('invalid credentials show an error, not a silent failure', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('nobody@councilog.test');
  await page.getByLabel(/password/i).fill('wrong-password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.locator('text=/invalid|error|incorrect/i').first())
    .toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/login/);
});

test('forgot-password form accepts an email and shows next step', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /forgot password/i }).click();
  // .test TLDs are rejected by Supabase email validation — use a real TLD
  await page.getByLabel(/email/i).fill('dev.owner.e2e@gmail.com');
  await page.getByRole('button', { name: /send reset link/i }).click();
  // Supabase always accepts the request — we only verify the UI confirms it
  await expect(page.locator('text=/check your email/i')).toBeVisible({ timeout: 15_000 });
});

test('logged-out deep link bounces to login', async ({ page }) => {
  await page.goto('/documents');
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});
