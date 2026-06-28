// Smoke tests for the marketing landing page. Catches the "deploy broke the
// site" / "GitHub Pages didn't rebuild" / "Cloud Run is down" class of bugs.

const { test, expect } = require('@playwright/test');

test.describe('Landing page (attendancetracker.dev)', () => {
  test('loads with the hero headline + Install CTA', async ({ page }) => {
    await page.goto('/');
    // SDK detection bails after a short timeout when not in Meet; landing
    // page renders. Wait for the headline.
    await expect(page.locator('h2', { hasText: /Track Google Meet attendance/i })).toBeVisible({ timeout: 15_000 });
    const installButton = page.locator('a:has-text("Install from Marketplace")').first();
    await expect(installButton).toBeVisible();
    await expect(installButton).toHaveAttribute('href', /workspace\.google\.com\/marketplace/);
  });

  test('social proof bar shows numbers (live or fallback)', async ({ page }) => {
    await page.goto('/');
    const orgsCount = page.locator('#stat-orgs-public');
    await expect(orgsCount).toBeVisible({ timeout: 15_000 });
    // Should never be the "—" placeholder — fallback "18+" kicks in if API fails
    await expect(orgsCount).not.toHaveText('—', { timeout: 15_000 });
  });

  test('SEO meta tags are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /Attendance Tracker/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://attendancetracker.dev/');
  });

  test('feedback widget button is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#fb-toggle')).toBeVisible({ timeout: 15_000 });
  });

  test('"Read more" footer links to all three SEO pages', async ({ page }) => {
    await page.goto('/');
    await page.locator('a[href$="how-to-track-attendance-in-google-meet.html"]').first().waitFor();
    await expect(page.locator('a[href$="attendance-tracker-for-teachers.html"]').first()).toBeVisible();
    await expect(page.locator('a[href$="export-google-meet-attendance-to-sheets.html"]').first()).toBeVisible();
  });
});

test.describe('SEO content pages', () => {
  const pages = [
    { path: '/how-to-track-attendance-in-google-meet.html', h1: /How to track attendance/i },
    { path: '/attendance-tracker-for-teachers.html', h1: /attendance tracker for teachers/i },
    { path: '/export-google-meet-attendance-to-sheets.html', h1: /Export Google Meet attendance to Google Sheets/i },
  ];
  for (const { path, h1 } of pages) {
    test(`${path} renders with H1 + Install CTA`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('h1', { hasText: h1 })).toBeVisible();
      await expect(page.locator('a:has-text("Install from Marketplace")').first()).toBeVisible();
    });
  }
});

test.describe('Static assets', () => {
  test('sitemap.xml is served and lists all 7 pages', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('how-to-track-attendance-in-google-meet.html');
    expect(body).toContain('attendance-tracker-for-teachers.html');
    expect(body).toContain('export-google-meet-attendance-to-sheets.html');
  });

  test('robots.txt is served and points at sitemap', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('Sitemap: https://attendancetracker.dev/sitemap.xml');
  });

  test('share.html (without token) renders the "link not available" error', async ({ page }) => {
    await page.goto('/share.html');
    await expect(page.locator('text=link is no longer available').first()).toBeVisible({ timeout: 15_000 });
  });
});
