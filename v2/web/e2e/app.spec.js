import { test, expect } from '@playwright/test';

// Every test runs as the dev-owner account from auth-setup.
// Collect console errors per page visit and assert the console stays clean.
function watchConsole(page, errors) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
}

const BENIGN = [/favicon/i, /DevTools/i, /vite.*hmr/i];

test('shell: nav, org switcher, dashboard render', async ({ page }) => {
  const errors = []; watchConsole(page, errors);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('#org-switcher')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Journal' })).toBeVisible();
  expect(errors.filter((e) => !BENIGN.some((b) => b.test(e)))).toEqual([]);
});

test('journal: compose → post → entry appears', async ({ page }) => {
  const errors = []; watchConsole(page, errors);
  await page.goto('/journal');
  await page.getByRole('button', { name: 'Log work' }).first().click();
  const desc = `E2E entry ${Date.now()}`;
  await page.getByPlaceholder(/Delivered concept paper/i).fill(desc);
  await page.getByRole('button', { name: /post entry/i }).click();
  await expect(page.locator(`text=${desc}`)).toBeVisible({ timeout: 20_000 });
  expect(errors.filter((e) => !BENIGN.some((b) => b.test(e)))).toEqual([]);
});

test('journal: offline submit surfaces an error instead of failing silently', async ({ page }) => {
  await page.goto('/journal');
  await page.getByRole('button', { name: 'Log work' }).first().click();
  await page.getByPlaceholder(/Delivered concept paper/i).fill('offline attempt');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: /post entry/i }).click();
  await expect(page.locator('text=/reach the server|timed out|connection/i').first())
    .toBeVisible({ timeout: 20_000 });
  await page.context().setOffline(false);
});

test('pages render: attendance, projects, documents, members, settings, account', async ({ page }) => {
  const errors = []; watchConsole(page, errors);
  const routes = [
    ['/attendance', 'Attendance'],
    ['/projects', 'Projects'],
    ['/documents', 'Papers'],
    ['/members', 'Members'],
    ['/settings', 'Settings'],
    ['/account', 'Account'],
  ];
  for (const [path, title] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, exact: true }).first())
      .toBeVisible({ timeout: 15_000 });
  }
  expect(errors.filter((e) => !BENIGN.some((b) => b.test(e)))).toEqual([]);
});

test('unknown route shows NotFound with a way back', async ({ page }) => {
  await page.goto('/totally-bogus-route');
  await expect(page.locator('text=/not found|doesn.t exist|lost/i').first())
    .toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('link', { name: /home|back|today/i }).first())
    .toBeVisible();
});

test('theme picker applies all four themes', async ({ page }) => {
  await page.goto('/account');
  const picker = page.getByLabel('Theme').first();
  for (const t of ['brutalist-dark', 'dark', 'light', 'brutalist-light']) {
    await picker.selectOption(t);
    await expect(page.locator('html')).toHaveAttribute('data-theme', t);
  }
});
