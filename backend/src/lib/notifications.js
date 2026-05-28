const log = require('./logger');

// Fire-and-forget POST to a webhook (Slack, Discord, Zapier, custom).
// Configured via SIGNUP_WEBHOOK_URL env var. Silent no-op if unset.
async function sendSignupWebhook({ email, displayName, domain, acquisitionSource, totalUsers }) {
  const url = process.env.SIGNUP_WEBHOOK_URL;
  if (!url) return;

  // Slack-compatible payload. Most webhook services (Slack, Discord, Zapier)
  // accept a plain `text` field; richer fields are ignored by the ones that
  // don't understand them.
  const sourceLine = acquisitionSource ? ` _(via ${acquisitionSource})_` : '';
  const text = `🎉 New Attendance Tracker user: *${displayName || email}* <${email}>${sourceLine}\nDomain: ${domain} · Total users now: ${totalUsers ?? '?'}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, email, displayName, domain, acquisitionSource, totalUsers }),
    });
    if (!res.ok) {
      log.warn('signup webhook returned non-2xx', { status: res.status });
    } else {
      log.info('signup webhook sent', { email, domain });
    }
  } catch (err) {
    log.warn('signup webhook failed', { error: err.message });
  }
}

module.exports = { sendSignupWebhook };
