const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const log = require('../lib/logger');
const { getUserSettings, updateUserSettings, isEmailSuppressed, suppressEmail, unsuppressEmail } = require('../services/firestore');
const { sendSlackTestPing } = require('../lib/notifications');
const { isValidSlackWebhook, maskSlackWebhook } = require('../lib/slack');

const router = Router();

// Mask the webhook on read so it's not echoed back to the page in plain
// text. The frontend stores the user input locally during the modal
// session; once saved, the user only sees the masked form.
function maskForApi(url) {
  if (!url) return null;
  const masked = maskSlackWebhook(url);
  return masked === '(invalid)' || masked === '(none)' ? null : masked;
}

// GET /api/settings — current user's settings (masked for readback). Includes
// device-synced preferences (autoExportOnEnd) and the email opt-out state.
router.get('/settings', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const [settings, suppressed] = await Promise.all([
      getUserSettings(req.user.domain, req.user.email),
      isEmailSuppressed(req.user.email),
    ]);
    res.json({
      slackWebhookConfigured: !!settings.slackWebhookUrl,
      slackWebhookMasked: maskForApi(settings.slackWebhookUrl),
      autoExportOnEnd: settings.autoExportOnEnd === true,
      emailOptOut: suppressed,
    });
  } catch (err) {
    log.error('settings: get failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT /api/settings — accept a patch of any supported settings:
//   slackWebhookUrl  — validated Slack incoming-webhook URL (null/'' clears)
//   autoExportOnEnd  — boolean, synced across the user's devices
//   emailOptOut      — boolean, toggles the CAN-SPAM suppression record
router.put('/settings', requireAuth, async (req, res) => {
  const body = req.body || {};
  const { slackWebhookUrl, autoExportOnEnd, emailOptOut } = body;

  const patch = {};
  if ('slackWebhookUrl' in body) {
    if (slackWebhookUrl === null || slackWebhookUrl === '') {
      patch.slackWebhookUrl = null;
    } else if (typeof slackWebhookUrl === 'string') {
      if (!isValidSlackWebhook(slackWebhookUrl)) {
        return res.status(400).json({ error: 'Slack webhook URL must start with https://hooks.slack.com/services/ and have 3 path segments.' });
      }
      patch.slackWebhookUrl = slackWebhookUrl;
    } else {
      return res.status(400).json({ error: 'slackWebhookUrl must be a string or null.' });
    }
  }
  if ('autoExportOnEnd' in body) {
    if (typeof autoExportOnEnd !== 'boolean') {
      return res.status(400).json({ error: 'autoExportOnEnd must be a boolean.' });
    }
    patch.autoExportOnEnd = autoExportOnEnd;
  }

  const hasEmailOptOut = 'emailOptOut' in body;
  if (hasEmailOptOut && typeof emailOptOut !== 'boolean') {
    return res.status(400).json({ error: 'emailOptOut must be a boolean.' });
  }

  if (Object.keys(patch).length === 0 && !hasEmailOptOut) {
    return res.status(400).json({ error: 'No supported settings in the request body.' });
  }

  try {
    if (Object.keys(patch).length > 0) {
      await updateUserSettings(req.user.domain, req.user.email, patch);
    }
    // Email opt-out lives in the cross-tenant suppression collection (the same
    // one the unsubscribe link writes) so a single toggle governs all lifecycle
    // mail regardless of which tenant the user signs in from.
    if (hasEmailOptOut) {
      if (emailOptOut) await suppressEmail(req.user.email, { source: 'settings_toggle' });
      else await unsuppressEmail(req.user.email);
    }
    res.json({ saved: true });
  } catch (err) {
    log.error('settings: put failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// POST /api/settings/test-slack — send the test ping to the user's
// configured webhook (or one supplied in the body for pre-save testing).
router.post('/settings/test-slack', requireAuth, async (req, res) => {
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
