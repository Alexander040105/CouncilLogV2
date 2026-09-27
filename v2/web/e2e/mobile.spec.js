import { test, expect } from '@playwright/test';

// 360×800 viewport (set in playwright.config.js project 'mobile-360').
const PAGES = [
  '/', '/journal', '/attendance', '/projects',
  '/documents', '/members', '/settings', '/account',
];

test('no horizontal overflow on any page at 360px', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});

test('bottom tab bar visible + More sheet opens', async ({ page }) => {
  await page.goto('/');
  const more = page.getByRole('button', { name: 'More' });
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.getByRole('dialog').getByText('Organization')).toBeVisible();
});

test('sheets fit the viewport at 360px', async ({ page }) => {
  await page.goto('/journal');
  await page.getByRole('button', { name: 'Log work' }).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box.width).toBeLessThanOrEqual(360);
});
