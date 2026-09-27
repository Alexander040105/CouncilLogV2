import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const EMAIL = process.env.E2E_EMAIL ?? 'dev-owner@councilog.test';
const PASS = process.env.E2E_PASS ?? 'TestPass_2026!';

// Logs in through the real UI once; downstream projects reuse the session.
test('authenticate dev user', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true });
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in/i }).click();
  // org-less users get pushed to /onboarding — both outcomes mean auth worked
  await page.waitForURL(/\/(onboarding)?$/, { timeout: 30_000 });
  await expect(page.locator('text=CounciLog').first()).toBeVisible({ timeout: 15_000 });
  // Wait for AppShell to persist the active org — saved into storageState so
  // downstream tests never read a null org id.
  await page.waitForFunction(
    () => !!localStorage.getItem('councilog.orgId') || location.pathname === '/onboarding',
    { timeout: 15_000 });
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
