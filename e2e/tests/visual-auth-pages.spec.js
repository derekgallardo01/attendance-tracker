// Visual regression for the LOGIN-SCREEN state of every auth-gated page.
// We can't easily screenshot the signed-in dashboards (would need a real
// session + fixture data), but the pre-login screens are public surface
// area we ship and should not regress without intention.

const { test, expect } = require('@playwright/test');

test.describe('Visual regression — auth-gated page login screens', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('history.html login screen', async ({ page }) => {
    await page.goto('/history.html');
    // The page should render the login screen because no session cookie/token
    // is set in this fresh browser context.
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('history-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('team.html login screen', async ({ page }) => {
    await page.goto('/team.html');
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('team-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('admin.html login screen', async ({ page }) => {
    await page.goto('/admin.html');
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('admin-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
