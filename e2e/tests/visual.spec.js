// Visual regression tests using Playwright's built-in toHaveScreenshot.
// Snapshots live in tests/visual.spec.js-snapshots/ and are committed to git;
// any CSS or markup change that alters the rendered pixels will fail until
// the developer reviews the diff and runs `npm run update-snapshots`.
//
// Pages covered: home, share landing, 3 SEO content pages. Auth-gated pages
// (history, team, admin) intentionally excluded because they need a real
// signed-in session and would need fixture data — not worth it for visual
// regression on a low-traffic dashboard.

const { test, expect } = require('@playwright/test');

test.describe('Visual regression — public pages', () => {
  // Each test has a generous mask for the social-proof bar (numbers change
  // every time) and disables animations so the screenshot is stable.
  test.use({ viewport: { width: 1280, height: 800 } });

  test('homepage above-the-fold', async ({ page }) => {
    await page.goto('/');
    // Wait for the landing-page container to render
    await page.locator('h2', { hasText: /Track Google Meet attendance/i }).waitFor({ timeout: 15_000 });
    // Give font loading + the social-proof fetch a moment to settle
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('home-above-fold.png', {
      fullPage: false,
      // Mask the live stats numbers (will fluctuate run-to-run)
      mask: [page.locator('#stat-orgs-public'), page.locator('#stat-meetings-public')],
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('homepage full page', async ({ page }) => {
    await page.goto('/');
    await page.locator('h2', { hasText: /Track Google Meet attendance/i }).waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    // Close the feedback widget if it auto-opens for any reason
    const fb = page.locator('#fb-panel');
    if (await fb.isVisible()) await page.locator('#fb-toggle').click();

    await expect(page).toHaveScreenshot('home-full.png', {
      fullPage: true,
      mask: [page.locator('#stat-orgs-public'), page.locator('#stat-meetings-public')],
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('SEO page: how-to-track-attendance', async ({ page }) => {
    await page.goto('/how-to-track-attendance-in-google-meet.html');
    await page.locator('h1').waitFor();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('seo-how-to.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('SEO page: for-teachers', async ({ page }) => {
    await page.goto('/attendance-tracker-for-teachers.html');
    await page.locator('h1').waitFor();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('seo-for-teachers.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('SEO page: export-to-sheets', async ({ page }) => {
    await page.goto('/export-google-meet-attendance-to-sheets.html');
    await page.locator('h1').waitFor();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('seo-export-to-sheets.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('share.html no-token error state', async ({ page }) => {
    await page.goto('/share.html');
    await page.locator('text=link is no longer available').waitFor({ timeout: 15_000 });
    await expect(page).toHaveScreenshot('share-no-token.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('feedback widget — opened state', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fb-toggle').waitFor({ timeout: 15_000 });
    await page.locator('#fb-toggle').click();
    await page.locator('#fb-panel').waitFor();
    // Just the widget area, not the whole page
    await expect(page.locator('#fb-panel')).toHaveScreenshot('feedback-widget-open.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('settings modal — opened state', async ({ page }) => {
    // The modal lives inside #addon-ui (the signed-in side panel). On a
    // fresh visit the landing page shows and addon-ui is display:none, so
    // we have to unhide both. Tests modal MARKUP, not the open-flow.
    await page.goto('/');
    await page.locator('h2', { hasText: /Track Google Meet attendance/i }).waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      const landing = document.getElementById('landing-page');
      const addon = document.getElementById('addon-ui');
      const modal = document.getElementById('settings-modal');
      if (landing) landing.style.display = 'none';
      if (addon) addon.style.display = 'block';
      if (modal) modal.style.display = 'flex';
    });
    await page.locator('#settings-modal').waitFor({ state: 'visible' });
    // Screenshot just the modal-box so we don't have to baseline the
    // entire addon-ui underneath (which has dynamic empty-state content).
    await expect(page.locator('#settings-modal .modal-box').first()).toHaveScreenshot('settings-modal-open.png', {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
