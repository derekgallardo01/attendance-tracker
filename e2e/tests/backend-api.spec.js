// Production smoke tests for the Cloud Run backend. These hit the live URL
// and verify public endpoints respond correctly — no auth, no destructive
// writes (except a single feedback submission tagged as a smoke test, which
// we don't bother dedup'ing since one harmless email per CI run is fine).

const { test, expect } = require('@playwright/test');

const BACKEND = process.env.E2E_BACKEND_URL
  || 'https://attendance-tracker-backend-829771833968.us-central1.run.app';

test.describe('Backend health + public endpoints', () => {
  test('health check returns ok', async ({ request }) => {
    const res = await request.get(`${BACKEND}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('/api/public/stats returns org + meeting counts', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/public/stats`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.organizations).toBe('number');
    expect(typeof body.meetings).toBe('number');
  });

  test('/api/public/share/:token returns 404 for nonexistent token', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/public/share/nonexistent-token-xyz`);
    expect(res.status()).toBe(404);
  });

  test('/api/public/pageview accepts beacon (204)', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/public/pageview`, {
      data: { path: '/e2e-smoke', referrer: 'https://github.com/actions' },
    });
    expect(res.status()).toBe(204);
  });
});

test.describe('Auth enforcement on protected endpoints', () => {
  test('/api/team/overview returns 401 without Bearer token', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/team/overview`);
    expect([401, 403]).toContain(res.status());
  });

  test('/api/history returns 401 without Bearer token', async ({ request }) => {
    const res = await request.get(`${BACKEND}/api/history`);
    expect([401, 403]).toContain(res.status());
  });

  test('/api/admin/check-alerts returns 403 without scheduler secret', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/admin/check-alerts`, { data: {} });
    expect(res.status()).toBe(403);
  });
});

test.describe('Feedback submission round-trip', () => {
  // This actually sends an email via Resend. CI runs trigger one email per
  // commit on main — acceptable for the signal of "feedback path works end-to-end".
  test('/api/public/feedback accepts a smoke submission (200)', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/public/feedback`, {
      data: {
        body: `e2e-smoke-test: feedback path round-trip from CI at ${new Date().toISOString()}`,
        fromEmail: 'ci-smoke@attendancetracker.dev',
        fromName: 'CI Smoke Test',
        source: 'github_actions',
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('/api/public/feedback rejects empty body (400)', async ({ request }) => {
    const res = await request.post(`${BACKEND}/api/public/feedback`, {
      data: { body: '' },
    });
    expect(res.status()).toBe(400);
  });
});
