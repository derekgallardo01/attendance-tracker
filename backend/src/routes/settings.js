const { Router } = require('express');
const log = require('../lib/logger');
const { getUserSettings, updateUserSettings } = require('../services/firestore');
const { sendSlackTestPing, maskSlackWebhook } = require('../lib/notifications');

const router = Router();

// Webhook URLs are bearer-token secrets. Only let us POST to the actual
// Slack webhook hostname — refusing arbitrary outbound URLs prevents an
// attacker from pasting an internal URL to scan our outbound network.
const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/services/';
function isValidSlackWebhook(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith(SLACK_WEBHOOK_PREFIX)) return false;
  const rest = url.slice(SLACK_WEBHOOK_PREFIX.length);
  const parts = rest.split('/');
  return parts.length === 3 && parts.every(p => p.length > 0 && p.length < 200);
}

// Mask the webhook on read so it's not echoed back to the page in plain
// text. The frontend stores the user input locally during the modal
// session; once saved, the user only sees the masked form.
function maskForApi(url) {
  if (!url) return null;
  const masked = maskSlackWebhook(url);
  return masked === '(invalid)' || masked === '(none)' ? null : masked;
}

// GET /api/settings — current user's settings (masked for readback).
router.get('/settings', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  try {
    const settings = await getUserSettings(req.user.domain, req.user.email);
    res.json({
      slackWebhookConfigured: !!settings.slackWebhookUrl,
      slackWebhookMasked: maskForApi(settings.slackWebhookUrl),
    });
  } catch (err) {
    log.warn('settings: get failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings — accept a patch. Currently only `slackWebhookUrl`.
// Pass null/empty to clear the webhook.
router.put('/settings', async (req, res) => {
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  const { slackWebhookUrl } = req.body || {};

  // Build the patch. Empty string / null = clear.
  const patch = {};
  if (slackWebhookUrl === null || slackWebhookUrl === '') {
    patch.slackWebhookUrl = null;
  } else if (typeof slackWebhookUrl === 'string') {
    if (!isValidSlackWebhook(slackWebhookUrl)) {
      return res.status(400).json({ error: 'Slack webhook URL must start with https://hooks.slack.com/services/ and have 3 path segments.' });
    }
    patch.slackWebhookUrl = slackWebhookUrl;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No supported settings in the request body.' });
  }

  try {
    await updateUserSettings(req.user.domain, req.user.email, patch);
    res.json({ saved: true });
  } catch (err) {
    log.error('settings: put failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST /api/settings/test-slack — send the test ping to the user's
// configured webhook (or one supplied in the body for pre-save testing).
router.post('/settings/test-slack', async (req, res) => {
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  let webhookUrl = req.body?.slackWebhookUrl;
  // If not supplied, use what's saved
  if (!webhookUrl) {
    const settings = await getUserSettings(req.user.domain, req.user.email);
    webhookUrl = settings.slackWebhookUrl;
  }
  if (!webhookUrl) {
    return res.status(400).json({ error: 'No Slack webhook URL provided or saved.' });
  }
  if (!isValidSlackWebhook(webhookUrl)) {
    return res.status(400).json({ error: 'Invalid Slack webhook URL.' });
  }
  const result = await sendSlackTestPing({ webhookUrl });
  if (!result.sent) {
    return res.status(502).json({ error: 'Slack rejected the test ping.', details: result });
  }
  res.json({ sent: true });
});

module.exports = router;
