// Shared Discord webhook helpers, sibling of lib/slack.js. A Discord webhook
// URL is https://discord.com/api/webhooks/{id}/{token} — the id is a numeric
// snowflake and the token is a bearer secret, so validation pins the host and
// shape, and masking keeps only the last4 of the token. The frontend validator
// in js/utils.js intentionally mirrors this — keep the two in sync.

const DISCORD_WEBHOOK_PREFIXES = [
  'https://discord.com/api/webhooks/',
  'https://discordapp.com/api/webhooks/', // legacy domain still issued by old servers
];

// Only accept the canonical Discord webhook shape: a pinned prefix plus
// exactly {numeric id}/{token}. Refusing arbitrary outbound URLs prevents an
// attacker pasting an internal URL to scan our outbound network.
function isValidDiscordWebhook(url) {
  if (typeof url !== 'string') return false;
  const prefix = DISCORD_WEBHOOK_PREFIXES.find(p => url.startsWith(p));
  if (!prefix) return false;
  const parts = url.slice(prefix.length).split('/');
  if (parts.length !== 2) return false;
  const [id, token] = parts;
  return /^\d{1,30}$/.test(id) && token.length > 0 && token.length < 200 && !token.includes('?');
}

// Returns just the host + last4 of the token so log lines are debuggable
// without leaking the webhook.
function maskDiscordWebhook(url) {
  if (!url) return '(none)';
  if (!isValidDiscordWebhook(url)) return '(invalid)';
  const token = url.slice(url.lastIndexOf('/') + 1);
  const tail = token.length > 4 ? token.slice(-4) : token;
  return `discord.com/api/webhooks/...${tail}`;
}

module.exports = { DISCORD_WEBHOOK_PREFIXES, isValidDiscordWebhook, maskDiscordWebhook };
