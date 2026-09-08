// Shared Google Chat incoming-webhook helpers, sibling of lib/slack.js.
// A Chat webhook URL carries its secrets in the query string (?key=…&token=…)
// rather than the path, so validation parses the URL instead of counting path
// segments. Same contract as slack.js: validate on input (before we store or
// POST), mask on output (before it hits a log line). The frontend validator in
// js/utils.js intentionally mirrors this — keep the two in sync.

const CHAT_WEBHOOK_PREFIX = 'https://chat.googleapis.com/v1/spaces/';

// Only accept the canonical Chat incoming-webhook shape: fixed host + a
// /v1/spaces/{space}/messages path + non-empty bounded key and token query
// params. Refusing arbitrary outbound URLs prevents an attacker pasting an
// internal URL to scan our outbound network.
function isValidGoogleChatWebhook(url) {
  if (typeof url !== 'string' || url.length > 1000) return false;
  if (!url.startsWith(CHAT_WEBHOOK_PREFIX)) return false;
  // The prefix check guarantees a parseable scheme+host, so URL() can't throw.
  const parsed = new URL(url);
  if (!/^\/v1\/spaces\/[^/]{1,200}\/messages$/.test(parsed.pathname)) return false;
  const key = parsed.searchParams.get('key');
  const token = parsed.searchParams.get('token');
  return !!(key && token && key.length < 200 && token.length < 200);
}

// Returns just the host + last4 of the token so log lines are debuggable
// without leaking the webhook.
function maskGoogleChatWebhook(url) {
  if (!url) return '(none)';
  if (!isValidGoogleChatWebhook(url)) return '(invalid)';
  const token = new URL(url).searchParams.get('token');
  const tail = token.length > 4 ? token.slice(-4) : token;
  return `chat.googleapis.com/...${tail}`;
}

module.exports = { CHAT_WEBHOOK_PREFIX, isValidGoogleChatWebhook, maskGoogleChatWebhook };
