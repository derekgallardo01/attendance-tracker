// Mobile visual regression — verifies the @media (max-width: 640px) layouts
// for the auth-gated pages don't regress. Uses iPhone 13 dimensions, which
// is a sane "typical phone" target (390×844 portrait).

const { test, expect, devices } = require('@playwright/test');

// File-level use(): apply Pixel 5 device descriptor to every test in this
// spec so user-agent, DPR, viewport all match a real phone visit. Pixel 5
// chosen over iPhone 13 because iPhone uses WebKit (extra browser binary to
// install in CI); Pixel 5 uses Chromium, which is already provisioned.
test.use({ ...devices['Pixel 5'] });

test.describe('Visual regression — mobile login screens', () => {
  test('mobile: history.html login', async ({ page }) => {
    await page.goto('/history.html');
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('mobile-history-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('mobile: team.html login', async ({ page }) => {
    await page.goto('/team.html');
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('mobile-team-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('mobile: admin.html login', async ({ page }) => {
    await page.goto('/admin.html');
    await page.locator('#login-screen').waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('mobile-admin-login.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });

  test('mobile: landing page above-the-fold', async ({ page }) => {
    await page.goto('/');
    await page.locator('h2', { hasText: /Track Google Meet attendance/i }).waitFor({ timeout: 15_000 });
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('mobile-landing-above-fold.png', {
      fullPage: false,
      mask: [page.locator('#stat-orgs-public'), page.locator('#stat-meetings-public')],
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
    });
  });
});
