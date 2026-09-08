const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const log = require('../lib/logger');
const { getUserSettings, updateUserSettings, setPostExportSurvey, isEmailSuppressed, suppressEmail, unsuppressEmail } = require('../services/firestore');
const { sendSlackTestPing, sendChatTestPing, sendDiscordTestPing } = require('../lib/notifications');
const { isValidSlackWebhook, maskSlackWebhook } = require('../lib/slack');
const { isValidGoogleChatWebhook, maskGoogleChatWebhook } = require('../lib/googleChat');
const { isValidDiscordWebhook, maskDiscordWebhook } = require('../lib/discord');

const router = Router();

// One entry per webhook integration. `field` is both the userSettings doc key
// and the PUT body key; `provider` is the id the frontend passes to
// POST /settings/test-webhook. Adding an integration = adding a row here
// (plus its lib validator + notifications sender).
const WEBHOOK_PROVIDERS = [
  {
    field: 'slackWebhookUrl', provider: 'slack', label: 'Slack',
    isValid: isValidSlackWebhook, mask: maskSlackWebhook, testPing: sendSlackTestPing,
    invalidMsg: 'Slack webhook URL must start with https://hooks.slack.com/services/ and have 3 path segments.',
  },
  {
    field: 'googleChatWebhookUrl', provider: 'googleChat', label: 'Google Chat',
    isValid: isValidGoogleChatWebhook, mask: maskGoogleChatWebhook, testPing: sendChatTestPing,
    invalidMsg: 'Google Chat webhook URL must look like https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…',
  },
  {
    field: 'discordWebhookUrl', provider: 'discord', label: 'Discord',
    isValid: isValidDiscordWebhook, mask: maskDiscordWebhook, testPing: sendDiscordTestPing,
    invalidMsg: 'Discord webhook URL must look like https://discord.com/api/webhooks/{id}/{token}',
  },
];

// Mask the webhook on read so it's not echoed back to the page in plain
// text. The frontend stores the user input locally during the modal
// session; once saved, the user only sees the masked form.
function maskForApi(url, mask) {
  if (!url) return null;
  const masked = mask(url);
  // The mask fns only return '(none)' for a falsy URL, which the guard
  // above already handled — so that half of the check never fires here.
  /* istanbul ignore next */
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
    const out = {
      autoExportOnEnd: settings.autoExportOnEnd === true,
      emailOptOut: suppressed,
      digestExtraEmails: Array.isArray(settings.digestExtraEmails) ? settings.digestExtraEmails : [],
    };
    for (const p of WEBHOOK_PROVIDERS) {
      // e.g. slackWebhookConfigured / slackWebhookMasked
      const base = p.field.replace(/Url$/, '');
      out[`${base}Configured`] = !!settings[p.field];
      out[`${base}Masked`] = maskForApi(settings[p.field], p.mask);
    }
    res.json(out);
  } catch (err) {
    log.error('settings: get failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Additional report recipients (co-teacher, coordinator, admin inbox).
// Bounded + syntax-checked; kept deliberately simple — the export email
// send re-checks each address against the suppression list at send time.
const MAX_EXTRA_EMAILS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function normalizeExtraEmails(value) {
  if (value === null || (Array.isArray(value) && value.length === 0)) return { ok: true, emails: null };
  if (!Array.isArray(value)) return { ok: false };
  if (value.length > MAX_EXTRA_EMAILS) return { ok: false };
  const emails = [];
  for (const v of value) {
    if (typeof v !== 'string') return { ok: false };
    const e = v.trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254) return { ok: false };
    if (!emails.includes(e)) emails.push(e);
  }
  return { ok: true, emails: emails.length ? emails : null };
}

// PUT /api/settings — accept a patch of any supported settings:
//   slackWebhookUrl / googleChatWebhookUrl / discordWebhookUrl
//                    — validated incoming-webhook URLs (null/'' clears)
//   autoExportOnEnd  — boolean, synced across the user's devices
//   emailOptOut      — boolean, toggles the CAN-SPAM suppression record
//   digestExtraEmails — up to 5 extra addresses that also receive the
//                       post-export report email (null/[] clears)
router.put('/settings', requireAuth, async (req, res) => {
  /* istanbul ignore next: express.json always sets req.body to an object */
  const body = req.body || {};
  const { autoExportOnEnd, emailOptOut } = body;

  const patch = {};
  if ('digestExtraEmails' in body) {
    const norm = normalizeExtraEmails(body.digestExtraEmails);
    if (!norm.ok) {
      return res.status(400).json({ error: `digestExtraEmails must be up to ${MAX_EXTRA_EMAILS} valid email addresses (or null to clear).` });
    }
    patch.digestExtraEmails = norm.emails;
  }
  for (const p of WEBHOOK_PROVIDERS) {
    if (!(p.field in body)) continue;
    const value = body[p.field];
    if (value === null || value === '') {
      patch[p.field] = null;
    } else if (typeof value === 'string') {
      if (!p.isValid(value)) {
        return res.status(400).json({ error: p.invalidMsg });
      }
      patch[p.field] = value;
    } else {
      return res.status(400).json({ error: `${p.field} must be a string or null.` });
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

// Shared test-ping handler: use the supplied URL, else the saved one; send
// the provider's test ping and surface the result.
async function handleTestPing(req, res, p) {
  let webhookUrl = req.body?.[p.field];
  // If not supplied, use what's saved
  if (!webhookUrl) {
    const settings = await getUserSettings(req.user.domain, req.user.email);
    webhookUrl = settings[p.field];
  }
  if (!webhookUrl) {
    return res.status(400).json({ error: `No ${p.label} webhook URL provided or saved.` });
  }
  if (!p.isValid(webhookUrl)) {
    return res.status(400).json({ error: `Invalid ${p.label} webhook URL.` });
  }
  const result = await p.testPing({ webhookUrl });
  if (!result.sent) {
    return res.status(502).json({ error: `${p.label} rejected the test ping.`, details: result });
  }
  res.json({ sent: true });
}

// POST /api/settings/test-webhook — send a test ping for any provider:
// body { provider: 'slack' | 'googleChat' | 'discord', <field>?: url }.
router.post('/settings/test-webhook', requireAuth, async (req, res) => {
  const p = WEBHOOK_PROVIDERS.find(w => w.provider === req.body?.provider);
  if (!p) {
    return res.status(400).json({ error: 'provider must be one of: ' + WEBHOOK_PROVIDERS.map(w => w.provider).join(', ') });
  }
  await handleTestPing(req, res, p);
});

// POST /api/settings/test-slack — legacy alias kept so panels served before
// the multi-provider rollout keep working.
router.post('/settings/test-slack', requireAuth, async (req, res) => {
  await handleTestPing(req, res, WEBHOOK_PROVIDERS[0]);
});

// POST /api/user/survey — one-question post-export micro-survey
router.post('/user/survey', requireAuth, async (req, res) => {
  try {
    const { useCase, detail } = req.body || {};
    if (!useCase) return res.status(400).json({ error: 'useCase is required' });
    await setPostExportSurvey(req.user.domain, req.user.email, { useCase: String(useCase).slice(0, 50), detail: String(detail || '').slice(0, 200) });
    res.json({ success: true });
  } catch (err) {
    log.error('settings: survey failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save survey' });
  }
});

module.exports = router;
