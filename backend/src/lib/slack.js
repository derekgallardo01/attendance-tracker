// Shared Slack incoming-webhook helpers. The webhook URL embeds a bearer-token
// secret in its path, so these two functions guard it end-to-end: validate on
// input (before we ever store or POST to it) and mask on output (before it hits
// a log line). Kept in one module so the backend has a single source of truth;
// the frontend (js/utils.js) intentionally mirrors the validator for pre-submit
// UX — keep the two contracts in sync.

const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/services/';

// Only accept the canonical Slack incoming-webhook shape: the fixed host prefix
// plus exactly 3 non-empty path segments. Refusing arbitrary outbound URLs
// prevents an attacker pasting an internal URL to scan our outbound network.
function isValidSlackWebhook(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith(SLACK_WEBHOOK_PREFIX)) return false;
  const rest = url.slice(SLACK_WEBHOOK_PREFIX.length);
  const parts = rest.split('/');
  return parts.length === 3 && parts.every(p => p.length > 0 && p.length < 200);
}

// Returns just the host + last4 of the secret so log lines are debuggable
// without leaking the webhook. Mirrors the frontend maskWebhookUrl helper.
function maskSlackWebhook(url) {
  if (!url) return '(none)';
  const m = url.match(/^https:\/\/hooks\.slack\.com\/services\/[^/]+\/[^/]+\/(.+)$/);
  if (!m) return '(invalid)';
  const tail = m[1].length > 4 ? m[1].slice(-4) : m[1];
  return `hooks.slack.com/...${tail}`;
}

module.exports = { SLACK_WEBHOOK_PREFIX, isValidSlackWebhook, maskSlackWebhook };
