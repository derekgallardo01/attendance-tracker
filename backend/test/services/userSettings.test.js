// Tests for getUserSettings + updateUserSettings — the per-user settings
// store backing the Slack webhook integration.

const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

describe('getUserSettings', () => {
  test('returns empty object when no settings doc exists', async () => {
    const settings = await firestore.getUserSettings('a.com', 'u@a.com');
    expect(settings).toEqual({});
  });

  test('returns saved settings', async () => {
    ctx.seed('tenants/a.com/userSettings/u@a.com', {
      slackWebhookUrl: 'https://hooks.slack.com/services/T1/B1/secret',
    });
    const settings = await firestore.getUserSettings('a.com', 'u@a.com');
    expect(settings.slackWebhookUrl).toBe('https://hooks.slack.com/services/T1/B1/secret');
  });

  test('lowercases email for lookup', async () => {
    ctx.seed('tenants/a.com/userSettings/mixed@a.com', { slackWebhookUrl: 'x' });
    const settings = await firestore.getUserSettings('a.com', 'Mixed@A.COM');
    expect(settings.slackWebhookUrl).toBe('x');
  });
});

describe('updateUserSettings', () => {
  test('creates the doc on first call', async () => {
    await firestore.updateUserSettings('a.com', 'u@a.com', {
      slackWebhookUrl: 'https://hooks.slack.com/services/T1/B1/x',
    });
    const settings = await firestore.getUserSettings('a.com', 'u@a.com');
    expect(settings.slackWebhookUrl).toBe('https://hooks.slack.com/services/T1/B1/x');
  });

  test('merges (preserves other fields) on subsequent calls', async () => {
    ctx.seed('tenants/a.com/userSettings/u@a.com', {
      slackWebhookUrl: 'https://hooks.slack.com/services/T1/B1/old',
      someOtherField: 'preserved',
    });
    await firestore.updateUserSettings('a.com', 'u@a.com', {
      slackWebhookUrl: 'https://hooks.slack.com/services/T2/B2/new',
    });
    const settings = await firestore.getUserSettings('a.com', 'u@a.com');
    expect(settings.slackWebhookUrl).toBe('https://hooks.slack.com/services/T2/B2/new');
    expect(settings.someOtherField).toBe('preserved');
  });

  test('clears webhook when set to null (intentional unsubscribe)', async () => {
    ctx.seed('tenants/a.com/userSettings/u@a.com', {
      slackWebhookUrl: 'https://hooks.slack.com/services/T1/B1/x',
    });
    await firestore.updateUserSettings('a.com', 'u@a.com', { slackWebhookUrl: null });
    const settings = await firestore.getUserSettings('a.com', 'u@a.com');
    expect(settings.slackWebhookUrl).toBeNull();
  });

  test('returns { saved: true } on success', async () => {
    const result = await firestore.updateUserSettings('a.com', 'u@a.com', { slackWebhookUrl: 'x' });
    expect(result.saved).toBe(true);
  });
});
