const crypto = require('crypto');
const log = require('../lib/logger');
const { updateNotificationWebhook } = require('../services/firestore');

/**
 * Verify Svix HMAC-SHA256 webhook signatures (standard for Resend webhooks).
 *
 * @param {string} rawBody
 * @param {Object} headers
 * @param {string} secret
 * @returns {boolean}
 */
function verifySvixSignature(rawBody, headers, secret) {
  if (!secret) return false;
  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Protect against replay attacks (5 min tolerance)
  const ts = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return false;
  }

  // Svix secrets typically start with "whsec_" and are base64-encoded
  let keyBuffer;
  if (secret.startsWith('whsec_')) {
    keyBuffer = Buffer.from(secret.slice(6), 'base64');
  } else {
    keyBuffer = Buffer.from(secret, 'utf8');
  }

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const computed = crypto.createHmac('sha256', keyBuffer).update(toSign).digest('base64');

  // svix-signature may contain multiple space-delimited signatures (e.g. "v1,abc v1,def")
  const signatures = String(svixSignature).split(' ');
  for (const sig of signatures) {
    const [version, hash] = sig.split(',');
    if (version === 'v1' && hash) {
      const computedBuf = Buffer.from(computed);
      const hashBuf = Buffer.from(hash);
      if (computedBuf.length === hashBuf.length && crypto.timingSafeEqual(computedBuf, hashBuf)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * POST /api/webhooks/resend
 * Ingests delivery, open, click, bounce, and complaint events from Resend.
 */
async function resendWebhookHandler(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

  if (secret) {
    const isValid = verifySvixSignature(rawBody, req.headers, secret);
    if (!isValid) {
      log.warn('resend-webhook: invalid signature', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  } else if (process.env.NODE_ENV !== 'test') {
    log.warn('resend-webhook: received event but RESEND_WEBHOOK_SECRET is not configured');
  }

  let payload;
  try {
    payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody);
  } catch (err) {
    log.warn('resend-webhook: invalid JSON payload', { error: err.message });
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const { type, data } = payload || {};
  const emailId = data?.email_id;

  if (!emailId || !type) {
    return res.status(200).json({ received: true, ignored: true });
  }

  log.info('resend-webhook: processing event', { type, emailId });
  try {
    await updateNotificationWebhook(emailId, type, data);
    res.json({ received: true });
  } catch (err) {
    log.error('resend-webhook: failed processing event', { emailId, type, error: err.message });
    res.status(500).json({ error: 'Failed to process webhook' });
  }
}

module.exports = {
  resendWebhookHandler,
  verifySvixSignature,
};
