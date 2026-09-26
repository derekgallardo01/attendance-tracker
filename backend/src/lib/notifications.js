const crypto = require('crypto');
const { Resend } = require('resend');
const log = require('./logger');
const CONFIG = require('../config');
const { maskSlackWebhook } = require('./slack');
const { maskGoogleChatWebhook } = require('./googleChat');
const { maskDiscordWebhook } = require('./discord');
const { escapeHtml: escape } = require('./html');

// Resend transactional email — better deliverability + open/click tracking
// than Gmail SMTP, and the API doesn't have Gmail's 500/day cap.
// Lazy init so boot doesn't fail when RESEND_API_KEY isn't set yet.
let cachedResend = null;
function getResend() {
  if (cachedResend) return cachedResend;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  cachedResend = new Resend(apiKey);
  return cachedResend;
}

// Build the From address. Until RESEND_FROM_DOMAIN is set (user has verified
// their domain in Resend), fall back to onboarding@resend.dev which Resend
// allows for any account without DNS. The display name still appears
// correctly in the recipient's inbox either way.
function makeFrom(displayName) {
  const domain = process.env.RESEND_FROM_DOMAIN;
  if (!domain) return `${displayName} <onboarding@resend.dev>`;
  const localpart = process.env.RESEND_FROM_LOCAL || 'hello';
  return `${displayName} <${localpart}@${domain}>`;
}

// Where replies go. GMAIL_USER stays around as the "owner inbox" — anyone who
// replies to a re-engagement or feedback email lands here, regardless of
// what the actual sending domain is.
function ownerEmail() {
  return process.env.GMAIL_USER || process.env.NOTIFY_EMAIL || null;
}

const SPANISH_COUNTRIES = new Set([
  'CO', 'MX', 'ES', 'AR', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU',
  'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR',
]);
const PORTUGUESE_COUNTRIES = new Set(['BR', 'PT', 'AO', 'MZ']);
const BENGALI_COUNTRIES = new Set(['BD']);

// Resolves recipient's native language for localized drip/lifecycle emails.
// Evaluates explicit language preference -> user's country -> domain extension -> defaults to 'en'.
function resolveLanguage({ language, country, domain, email } = {}) {
  if (language && typeof language === 'string') {
    const l = language.trim().toLowerCase().split(/[-_]/)[0];
    if (['es', 'pt', 'bn'].includes(l)) return l;
  }
  const c = country && typeof country === 'string' ? country.trim().toUpperCase() : null;
  if (c) {
    if (SPANISH_COUNTRIES.has(c)) return 'es';
    if (PORTUGUESE_COUNTRIES.has(c)) return 'pt';
    if (BENGALI_COUNTRIES.has(c)) return 'bn';
  }
  const checkDomain = domain || (email && email.includes('@') ? email.split('@')[1] : null);
  if (checkDomain && typeof checkDomain === 'string') {
    const d = checkDomain.toLowerCase().trim();
    if (/\.(co|mx|es|ar|cl|pe|ve|ec|gt|bo|uy|cr|pa|sv|hn|ni|do|py)$/.test(d)) return 'es';
    if (/\.(br|pt)$/.test(d)) return 'pt';
    if (/\.bd$/.test(d)) return 'bn';
  }
  return 'en';
}

// 15s (was 8s): the race between a real delivery and this timer is what turns
// a delivered email into a duplicate (the timer wins → we "retry" tomorrow).
// A wider window makes that race rare; the timeout stays only to stop a truly
// hung call from blocking a fire-and-forget path.
const RESEND_TIMEOUT_MS = Number(process.env.RESEND_TIMEOUT_MS) || 15000;
const RESEND_TIMEOUT_MARKER = '__resend_timeout__';

// Single send wrapper. Mirrors nodemailer's sendMail signature so every call
// site is one-line changed. Throws on hard failure; callers decide whether
// to swallow (fire-and-forget) or surface (admin email, feedback). Tags get
// passed through to Resend for per-type delivery analytics.
async function send({ from, to, subject, text, html, replyTo, tags, headers }) {
  const resend = getResend();
  if (!resend) throw new Error('Resend not configured — set RESEND_API_KEY');
  const params = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  };
  if (replyTo) params.replyTo = replyTo;
  if (headers) params.headers = headers;
  // Every internal caller passes a tags array, so the no-tags branch is
  // defensive-only.
  /* istanbul ignore next */
  if (tags) params.tags = tags;
  // The Resend SDK does its own HTTP without an exposed timeout; race it so a
  // hung call can't block the request (or a fire-and-forget email path). Clear
  // the timer once the race settles so it doesn't dangle (and keep the process
  // alive) when the send wins.
  let timer;
  const result = await Promise.race([
    resend.emails.send(params),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${RESEND_TIMEOUT_MARKER} after ${RESEND_TIMEOUT_MS}ms`)), RESEND_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  if (result.error) {
    throw new Error(`Resend send failed: ${result.error.message || JSON.stringify(result.error)}`);
  }
  return { sent: true, id: result.data?.id };
}

// Format a whole-minute duration as "Nm" / "Nh Nm". Callers supply the empty
// value (email uses '—', Slack uses '').
function hm(min) {
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

// Send an already-built email + log the outcome. Collapses the identical
// try{ send } / log.info(sent) / catch{ log.warn(failed) } block repeated across
// every sender. `label` reproduces the prior per-sender log wording (e.g.
// 'signup notification' → "signup notification sent" / "… failed").
/* istanbul ignore next: every caller passes logMeta; the default is defensive */
async function dispatchEmail(params, label, logMeta = {}) {
  try {
    const info = await send(params);
    log.info(`${label} sent`, { to: params.to, ...logMeta });
    if (info && info.id) {
      try {
        const { recordNotificationLog } = require('../services/firestore');
        recordNotificationLog(info.id, {
          to: params.to,
          subject: params.subject,
          template: label,
          lang: logMeta.lang || 'en',
        });
      } catch (_) {}
    }
    return info;
  } catch (err) {
    // A TIMEOUT is ambiguous — Resend may have delivered after our timer
    // fired. Report it as sent-optimistic so sweeps DON'T release their dedup
    // claim and resend a duplicate tomorrow (duplicate email is the category's
    // top complaint; a rare under-send is the lesser evil). A definite Resend
    // error still returns {sent:false} → the sweep releases → retries.
    if (String(err.message || '').includes(RESEND_TIMEOUT_MARKER)) {
      log.warn(`${label} timed out (assuming delivered — not retrying)`, { to: params.to, ...logMeta });
      return { sent: true, timedOut: true };
    }
    log.warn(`${label} failed`, { to: params.to, error: err.message });
    return { sent: false, error: err.message };
  }
}

// POST JSON with a hard timeout so a hung Slack webhook can't block the request
// (or the export flow that fire-and-forgets it). Aborts after SLACK_TIMEOUT_MS.
const SLACK_TIMEOUT_MS = Number(process.env.SLACK_TIMEOUT_MS) || 5000;
async function postJsonWithTimeout(url, body, timeoutMs = SLACK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ── One-click unsubscribe (CAN-SPAM) ──────────────────────────────────────
// Every promotional / lifecycle email carries an unsubscribe link. The token is
// an HMAC of the recipient's email under a purpose-separated key (not the raw
// SESSION_SECRET, so it can't be conflated with the JWT/token-at-rest keys), so
// the endpoint can verify the request came from us without storing per-email
// tokens. verify accepts the legacy (bare-secret) token too, so unsubscribe
// links already in users' inboxes keep working after the key separation.
const UNSUBSCRIBE_KEY_LABEL = 'unsubscribe:v1';
function unsubscribeToken(email) {
  return crypto
    .createHmac('sha256', CONFIG.deriveSecret(UNSUBSCRIBE_KEY_LABEL))
    .update(String(email).toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function legacyUnsubscribeToken(email) {
  return crypto
    .createHmac('sha256', CONFIG.sessionSecret)
    .update(String(email).toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function tokenMatches(expected, token) {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  return tokenMatches(unsubscribeToken(email), token)
    || tokenMatches(legacyUnsubscribeToken(email), token);
}

function unsubscribeUrl(email) {
  const t = unsubscribeToken(email);
  return `${CONFIG.publicApiUrl}/public/unsubscribe?e=${encodeURIComponent(email)}&t=${t}`;
}

// RFC 8058 one-click unsubscribe headers — the Gmail/Yahoo bulk-sender
// requirement. The POST endpoint suppresses directly; the GET link in the
// footer shows a confirmation page (scanner-prefetch-proof).
function unsubscribeHeaders(email) {
  const url = unsubscribeUrl(email);
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

// Footer appended to lifecycle emails. Returns matching text + HTML fragments.
function unsubscribeFooter(email, lang = 'en') {
  const url = unsubscribeUrl(email);
  let optOutText = "Don't want these emails? Unsubscribe:";
  let optOutHtml = `Don't want these emails? <a href="${escape(url)}" style="color:#58a6ff;text-decoration:none;">Unsubscribe</a>.`;

  if (lang === 'es') {
    optOutText = "¿No deseas recibir estos correos? Cancelar suscripción:";
    optOutHtml = `¿No deseas recibir estos correos? <a href="${escape(url)}" style="color:#58a6ff;text-decoration:none;">Cancelar suscripción</a>.`;
  } else if (lang === 'pt') {
    optOutText = "Não deseja receber estes e-mails? Cancelar inscrição:";
    optOutHtml = `Não deseja receber estes e-mails? <a href="${escape(url)}" style="color:#58a6ff;text-decoration:none;">Cancelar inscrição</a>.`;
  } else if (lang === 'bn') {
    optOutText = "এই ইমেল আর পেতে চান না? আনসাবস্ক্রাইব করুন:";
    optOutHtml = `এই ইমেল আর পেতে চান না? <a href="${escape(url)}" style="color:#58a6ff;text-decoration:none;">আনসাবস্ক্রাইব করুন</a>.`;
  }

  return {
    text: `\n\n—\n${optOutText} ${url}`,
    html: `<p style="margin:24px 0 0;color:#8b949e;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${optOutHtml}</p>`,
  };
}

// ── Shared Design System Email Wrapper ────────────────────────────────────
// Attendance Tracker's signature dark UI theme:
// Background: #0d1117, Container: #161b22, Border: #30363d, Text: #e6edf3, Muted: #8b949e.
function buildDesignSystemEmail({
  badge = null,
  badgeType = 'info', // 'info' | 'error' | 'warning' | 'success'
  title = '',
  subtitle = '',
  contentHtml = '',
  ctaText = null,
  ctaUrl = null,
  ctaColor = 'green', // 'green' | 'blue'
  footerHtml = null,
}) {
  const badgeColors = {
    error: 'color:#f85149;background:rgba(248,81,73,0.12);border:1px solid rgba(248,81,73,0.3);',
    warning: 'color:#e3b341;background:rgba(227,179,65,0.12);border:1px solid rgba(227,179,65,0.3);',
    success: 'color:#4ade80;background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);',
    info: 'color:#58a6ff;background:rgba(88,166,255,0.12);border:1px solid rgba(88,166,255,0.25);',
  };
  const badgeStyle = badgeColors[badgeType] || badgeColors.info;
  const ctaBtnStyle = ctaColor === 'blue'
    ? 'background:#1f6feb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;display:inline-block;'
    : 'background:#238636;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;display:inline-block;';

  const defaultFooter = `Sent by Attendance Tracker &bull; <a href="https://attendancetracker.dev" style="color:#58a6ff;text-decoration:none;">attendancetracker.dev</a>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <style>
    body, table, td, p, a, span { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    @media only screen and (max-width: 580px) {
      .email-body { padding: 12px 6px !important; }
      .responsive-container { width: 100% !important; max-width: 100% !important; border-radius: 8px !important; }
      .email-header { padding: 14px 14px 12px !important; }
      .email-content { padding: 14px 12px !important; }
      .email-footer { padding: 12px 12px !important; }
      .brand-table, .brand-table tbody, .brand-table tr, .brand-logo-cell, .brand-badge-cell {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
      .brand-logo-cell {
        margin-bottom: 6px !important;
        text-align: left !important;
      }
      .brand-badge-cell {
        text-align: left !important;
        margin-bottom: 2px !important;
      }
      .brand-badge-pill {
        font-size: 10px !important;
        padding: 2px 7px !important;
        white-space: normal !important;
        display: inline-block !important;
        line-height: 1.35 !important;
      }
      .responsive-table td { padding: 8px 8px !important; font-size: 12px !important; }
      .touch-btn { display: inline-block !important; width: auto !important; max-width: 100% !important; text-align: center !important; padding: 9px 16px !important; font-size: 13px !important; line-height: 1.35 !important; box-sizing: border-box !important; vertical-align: middle !important; }
      .touch-btn-block { display: block !important; width: 100% !important; text-align: center !important; padding: 10px 16px !important; font-size: 13px !important; line-height: 1.35 !important; box-sizing: border-box !important; }
      .touch-btn-sm { display: inline-block !important; width: auto !important; max-width: 100% !important; text-align: center !important; padding: 7px 12px !important; font-size: 12px !important; line-height: 1.35 !important; box-sizing: border-box !important; }
      .plan-card { padding: 14px 12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#0d1117;">
  <div class="email-body" style="background-color:#0d1117;padding:24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3;box-sizing:border-box;">
    <div class="responsive-container" style="width:100%;max-width:600px;margin:0 auto;background-color:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden;box-sizing:border-box;">
      
      <!-- Brand Header -->
      <div class="email-header" style="padding:18px 20px 14px;border-bottom:1px solid #30363d;background:linear-gradient(180deg,#1c2128 0%,#161b22 100%);">
        <table class="brand-table" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:8px;">
          <tr>
            <td class="brand-logo-cell" align="left" valign="middle" style="vertical-align:middle;text-align:left;">
              <span style="font-size:13px;font-weight:700;color:#e6edf3;letter-spacing:0.02em;white-space:nowrap;">
                <span style="color:#4ade80;">✓</span> Attendance Tracker
              </span>
            </td>
            ${badge ? `<td class="brand-badge-cell" align="right" valign="middle" style="vertical-align:middle;text-align:right;">
              <span class="brand-badge-pill" style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:2px 8px;border-radius:10px;white-space:nowrap;display:inline-block;max-width:100%;box-sizing:border-box;line-height:1.4;${badgeStyle}">
                ${badge}
              </span>
            </td>` : ''}
          </tr>
        </table>
        ${title ? `<h2 style="margin:6px 0 4px;font-size:17px;font-weight:700;color:#e6edf3;word-break:break-word;">${title}</h2>` : ''}
        ${subtitle ? `<p style="margin:0;font-size:13px;color:#8b949e;line-height:1.4;word-break:break-word;">${subtitle}</p>` : ''}
      </div>

      <!-- Content -->
      <div class="email-content" style="padding:18px 20px;font-size:14px;line-height:1.6;color:#e6edf3;box-sizing:border-box;word-break:break-word;">
        ${contentHtml}
        ${ctaText && ctaUrl ? `
          <div style="margin-top:20px;">
            <a href="${escape(ctaUrl)}" class="touch-btn-block" style="${ctaBtnStyle}">
              ${escape(ctaText)}
            </a>
          </div>
        ` : ''}
      </div>

      <!-- Footer -->
      <div class="email-footer" style="padding:14px 20px;border-top:1px solid #21262d;background:#0d1117;font-size:12px;color:#8b949e;line-height:1.5;box-sizing:border-box;word-break:break-word;">
        ${footerHtml || defaultFooter}
      </div>

    </div>
  </div>
</body>
</html>`;
}

// Fire-and-forget signup notification email. Sends to NOTIFY_EMAIL (or the
// owner's inbox if NOTIFY_EMAIL isn't set). Silent no-op if Resend isn't
// configured.
//
// Two source signals, shown side by side because they legitimately differ:
//   - reportedSource: what the user told us via the "how did you find us?"
//     modal (strongest attribution signal). May be absent if dismissed.
//   - detectedSource: what we auto-derived at signup from UTM / referrer /
//     entry point. Users who enter through the in-Meet add-on have no web
//     referrer, so this is usually "direct" even when they found us via search.
// Legacy callers pass a single `acquisitionSource` — treat it as detected.
async function sendSignupWebhook({ email, displayName, domain, reportedSource, reportedDetail, detectedSource, acquisitionSource, totalUsers, signupIp, signupGeo }) {
  if (!getResend()) return;
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return;

  const reported = reportedSource || null;
  const detected = detectedSource || acquisitionSource || null;
  const primary = reported || detected; // best single label for the subject
  const sourceLine = primary ? ` (via ${primary})` : '';
  const subject = `🎉 New user: ${displayName || email}${sourceLine}`;

  const reportedText = reported
    ? `${reported}${reportedDetail ? ` — ${reportedDetail}` : ''}`
    : 'Not reported';
  const detectedText = detected || 'Unknown';

  const country = signupGeo?.country || null;
  const flag = country ? String.fromCodePoint(0x1F1E6 + country.toUpperCase().charCodeAt(0) - 65, 0x1F1E6 + country.toUpperCase().charCodeAt(1) - 65) + ' ' : '';
  const ipLine = signupIp
    ? `${flag}${signupIp}${country ? ` (${country})` : ''}`
    : 'Unknown';
  const ipLink = signupIp ? `https://ipinfo.io/${encodeURIComponent(signupIp)}` : null;

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Name</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source (self-reported)</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(reportedText)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source (detected)</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(detectedText)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">IP / Location</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;">${ipLink ? `<a href="${escape(ipLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(ipLine)}</a>` : `<span style="color:#e6edf3;word-break:break-all;">${escape(ipLine)}</span>`}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">Total users now</td><td style="padding:8px 10px;color:#4ade80;font-weight:700;word-break:break-word;">${totalUsers ?? '?'}</td></tr>
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: '🎉 New User',
    badgeType: 'success',
    title: `🎉 ${displayName || email}`,
    subtitle: 'A new user just signed up for Attendance Tracker.',
    contentHtml,
    ctaText: 'Open admin dashboard →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'green',
  });

  const text = [
    `New Attendance Tracker user: ${displayName || email}`,
    `Email: ${email}`,
    `Domain: ${domain}`,
    `Source (self-reported): ${reportedText}`,
    `Source (detected): ${detectedText}`,
    `IP / Location: ${ipLine}${ipLink ? ` — ${ipLink}` : ''}`,
    `Total users now: ${totalUsers ?? '?'}`,
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'signup' }],
  }, 'signup notification', { email, domain });
}

// Fire-and-forget upgrade / payment notification email. Sends to NOTIFY_EMAIL
// (or the owner's inbox). Surfaces instant monetization events with direct
// links to the customer/subscription in the Stripe dashboard.
async function sendUpgradeNotification({
  email,
  displayName,
  domain,
  plan,
  amountTotal,
  currency = 'usd',
  customerId,
  subscriptionId,
  country,
  isTeam = false,
}) {
  if (!getResend()) return { skipped: 'no resend' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const formattedAmount = (amountTotal != null && amountTotal > 0)
    ? `$${(amountTotal / 100).toFixed(2)} ${currency ? currency.toUpperCase() : 'USD'}`
    : 'Active';

  let planLabel = 'Pro Plan';
  if (plan === 'educator') planLabel = 'Educator Pro';
  else if (plan === 'lifetime') planLabel = 'Lifetime Pass';
  else if (isTeam || plan === 'team') planLabel = 'Team Pro';
  else if (plan === 'department') planLabel = 'Department Pro';
  else if (plan === 'individual') planLabel = 'Individual Pro';

  const flag = country && country.length === 2
    ? String.fromCodePoint(0x1F1E6 + country.toUpperCase().charCodeAt(0) - 65, 0x1F1E6 + country.toUpperCase().charCodeAt(1) - 65) + ' '
    : '';
  const locationText = country ? `${flag}${country}` : 'Unknown';

  const subject = `💰 New Upgrade: ${displayName || email} (${formattedAmount} - ${planLabel})`;

  const stripeCustomerLink = customerId ? `https://dashboard.stripe.com/customers/${customerId}` : null;
  const stripeSubLink = subscriptionId ? `https://dashboard.stripe.com/subscriptions/${subscriptionId}` : null;

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Plan</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#4ade80;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escape(planLabel)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Amount</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;word-break:break-word;overflow-wrap:anywhere;">${escape(formattedAmount)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain || '—')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Country / Location</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(locationText)}</td></tr>
      ${stripeSubLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Subscription</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeSubLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(subscriptionId)}</a></td></tr>` : ''}
      ${stripeCustomerLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Stripe Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeCustomerLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(customerId)}</a></td></tr>` : ''}
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: '💰 New Upgrade',
    badgeType: 'success',
    title: `💰 ${displayName || email} upgraded to ${planLabel}!`,
    subtitle: `Payment of ${formattedAmount} received.`,
    contentHtml,
    ctaText: stripeSubLink ? 'View Subscription in Stripe →' : (stripeCustomerLink ? 'View Customer in Stripe →' : 'Open Admin Dashboard →'),
    ctaUrl: stripeSubLink || stripeCustomerLink || 'https://attendancetracker.dev/admin.html',
    ctaColor: 'green',
  });

  const text = [
    `New Attendance Tracker Upgrade: ${displayName || email}`,
    `Plan: ${planLabel}`,
    `Amount: ${formattedAmount}`,
    `Email: ${email}`,
    `Domain: ${domain || '—'}`,
    `Location: ${locationText}`,
    subscriptionId ? `Subscription: ${subscriptionId} (${stripeSubLink})` : '',
    customerId ? `Customer: ${customerId} (${stripeCustomerLink})` : '',
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'upgrade' }],
  }, 'upgrade notification', { email, domain, plan });
}

// Fire-and-forget admin notification email for subscription cancellations.
// Alerts NOTIFY_EMAIL / owner with customer, plan, access expiration date,
// source of cancellation, and direct links into Stripe dashboard.
async function sendAdminSubscriptionCancelledNotification({
  email,
  displayName,
  domain,
  plan,
  subscriptionId,
  customerId,
  currentPeriodEnd,
  source = 'in_app_settings',
} = {}) {
  if (!getResend()) return { skipped: 'no resend' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  let planLabel = 'Pro Plan';
  if (plan === 'educator') planLabel = 'Educator Pro';
  else if (plan === 'team') planLabel = 'Team Pro';
  else if (plan === 'department') planLabel = 'Department Pro';
  else if (plan === 'individual') planLabel = 'Individual Pro';

  const subject = `⚠️ Subscription Cancelled: ${displayName || email} (${planLabel})`;

  const stripeCustomerLink = customerId ? `https://dashboard.stripe.com/customers/${customerId}` : null;
  const stripeSubLink = subscriptionId ? `https://dashboard.stripe.com/subscriptions/${subscriptionId}` : null;

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Plan</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#f85149;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escape(planLabel)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain || '—')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Active Until</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(currentPeriodEnd || 'End of current period')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#8b949e;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">${escape(source)}</code></td></tr>
      ${stripeSubLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Subscription</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeSubLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(subscriptionId)}</a></td></tr>` : ''}
      ${stripeCustomerLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Stripe Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeCustomerLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(customerId)}</a></td></tr>` : ''}
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: '⚠️ Subscription Cancelled',
    badgeType: 'warning',
    title: `⚠️ ${displayName || email} cancelled auto-renewal`,
    subtitle: `Paid plan: ${planLabel} · Pro remains active until ${currentPeriodEnd || 'end of period'}.`,
    contentHtml,
    ctaText: stripeSubLink ? 'View Subscription in Stripe →' : 'Open Admin Dashboard →',
    ctaUrl: stripeSubLink || 'https://attendancetracker.dev/admin.html',
    ctaColor: 'orange',
  });

  const text = [
    `Subscription Cancelled: ${displayName || email}`,
    `Plan: ${planLabel}`,
    `Email: ${email}`,
    `Domain: ${domain || '—'}`,
    `Active Until: ${currentPeriodEnd || 'End of current period'}`,
    `Source: ${source}`,
    subscriptionId ? `Subscription: ${subscriptionId} (${stripeSubLink})` : '',
    customerId ? `Customer: ${customerId} (${stripeCustomerLink})` : '',
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Alerts'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'admin_subscription_cancelled' }],
  }, 'admin subscription cancelled notification', { email, domain, plan, source });
}

// Fire-and-forget admin notification email for email unsubscribes / opt-outs.
// Alerts NOTIFY_EMAIL / owner when a user opts out of all emails or disables specific categories.
async function sendAdminEmailUnsubscribedNotification({
  email,
  domain,
  type = 'all',
  disabledCategories = [],
  enabledCategories = [],
  source = 'public_unsubscribe',
} = {}) {
  if (!getResend()) return { skipped: 'no resend' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const isAll = type === 'all';
  const categoryLabels = {
    exportSummary: 'Export & attendance summaries',
    seriesAlerts: 'Absence & streak alerts',
    weeklyDigest: 'Weekly digest',
    tipsAndUpdates: 'Tips & product updates',
  };

  const subject = isAll
    ? `🔕 Email Opt-Out: ${email} unsubscribed from all emails`
    : `🔕 Email Preferences: ${email} disabled ${disabledCategories.map(c => categoryLabels[c] || c).join(', ')}`;

  const disabledText = disabledCategories.length
    ? disabledCategories.map(c => `❌ ${escape(categoryLabels[c] || c)}`).join('<br>')
    : 'None';
  const enabledText = enabledCategories.length
    ? enabledCategories.map(c => `✅ ${escape(categoryLabels[c] || c)}`).join('<br>')
    : 'None';

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">User Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain || '—')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Scope</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:${isAll ? '#f85149' : '#f0883e'};font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${isAll ? 'Unsubscribed from ALL emails' : 'Selective Categories Disabled'}</td></tr>
      ${!isAll ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Disabled</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#f85149;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;">${disabledText}</td></tr>` : ''}
      ${!isAll && enabledCategories.length ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Still Active</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#3fb950;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;">${enabledText}</td></tr>` : ''}
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">Source</td><td style="padding:8px 10px;color:#8b949e;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">${escape(source)}</code></td></tr>
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: isAll ? '🔕 Email Opt-Out' : '🔕 Notification Preferences',
    badgeType: 'neutral',
    title: isAll ? `🔕 ${email} opted out of all emails` : `🔕 ${email} updated notification preferences`,
    subtitle: isAll ? 'User unsubscribed from all marketing, alert, and summary emails.' : `Disabled: ${disabledCategories.join(', ')}`,
    contentHtml,
    ctaText: 'Open Admin Dashboard →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'blue',
  });

  const text = [
    isAll ? `Email Opt-Out: ${email}` : `Email Preferences Updated: ${email}`,
    `Email: ${email}`,
    `Domain: ${domain || '—'}`,
    `Scope: ${isAll ? 'All Emails' : 'Specific Categories'}`,
    disabledCategories.length ? `Disabled: ${disabledCategories.join(', ')}` : '',
    enabledCategories.length ? `Still Active: ${enabledCategories.join(', ')}` : '',
    `Source: ${source}`,
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Alerts'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'admin_email_unsubscribed' }],
  }, 'admin email unsubscribed notification', { email, domain, type, source });
}


// Deferred-signup flush. Sends the signup notification for a user exactly once,
// carrying whatever acquisition source is known at flush time (self-reported if
// the user answered the modal, else the auto-detected fallback). Safe to call
// from multiple triggers — the source-modal answer, the post-signup grace
// timer, and the daily sweep backstop all call this. The underlying claim
// (claimSignupNotification) is transactional, so only the first caller emails;
// the rest are no-ops. Returns { sent: false } when there's nothing pending.
async function maybeSendSignupNotification(domain, email) {
  // Lazy require to avoid a load-time cycle (firestore ⇄ notifications).
  const { claimSignupNotification, releaseSignupNotification, countAllUsers } = require('../services/firestore');
  const payload = await claimSignupNotification(domain, email);
  if (!payload) return { sent: false };
  const totalUsers = await countAllUsers();
  const ownerResult = await sendSignupWebhook({
    email: payload.email,
    displayName: payload.displayName,
    domain: payload.domain,
    reportedSource: payload.reportedSource,
    reportedDetail: payload.reportedDetail,
    detectedSource: payload.detectedSource,
    totalUsers,
    signupIp: payload.signupIp,
    signupGeo: payload.signupGeo,
  });
  // Definite send failure (dispatchEmail returned {sent:false, error}) →
  // release the claim so the next trigger / daily sweep retries. A timeout
  // reports sent:true (see dispatchEmail) so this can't double-send, and an
  // unconfigured Resend returns undefined — no release, no retry loop.
  if (ownerResult && ownerResult.sent === false && ownerResult.error) {
    await releaseSignupNotification(domain, email);
    return { sent: false, released: true };
  }

  // Welcome email to the newly signed up user — AWAITED, not fire-and-forget:
  // an unawaited send here ran after the caller's response on Cloud Run (CPU
  // throttled) with the claim already consumed, so a throttled welcome email
  // was lost permanently with no retry path. The oauth caller deadline-races
  // the whole flush, so this can't hold sign-in hostage. Honors the
  // suppression list like every other lifecycle email.
  try {
    const { isEmailSuppressed } = require('../services/firestore');
    if (await isEmailSuppressed(payload.email)) {
      log.info('welcome email skipped — address suppressed', { to: payload.email });
    } else {
      await sendWelcomeEmail({
        to: payload.email,
        displayName: payload.displayName,
        country: payload.signupGeo?.country,
        domain: payload.domain,
        language: payload.language,
      });
    }
  } catch (err) {
    log.warn('welcome email failed', { to: payload.email, error: err.message });
  }

  return ownerResult;
}

// Referral win: tell the inviter that someone they invited just joined and
// that they've earned a free month of Pro. Uses sendPersonalEmail so it carries
// the reply-to + CAN-SPAM unsubscribe footer like other lifecycle mail.
async function sendReferralNotification({ to, inviterName, newUserName, rewardMonths = 1, totalReferrals = 1, promoCode = null, rewarded = true, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let monthWord = rewardMonths === 1 ? 'a free month' : `${rewardMonths} free months`;
  let rewardLine = !rewarded
    ? `Thanks for spreading the word — that's a big help.`
    : promoCode
      ? `As a thank-you, here's ${monthWord} of Pro on us — apply code ${promoCode} at checkout.`
      : `As a thank-you, you've earned ${monthWord} of Pro — it'll be applied to your account (or your next upgrade).`;
  let subject = rewarded
    ? `🎉 ${newUserName} joined Attendance Tracker — you earned a free month`
    : `🎉 ${newUserName} joined Attendance Tracker via your invite`;
  let introLine = `Good news — ${newUserName} just signed up for Attendance Tracker using your invite.`;
  let totalLine = totalReferrals > 1 ? `That's ${totalReferrals} people you've brought in so far. Seriously, thank you.` : `Thanks again.`;

  if (lang === 'es') {
    monthWord = rewardMonths === 1 ? 'un mes gratis' : `${rewardMonths} meses gratis`;
    rewardLine = !rewarded
      ? `Gracias por correr la voz — nos ayuda muchísimo.`
      : promoCode
        ? `Como agradecimiento, tienes ${monthWord} de Pro por nuestra cuenta — aplica el código ${promoCode} al pagar.`
        : `Como agradecimiento, ganaste ${monthWord} de Pro — se aplicará a tu cuenta (o en tu próxima actualización).`;
    subject = rewarded
      ? `🎉 ${newUserName} se unió a Attendance Tracker — ganaste un mes gratis`
      : `🎉 ${newUserName} se unió a Attendance Tracker con tu invitación`;
    introLine = `Buenas noticias — ${newUserName} acaba de registrarse en Attendance Tracker con tu invitación.`;
    totalLine = totalReferrals > 1 ? `Ya son ${totalReferrals} personas que has invitado hasta ahora. En verdad, ¡muchas gracias!` : `¡Gracias de nuevo!`;
  } else if (lang === 'pt') {
    monthWord = rewardMonths === 1 ? 'um mês grátis' : `${rewardMonths} meses grátis`;
    rewardLine = !rewarded
      ? `Obrigado por compartilhar — isso nos ajuda muito.`
      : promoCode
        ? `Como agradecimento, você ganhou ${monthWord} de Pro por nossa conta — use o código ${promoCode} no checkout.`
        : `Como agradecimento, você ganhou ${monthWord} de Pro — será aplicado à sua conta (ou na sua próxima atualização).`;
    subject = rewarded
      ? `🎉 ${newUserName} entrou no Attendance Tracker — você ganhou um mês grátis`
      : `🎉 ${newUserName} entrou no Attendance Tracker através do seu convite`;
    introLine = `Boas notícias — ${newUserName} acabou de se cadastrar no Attendance Tracker através do seu convite.`;
    totalLine = totalReferrals > 1 ? `Já são ${totalReferrals} pessoas que você trouxe até agora. De verdade, muito obrigado!` : `Obrigado novamente.`;
  } else if (lang === 'bn') {
    monthWord = rewardMonths === 1 ? '১ মাস ফ্রি' : `${rewardMonths} মাস ফ্রি`;
    rewardLine = !rewarded
      ? `সবার সাথে শেয়ার করার জন্য ধন্যবাদ — এটি আমাদের জন্য অনেক বড় সাহায্য।`
      : promoCode
        ? `ধন্যবাদস্বরূপ, আমাদের পক্ষ থেকে পাচ্ছেন প্রো-এর ${monthWord} — চেকআউটের সময় কোড ${promoCode} ব্যবহার করুন।`
        : `ধন্যবাদস্বরূপ, আপনি প্রো-এর ${monthWord} অর্জন করেছেন — এটি আপনার অ্যাকাউন্টে (অথবা পরবর্তী আপগ্রেডে) যুক্ত করা হবে।`;
    subject = rewarded
      ? `🎉 ${newUserName} Attendance Tracker-এ যোগ দিয়েছেন — আপনি ১ মাস ফ্রি পেয়েছেন`
      : `🎉 ${newUserName} আপনার আমন্ত্রণে Attendance Tracker-এ যোগ দিয়েছেন`;
    introLine = `সুসংবাদ — ${newUserName} এইমাত্র আপনার আমন্ত্রণে Attendance Tracker-এ সাইন আপ করেছেন।`;
    totalLine = totalReferrals > 1 ? `আপনি এ পর্যন্ত মোট ${totalReferrals} জনকে এনেছেন। আন্তরিক ধন্যবাদ!` : `আবারও ধন্যবাদ।`;
  }

  const promoBox = promoCode ? `
    <div style="margin:16px 0;padding:14px 16px;background:#0d1117;border:1px dashed #4ade80;border-radius:8px;text-align:center;box-sizing:border-box;">
      <div style="font-size:11px;text-transform:uppercase;color:#8b949e;letter-spacing:0.05em;margin-bottom:6px;font-weight:600;">${lang === 'es' ? 'Tu código promocional' : (lang === 'pt' ? 'Seu código promocional' : (lang === 'bn' ? 'আপনার প্রোমো কোড' : 'Your Promo Code'))}</div>
      <div style="font-family:monospace;font-size:22px;font-weight:700;color:#4ade80;letter-spacing:0.12em;">${escape(promoCode)}</div>
    </div>
  ` : '';

  return sendPersonalEmail({
    to, displayName: inviterName,
    subject,
    lines: [
      introLine,
      '',
      rewardLine,
      totalLine,
      '',
      '— Derek',
      'attendancetracker.dev',
    ],
    badge: lang === 'es' ? '🎁 Recompensa' : (lang === 'pt' ? '🎁 Recompensa' : (lang === 'bn' ? '🎁 রেফারেল পুরস্কার' : '🎁 Referral Reward')),
    badgeType: 'success',
    ctaText: promoCode
      ? (lang === 'es' ? 'Canjear código de descuento →' : (lang === 'pt' ? 'Resgatar código de desconto →' : (lang === 'bn' ? 'ডিসকাউন্ট কোড ব্যবহার করুন →' : 'Redeem Discount Code →')))
      : (lang === 'es' ? 'Abrir Attendance Tracker →' : (lang === 'pt' ? 'Abrir o Attendance Tracker →' : (lang === 'bn' ? 'Attendance Tracker খুলুন →' : 'Open Attendance Tracker →'))),
    ctaUrl: promoCode ? `https://attendancetracker.dev/pricing.html?promo=${encodeURIComponent(promoCode)}` : 'https://attendancetracker.dev/pricing.html',
    ctaColor: 'green',
    extraHtml: promoBox,
    tags: [
      { name: 'type', value: 'referral' },
      { name: 'lang', value: lang },
    ],
    logLabel: 'referral notification', logMeta: { totalReferrals, hasPromo: !!promoCode, rewarded, lang },
    language, country, domain,
  });
}

// Deferred referral flush. Claims a referred user's pending referral once,
// credits + notifies the inviter, and is a no-op otherwise. Fired from the same
// triggers as the signup notification (grace timer, source modal, daily sweep).
// Idempotent via claimReferral + recordReferralForInviter's per-user guard.
async function maybeSendReferralNotification(domain, email) {
  const { claimReferral, releaseReferral, recordReferralForInviter, recordReferralPromoCode, isEmailSuppressed } = require('../services/firestore');
  const { createReferralPromoCode } = require('../routes/billing');
  const claim = await claimReferral(domain, email);
  if (!claim) return { sent: false };
  // Anti-abuse: a self-referral (signed up with your own ?ref=) earns nothing.
  if (claim.referredBy === (claim.newUserEmail || '').toLowerCase()) return { sent: false, selfReferral: true };
  const rewardMonths = 1;
  // Credit the inviter. If this fails transiently (recordReferralForInviter now
  // rethrows), RELEASE the claim so a later flush retries rather than silently
  // losing the reward. A genuinely-missing inviter returns {inviterExists:false}
  // (no throw) and is dropped below without a release.
  let rec;
  try {
    rec = await recordReferralForInviter(claim.referredBy, { newUserEmail: claim.newUserEmail, rewardMonths });
  } catch (err) {
    await releaseReferral(domain, email);
    return { sent: false, released: true };
  }
  // Nothing to email if the inviter never signed in, or we already credited
  // this referral on a prior flush.
  if (!rec.inviterExists || rec.already) return { sent: false, recorded: !!rec.inviterExists && !rec.already };
  // Mint the free-month coupon ONLY when the inviter is under the reward cap
  // (rewardEligible) — past the cap, attribution still accrued but no more
  // money-bearing codes. null when the Stripe coupon isn't configured.
  const promoCode = rec.rewardEligible ? await createReferralPromoCode(claim.referredBy) : null;
  if (promoCode) await recordReferralPromoCode(claim.referredBy, promoCode);
  // CAN-SPAM: never email a suppressed inviter (still credited above).
  if (await isEmailSuppressed(claim.referredBy)) return { sent: false, recorded: true, promoCode: promoCode || null };
  const sendResult = await sendReferralNotification({
    to: claim.referredBy,
    inviterName: rec.inviterDisplayName,
    newUserName: claim.newUserName || claim.newUserEmail,
    rewardMonths,
    totalReferrals: rec.totalReferrals,
    promoCode,
    rewarded: rec.rewardEligible,
  });
  // The credit + promo code are already recorded (releasing here can't retry
  // the email — recordReferralForInviter's `already` guard would short-circuit
  // a re-flush before it sends). Surface the loss loudly instead: the code in
  // this log line is the one the inviter was never told about.
  if (sendResult && sendResult.sent === false && sendResult.error) {
    log.error('referral notification send failed AFTER credit + promo mint — manual follow-up needed', {
      inviter: claim.referredBy, promoCode: promoCode || null, error: sendResult.error,
    });
  }
  return sendResult;
}

// Single flush point for both deferred per-signup notifications — the owner
// signup ping and the referrer credit/notify. Every trigger (post-signup grace
// timer, the source modal, the daily sweep) calls this so a call site can't
// forget one. Both underlying flushes are independently claimed + idempotent,
// and fired best-effort so a mail hiccup never blocks the caller.
function flushDeferredNotifications(domain, email) {
  // Returns a never-rejecting promise so callers that need the flush to
  // COMPLETE before their process may be CPU-throttled (the oauth exchange on
  // Cloud Run) can await it; fire-and-forget callers ignore the return.
  return Promise.allSettled([
    maybeSendSignupNotification(domain, email).catch(() => { /* best-effort */ }),
    maybeSendReferralNotification(domain, email).catch(() => { /* best-effort */ }),
  ]);
}

// Generic email send used by the admin "email from dashboard" feature.
// Returns { sent: true, id } or throws if Resend isn't configured.
async function sendAdminEmail({ to, subject, body }) {
  if (!to || !subject) throw new Error('to and subject are required');
  const text = body || '';
  const html = text.split('\n').map(l => `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.5">${escape(l) || '&nbsp;'}</p>`).join('');
  return send({
    from: makeFrom('Derek Gallardo'),
    to,
    subject,
    text,
    html,
    replyTo: ownerEmail(),
    tags: [{ name: 'type', value: 'admin' }],
  });
}

// Immediate alert email when a user experiences an error (e.g. export_failed).
// Sent directly to the owner/NOTIFY_EMAIL so issues are noticed and fixed immediately.
async function sendErrorAlertEmail({ email, domain, error, context, meta }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const subject = `⚠️ User Error Alert: ${email || 'Anonymous'} (${context || 'unknown'})`;
  const text = [
    `An error was reported by or encountered for user: ${email || 'Unknown'}`,
    `Domain: ${domain || 'Unknown'}`,
    `Context: ${context || 'Unknown'}`,
    `Error: ${error || 'Unknown'}`,
    `Details: ${JSON.stringify(meta || {}, null, 2)}`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;font-size:13px;width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:16px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:38%;max-width:120px;vertical-align:top;word-break:break-word;">User Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Context</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#f85149;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-all;">${escape(context)}</code></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">Error Message</td><td style="padding:8px 10px;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#f85149;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-all;">${escape(error)}</code></td></tr>
    </table>
    ${meta ? `<div style="margin-top:16px;"><h4 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">Details</h4><pre style="background:#0d1117;border:1px solid #30363d;padding:10px 12px;border-radius:6px;font-size:12px;color:#e6edf3;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-family:monospace;margin:0;box-sizing:border-box;">${escape(JSON.stringify(meta, null, 2))}</pre></div>` : ''}
  `;

  const html = buildDesignSystemEmail({
    badge: '⚠️ Error Alert',
    badgeType: 'error',
    title: '⚠️ User Error Alert',
    subtitle: 'An error was encountered or reported on Attendance Tracker:',
    contentHtml,
    ctaText: 'Open Admin Dashboard →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'blue',
  });

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Alerts'),
    to,
    subject,
    text,
    html,
    tags: [{ name: 'type', value: 'error_alert' }],
  }, 'error alert', { userEmail: email, context });
}

// Weekly self-report email. Formats the report from firestore into something
// you can scan in 30 seconds Monday morning.
async function sendWeeklySelfReport(report) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const arrow = (s) => {
    const str = String(s || '');
    return str.startsWith('+')
      ? `<span style="color:#4ade80;font-weight:600">▲ ${escape(str)}</span>`
      : str.startsWith('-')
        ? `<span style="color:#f85149;font-weight:600">▼ ${escape(str)}</span>`
        : `<span style="color:#8b949e">${escape(str)}</span>`;
  };

  const newSignupsList = (report.signups?.new || []).map(u => {
    const adminSearch = `https://attendancetracker.dev/admin.html?search=${encodeURIComponent(u.email)}`;
    return `<li style="padding:8px 0;border-bottom:1px solid #21262d;list-style:none;font-size:13px;color:#e6edf3;word-break:break-word;"><strong style="color:#e6edf3;">${escape(u.displayName || u.email)}</strong> <span style="color:#8b949e;">&lt;${escape(u.email)}&gt;</span> — <a href="${adminSearch}" style="color:#58a6ff;text-decoration:none;">${escape(u.domain)}</a>${u.source ? ` <span style="font-size:11px;background:#21262d;color:#8b949e;padding:2px 6px;border-radius:6px;white-space:nowrap;">${escape(u.source)}</span>` : ''}</li>`;
  }).join('') || '<li style="color:#8b949e;padding:6px 0;list-style:none;font-size:13px;">No new signups this week.</li>';

  const concernsList = (report.concerns || []).map(u => {
    const name = escape(u.displayName || u.email);
    const email = escape(u.email);
    const domain = escape(u.domain || '');
    const subject = encodeURIComponent('Getting started with Attendance Tracker');
    const body = encodeURIComponent(`Hi ${u.displayName ? u.displayName.split(' ')[0] : 'there'},\n\nI noticed you signed up for Attendance Tracker for ${u.domain || 'your meetings'} a few days ago. Did you run into any snags tracking your first meeting?\n\nHappy to help or jump on a quick call!\n\nBest,\nDerek`);
    const mailto = `mailto:${u.email}?subject=${subject}&body=${body}`;
    const adminSearch = `https://attendancetracker.dev/admin.html?search=${encodeURIComponent(u.email)}`;
    return `<li style="padding:10px 0;border-bottom:1px solid #30363d;list-style:none;font-size:13px;"><div style="margin-bottom:6px;word-break:break-word;"><strong style="color:#f85149;">${name}</strong> <span style="color:#8b949e;">&lt;${email}&gt;</span> — <a href="${adminSearch}" style="color:#58a6ff;text-decoration:none;">${domain}</a><div style="margin-top:3px;"><span style="font-size:11px;color:#f85149;background:rgba(248,81,73,0.12);padding:2px 6px;border-radius:4px;">signed up 3-7d ago, never tracked</span></div></div><a href="${mailto}" class="touch-btn" style="display:inline-block;padding:7px 12px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;min-height:36px;box-sizing:border-box;">⚡ 1-Click Outreach</a></li>`;
  }).join('') || '<li style="color:#4ade80;padding:6px 0;list-style:none;font-size:13px;">No churn-risk users this week 🎉</li>';

  const sourcesEntries = Object.entries(report.sources || {}).sort((a, b) => b[1] - a[1]);
  const maxSource = sourcesEntries.length ? Math.max(...sourcesEntries.map(e => e[1])) : 1;
  const sourcesList = sourcesEntries.map(([s, n]) => {
    const pct = Math.max(8, Math.round((n / maxSource) * 100));
    return `<li style="padding:6px 0;border-bottom:1px solid #21262d;list-style:none;font-size:13px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:#e6edf3;font-weight:500;">${escape(s)}</span><strong style="color:#4ade80;">${n}</strong></div><div style="background:#21262d;border-radius:4px;height:5px;width:100%;overflow:hidden;"><div style="background:#4ade80;height:5px;width:${pct}%;border-radius:4px;"></div></div></li>`;
  }).join('') || '<li style="color:#8b949e;padding:6px 0;list-style:none;font-size:13px;">No source data yet.</li>';

  const useCasesEntries = Object.entries(report.useCases || {}).sort((a, b) => b[1] - a[1]);
  const maxUseCase = useCasesEntries.length ? Math.max(...useCasesEntries.map(e => e[1])) : 1;
  const useCasesList = useCasesEntries.map(([s, n]) => {
    const pct = Math.max(8, Math.round((n / maxUseCase) * 100));
    return `<li style="padding:6px 0;border-bottom:1px solid #21262d;list-style:none;font-size:13px;"><div style="display:flex;justify-content:space-between;margin-bottom:3px;"><span style="color:#e6edf3;font-weight:500;">${escape(s)}</span><strong style="color:#58a6ff;">${n}</strong></div><div style="background:#21262d;border-radius:4px;height:5px;width:100%;overflow:hidden;"><div style="background:#58a6ff;height:5px;width:${pct}%;border-radius:4px;"></div></div></li>`;
  }).join('') || '<li style="color:#8b949e;padding:6px 0;list-style:none;font-size:13px;">No survey responses yet.</li>';

  const topUserLine = report.topUser
    ? `<strong style="color:#4ade80;">${escape(report.topUser.displayName || report.topUser.email)}</strong> <span style="color:#8b949e;">(${report.topUser.actions} actions)</span>`
    : 'Nobody yet — quiet week.';

  const rt = report.retention;
  const remindersBreakdown = rt ? (Object.entries(rt.remindersThis || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${escape(k)} ${n}`).join(', ') || 'none') : '';
  const retentionHtml = rt ? `
      <div style="padding:20px 24px;border-bottom:1px solid #30363d;">
        <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#58a6ff;">🔁 Retention & Diagnostics</h3>
        <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;">
          <div><b style="color:#e6edf3;">Return rate:</b> <span style="color:#4ade80;font-weight:700;">${rt.returnRate}%</span> — <span style="color:#8b949e;">${rt.returned}/${rt.eligible} came back on a later day</span></div>
          <div><b style="color:#e6edf3;">Retention nudges sent:</b> <strong style="color:#e6edf3;">${rt.remindersThisTotal}</strong> this week ${arrow(rt.remindersDelta || '0')} — <span style="color:#8b949e;">${remindersBreakdown}</span></div>
          <div><b style="color:#e6edf3;">Silent dead-ends:</b> <span style="color:#f85149;font-weight:600;">${rt.deadEnds} user${rt.deadEnds === 1 ? '' : 's'}</span> <span style="color:#8b949e;">polled 5+ times but captured nobody (not the host)</span></div>
        </div>
      </div>` : '';

  const subject = `📊 Weekly Attendance Tracker report — ${report.signups.thisWeek} new signup${report.signups.thisWeek === 1 ? '' : 's'}, ${report.tracks.thisWeek} track${report.tracks.thisWeek === 1 ? '' : 's'}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @media only screen and (max-width: 580px) {
          .responsive-container { width: 100% !important; border-radius: 0 !important; }
          .metric-cell { display: block !important; width: 100% !important; margin-bottom: 8px !important; box-sizing: border-box !important; }
          .two-col-cell { display: block !important; width: 100% !important; padding: 0 !important; margin-bottom: 16px !important; }
          .touch-btn { display: inline-block !important; width: auto !important; max-width: 100% !important; text-align: center !important; padding: 9px 16px !important; font-size: 13px !important; line-height: 1.35 !important; box-sizing: border-box !important; vertical-align: middle !important; }
          .touch-btn-block { display: block !important; width: 100% !important; text-align: center !important; padding: 10px 16px !important; font-size: 13px !important; line-height: 1.35 !important; box-sizing: border-box !important; }
        }
      </style>
    </head>
    <body style="margin:0;padding:0;background-color:#0d1117;">
      <div style="background-color:#0d1117;padding:24px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3;">
        <div class="responsive-container" style="max-width:640px;margin:0 auto;background-color:#161b22;border:1px solid #30363d;border-radius:12px;overflow:hidden;">
          
          <!-- Header -->
          <div style="padding:24px 20px 18px;border-bottom:1px solid #30363d;background:linear-gradient(180deg,#1c2128 0%,#161b22 100%);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
              <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#4ade80;background:rgba(74,222,128,0.12);padding:4px 8px;border-radius:10px;border:1px solid rgba(74,222,128,0.25);">
                Weekly Performance Digest
              </span>
              <span style="font-size:12px;color:#8b949e;">${new Date(report.windowStart).toLocaleDateString()} → ${new Date(report.windowEnd).toLocaleDateString()}</span>
            </div>
            <h2 style="margin:6px 0 4px;font-size:20px;font-weight:700;color:#e6edf3;">Week of ${new Date(report.windowStart).toLocaleDateString()} → ${new Date(report.windowEnd).toLocaleDateString()}</h2>
            <p style="margin:0;font-size:13px;color:#8b949e;">Snapshot: <strong style="color:#e6edf3;">${report.totalUsers}</strong> total users, <strong style="color:#e6edf3;">${report.totalMeetings}</strong> total meetings tracked.</p>
          </div>

          <!-- Core Metrics Cards -->
          <div style="padding:16px 20px;border-bottom:1px solid #30363d;">
            <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:-8px;">
              <tr class="metric-row">
                <td class="metric-cell" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px;vertical-align:top;">
                  <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.05em;">Signups</div>
                  <div style="font-size:24px;font-weight:700;color:#e6edf3;margin:4px 0;">${report.signups.thisWeek}</div>
                  <div style="font-size:12px;">${arrow(report.signups.delta || '0')} <span style="color:#8b949e;font-size:11px;">(was ${report.signups.lastWeek})</span></div>
                </td>
                <td class="metric-cell" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px;vertical-align:top;">
                  <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.05em;">Meetings</div>
                  <div style="font-size:24px;font-weight:700;color:#4ade80;margin:4px 0;">${report.tracks.thisWeek}</div>
                  <div style="font-size:12px;">${arrow(report.tracks.delta || '0')} <span style="color:#8b949e;font-size:11px;">(was ${report.tracks.lastWeek})</span></div>
                </td>
                <td class="metric-cell" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px;vertical-align:top;">
                  <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.05em;">Exports</div>
                  <div style="font-size:24px;font-weight:700;color:#e6edf3;margin:4px 0;">${report.exports.thisWeek}</div>
                  <div style="font-size:12px;">${arrow(report.exports.delta || '0')} <span style="color:#8b949e;font-size:11px;">(was ${report.exports.lastWeek})</span></div>
                </td>
              </tr>
            </table>
          </div>

          ${retentionHtml}

          <!-- Top User -->
          <div style="padding:16px 20px;border-bottom:1px solid #30363d;background:rgba(74,222,128,0.02);">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;margin-bottom:4px;font-weight:600;">⭐ Top user this week</div>
            <div style="font-size:14px;word-break:break-word;">${topUserLine}</div>
          </div>

          <!-- Churn Risk with 1-Click Outreach -->
          <div style="padding:20px;border-bottom:1px solid #30363d;background:rgba(248,81,73,0.03);">
            <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#f85149;">⚠ Churn risk — check in this week</h3>
            <ul style="margin:0;padding:0;">${concernsList}</ul>
          </div>

          <!-- Breakdown: Sources & Use cases with sparkbars -->
          <div style="padding:20px;border-bottom:1px solid #30363d;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td class="two-col-cell" style="width:50%;vertical-align:top;padding-right:12px;">
                  <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">📡 Acquisition Sources</h3>
                  <ul style="margin:0;padding:0;">${sourcesList}</ul>
                </td>
                <td class="two-col-cell" style="width:50%;vertical-align:top;padding-left:12px;">
                  <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">🎯 Use Cases</h3>
                  <ul style="margin:0;padding:0;">${useCasesList}</ul>
                </td>
              </tr>
            </table>
          </div>

          <!-- New Signups -->
          <div style="padding:20px;border-bottom:1px solid #30363d;">
            <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#4ade80;">🌱 New signups</h3>
            <ul style="margin:0;padding:0;max-height:360px;overflow-y:auto;">${newSignupsList}</ul>
          </div>

          <!-- Footer with touch target -->
          <div style="padding:16px 20px;background:#0d1117;">
            <a href="https://attendancetracker.dev/admin.html" class="touch-btn" style="background:#4ade80;color:#0d1117;font-size:13px;font-weight:700;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;min-height:44px;line-height:24px;box-sizing:border-box;">Open admin dashboard →</a>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;

  const text = [
    `Weekly Attendance Tracker report`,
    `Week of ${new Date(report.windowStart).toLocaleDateString()} → ${new Date(report.windowEnd).toLocaleDateString()}`,
    ``,
    `Signups:  ${report.signups.thisWeek} (was ${report.signups.lastWeek}, ${report.signups.delta})`,
    `Tracks:   ${report.tracks.thisWeek} (was ${report.tracks.lastWeek}, ${report.tracks.delta})`,
    `Exports:  ${report.exports.thisWeek} (was ${report.exports.lastWeek}, ${report.exports.delta})`,
    ...(rt ? [
      ``,
      `Retention:`,
      `  Return rate: ${rt.returnRate}% (${rt.returned}/${rt.eligible} came back)`,
      `  Nudges sent: ${rt.remindersThisTotal} (${rt.remindersDelta})`,
      `  Dead-ends:   ${rt.deadEnds}`,
    ] : []),
    ``,
    `Top user: ${topUserLine.replace(/<[^>]+>/g, '')}`,
    ``,
    `Use cases:`,
    ...Object.entries(report.useCases || {}).sort((a, b) => b[1] - a[1]).map(([s, n]) => `  ${s}: ${n}`),
    ``,
    `Admin: https://attendancetracker.dev/admin.html`,
  ].join('\n');

  return send({
    from: makeFrom('Attendance Tracker'),
    to,
    subject,
    text,
    html,
    tags: [{ name: 'type', value: 'weekly_report' }],
  });
}

// Fire-and-forget "your attendance is ready" email sent when an auto-export
// completes. Lands in the organizer's inbox so they always have the sheet
// link, even if they close the side panel and never look at it again. Now
// includes an inline attendance table so the email is actionable on its own
// — the user doesn't have to open the sheet to see what happened.
async function sendExportNotification({ to, displayName, sheetUrl, meetingTitle, totalAttended, totalInvited, exportedAt, participants, overflow, conferenceId, recurringEventId, isPro = false, language, country, domain }) {
  if (!getResend()) return;
  const resolvedDomain = domain || (to && to.includes('@') ? to.split('@')[1] : null);
  try {
    const { isNotificationCategoryEnabled } = require('../services/firestore');
    if (await isNotificationCategoryEnabled(resolvedDomain, to, 'exportSummary') === false) {
      log.info('export notification skipped — user disabled exportSummary', { to });
      return { skipped: 'opted out of exportSummary' };
    }
  } catch {}
  const lang = resolveLanguage({ language, country, domain: resolvedDomain, email: to });

  const title = meetingTitle || 'Google Meet';
  let summary = totalInvited
    ? `${totalAttended} of ${totalInvited} attended`
    : `${totalAttended} attended`;
  let subject = `Attendance: ${title} — ${summary}`;
  let dateLocale = 'en-US';
  let greeting = displayName ? `Hi ${escape(displayName.split(' ')[0])},` : 'Hi,';
  let badgeText = '📊 Export Ready';
  let meetingEndedText = 'Your meeting just ended — attendance has been auto-exported.';
  let colPerson = 'Person';
  let colStatus = 'Status';
  let colTime = 'Time';
  let overflowText = (n) => `…and ${n} more in the sheet`;
  let openSheetText = 'Open sheet';
  let viewOnWebText = 'View on web →';
  let seriesTrendHtml = (link) => `This is part of a recurring series — <a href="${escape(link)}" style="color:#58a6ff;font-weight:500;text-decoration:none">see the full trend →</a>`;
  let seriesTrendPlain = (link) => `Series trend: ${link}`;
  let reviewBoxTitle = '⭐ Did this save you time today?';
  let reviewBoxBody = 'If Attendance Tracker helped your call, could you spare 10 seconds to leave a 5-star review on Google Marketplace? It helps independent creators like me keep building for educators!';
  let reviewBoxBtn = 'Leave a 5-Star Review (takes 10s) →';
  let reviewBoxPlainPrompt = 'Did this save you time today? Leave a quick 5-star review (takes 10s):';
  let footerNotice = `You're getting this because you tracked this meeting with Attendance Tracker. The sheet lives in your Drive folder "Meet Attendance Tracker" — reuse the same spreadsheet next time, each meeting gets its own tab.`;

  if (lang === 'es') {
    summary = totalInvited
      ? `${totalAttended} de ${totalInvited} asistieron`
      : `${totalAttended} asistieron`;
    subject = `Asistencia: ${title} — ${summary}`;
    dateLocale = 'es-ES';
    greeting = displayName ? `Hola ${escape(displayName.split(' ')[0])},` : 'Hola,';
    badgeText = '📊 Exportación lista';
    meetingEndedText = 'Tu reunión acaba de finalizar — la asistencia se exportó automáticamente.';
    colPerson = 'Persona';
    colStatus = 'Estado';
    colTime = 'Tiempo';
    overflowText = (n) => `…y ${n} más en la hoja`;
    openSheetText = 'Abrir hoja';
    viewOnWebText = 'Ver en la web →';
    seriesTrendHtml = (link) => `Esto es parte de una serie recurrente — <a href="${escape(link)}" style="color:#58a6ff;font-weight:500;text-decoration:none">ver la tendencia completa →</a>`;
    seriesTrendPlain = (link) => `Tendencia de la serie: ${link}`;
    reviewBoxTitle = '⭐ ¿Te ahorró tiempo hoy?';
    reviewBoxBody = 'Si Attendance Tracker te ayudó en tu llamada, ¿podrías dedicar 10 segundos a dejar una reseña de 5 estrellas en Google Marketplace? ¡Ayuda a creadores independientes como yo a seguir desarrollando para educadores!';
    reviewBoxBtn = 'Dejar reseña de 5 estrellas (10s) →';
    reviewBoxPlainPrompt = '¿Te ahorró tiempo hoy? Deja una breve reseña de 5 estrellas (10s):';
    footerNotice = `Recibes esto porque registraste esta reunión con Attendance Tracker. La hoja está en tu carpeta de Google Drive "Meet Attendance Tracker" — reutiliza la misma hoja de cálculo la próxima vez, cada reunión tiene su propia pestaña.`;
  } else if (lang === 'pt') {
    summary = totalInvited
      ? `${totalAttended} de ${totalInvited} presentes`
      : `${totalAttended} presentes`;
    subject = `Presença: ${title} — ${summary}`;
    dateLocale = 'pt-BR';
    greeting = displayName ? `Olá ${escape(displayName.split(' ')[0])},` : 'Olá,';
    badgeText = '📊 Exportação pronta';
    meetingEndedText = 'Sua reunião terminou — a presença foi exportada automaticamente.';
    colPerson = 'Pessoa';
    colStatus = 'Status';
    colTime = 'Tempo';
    overflowText = (n) => `…e mais ${n} na planilha`;
    openSheetText = 'Abrir planilha';
    viewOnWebText = 'Ver na web →';
    seriesTrendHtml = (link) => `Isto faz parte de uma série recorrente — <a href="${escape(link)}" style="color:#58a6ff;font-weight:500;text-decoration:none">ver a tendência completa →</a>`;
    seriesTrendPlain = (link) => `Tendência da série: ${link}`;
    reviewBoxTitle = '⭐ Isso economizou seu tempo hoje?';
    reviewBoxBody = 'Se o Attendance Tracker ajudou na sua chamada, você poderia dedicar 10 segundos para deixar uma avaliação de 5 estrelas no Google Marketplace? Ajuda criadores independentes como eu a continuar construindo para educadores!';
    reviewBoxBtn = 'Deixar avaliação de 5 estrelas (10s) →';
    reviewBoxPlainPrompt = 'Isso economizou seu tempo hoje? Deixe uma avaliação rápida de 5 estrelas (10s):';
    footerNotice = `Você está recebendo este e-mail porque registrou esta reunião com o Attendance Tracker. A planilha fica na sua pasta do Google Drive "Meet Attendance Tracker" — reutilize a mesma planilha na próxima vez, cada reunião terá sua própria aba.`;
  } else if (lang === 'bn') {
    summary = totalInvited
      ? `${totalInvited} জনের মধ্যে ${totalAttended} জন উপস্থিত`
      : `${totalAttended} জন উপস্থিত`;
    subject = `উপস্থিতি: ${title} — ${summary}`;
    dateLocale = 'bn-BD';
    greeting = displayName ? `হ্যালো ${escape(displayName.split(' ')[0])},` : 'হ্যালো,';
    badgeText = '📊 এক্সপোর্ট সম্পন্ন';
    meetingEndedText = 'আপনার মিটিং শেষ হয়েছে — উপস্থিতি স্বয়ংক্রিয়ভাবে এক্সপোর্ট করা হয়েছে।';
    colPerson = 'ব্যক্তি';
    colStatus = 'অবস্থা';
    colTime = 'সময়';
    overflowText = (n) => `…এবং শিটে আরও ${n} জন`;
    openSheetText = 'শিট খুলুন';
    viewOnWebText = 'ওয়েবে দেখুন →';
    seriesTrendHtml = (link) => `এটি একটি নিয়মিত সিরিজের অংশ — <a href="${escape(link)}" style="color:#58a6ff;font-weight:500;text-decoration:none">সম্পূর্ণ ট্রেন্ড দেখুন →</a>`;
    seriesTrendPlain = (link) => `সিরিজ ট্রেন্ড: ${link}`;
    reviewBoxTitle = '⭐ এটি কি আজ আপনার সময় বাঁচিয়েছে?';
    reviewBoxBody = 'Attendance Tracker যদি আপনার কাজে সাহায্য করে থাকে, তবে গুগল মার্কেটপ্লেসে একটি ৫-স্টার রিভিউ দিতে ১০ সেকেন্ড সময় দিতে পারবেন? এটি আমাদের মতো স্বাধীন নির্মাতাদের শিক্ষকদের জন্য নতুন সুবিধা তৈরি করতে সাহায্য করে!';
    reviewBoxBtn = '৫-স্টার রিভিউ দিন (১০ সেকেন্ড লাগবে) →';
    reviewBoxPlainPrompt = 'এটি কি আজ আপনার সময় বাঁচিয়েছে? ৫-স্টার রিভিউ দিন (১০ সেকেন্ড লাগবে):';
    footerNotice = `আপনি Attendance Tracker দিয়ে মিটিংয়ের উপস্থিতি ট্র্যাক করায় এই ইমেইলটি পাঠানো হয়েছে। শিটটি আপনার গুগল ড্রাইভ ফোল্ডার "Meet Attendance Tracker"-এ সংরক্ষিত আছে — পরের বার একই স্প্রেডশিট ব্যবহার করুন, প্রতি মিটিংয়ের জন্য আলাদা ট্যাব তৈরি হবে।`;
  }

  const dateStr = exportedAt ? new Date(exportedAt).toLocaleString(dateLocale, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  const statusLabel = (s) => {
    if (lang === 'es') {
      if (s === 'Present') return 'Presente';
      if (s === 'Left') return 'Salió';
      if (s === 'Excused') return 'Justificado';
      return 'Ausente';
    }
    if (lang === 'pt') {
      if (s === 'Present') return 'Presente';
      if (s === 'Left') return 'Saiu';
      if (s === 'Excused') return 'Justificado';
      return 'Ausente';
    }
    if (lang === 'bn') {
      if (s === 'Present') return 'উপস্থিত';
      if (s === 'Left') return 'বের হয়েছেন';
      if (s === 'Excused') return 'ছুটি';
      return 'অনুপস্থিত';
    }
    return s;
  };

  const lateLabel = (min) => {
    if (lang === 'es') return `+${min} min tarde`;
    if (lang === 'pt') return `+${min} min atrasado`;
    if (lang === 'bn') return `+${min} মি. দেরিতে`;
    return `+${min}m late`;
  };

  // Inline attendance table. Color-codes status: green=present, amber=left
  // early, red=absent. Keeps the email scannable in 2 seconds.
  const statusColor = (s) => {
    if (s === 'Present') return '#4ade80';
    if (s === 'Left') return '#f59e0b';
    if (s === 'Excused') return '#8b949e'; // muted gray — excused isn't a problem
    return '#f85149';
  };
  const fmtDur = (m) => !m ? '—' : hm(m);
  const tableRows = (participants || []).map(p => {
    const lateBadge = p.lateMin > 0
      ? `<span style="display:inline-block;white-space:nowrap;background:rgba(227,179,65,0.15);color:#e3b341;border:1px solid rgba(227,179,65,0.3);font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:4px;vertical-align:middle;line-height:1.3">${lateLabel(p.lateMin)}</span>`
      : '';
    return `
    <tr>
      <td style="padding:8px 10px;border-top:1px solid #21262d;vertical-align:middle">
        <div style="font-size:13px;line-height:1.35;word-break:break-word">
          <span style="font-weight:600;color:#e6edf3">${escape(p.displayName || p.email || '—')}</span> ${lateBadge}
        </div>
        ${p.email && p.displayName ? `<div style="color:#8b949e;font-size:11px;line-height:1.3;margin-top:2px;word-break:break-all">${escape(p.email)}</div>` : ''}
      </td>
      <td style="padding:8px 8px;border-top:1px solid #21262d;vertical-align:middle;color:${statusColor(p.status)};font-weight:600;font-size:12px;white-space:nowrap">${escape(statusLabel(p.status))}</td>
      <td style="padding:8px 10px;border-top:1px solid #21262d;vertical-align:middle;color:#8b949e;text-align:right;font-size:12px;white-space:nowrap">${escape(fmtDur(p.durationMin))}</td>
    </tr>
  `;
  }).join('');
  const overflowRow = overflow > 0
    ? `<tr><td colspan="3" style="padding:8px 10px;border-top:1px solid #21262d;color:#8b949e;font-size:12px;font-style:italic;background:#0d1117">${escape(overflowText(overflow))}</td></tr>`
    : '';
  const tableHtml = participants?.length ? `
    <table role="presentation" style="border-collapse:collapse;width:100%;margin:16px 0;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;table-layout:fixed">
      <thead>
        <tr style="background:#161b22">
          <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;width:58%">${escape(colPerson)}</th>
          <th style="text-align:left;padding:8px 8px;font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;width:22%;white-space:nowrap">${escape(colStatus)}</th>
          <th style="text-align:right;padding:8px 10px;font-size:11px;font-weight:600;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;width:20%;white-space:nowrap">${escape(colTime)}</th>
        </tr>
      </thead>
      <tbody>${tableRows}${overflowRow}</tbody>
    </table>
  ` : '';

  // Web deep links: jump straight to this meeting (or its series) in
  // history.html. Hash-based so they survive any URL shape.
  const meetingLink = conferenceId
    ? `https://attendancetracker.dev/history.html#meeting=${encodeURIComponent(conferenceId)}`
    : 'https://attendancetracker.dev/history.html';
  const seriesLink = recurringEventId
    ? `https://attendancetracker.dev/history.html#series=${encodeURIComponent(recurringEventId)}`
    : null;
  const reviewUrl = `${CONFIG.publicApiUrl}/public/review-click?email=${encodeURIComponent(to)}&source=export_email`;

  const contentHtml = `
    <p style="margin:0 0 6px;font-size:15px;color:#e6edf3">${greeting}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#8b949e">${escape(meetingEndedText)}</p>
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:0 0 16px 0">
      <div style="font-weight:700;font-size:15px;color:#e6edf3;margin-bottom:4px;word-break:break-word">${escape(title)}</div>
      <div style="font-size:13px;color:#8b949e;line-height:1.4">
        <span style="font-weight:600;color:#4ade80">${escape(summary)}</span>${dateStr ? `<span style="color:#8b949e;margin:0 6px">&bull;</span><span>${escape(dateStr)}</span>` : ''}
      </div>
    </div>
    ${tableHtml}
    <div style="margin:16px 0 12px 0">
      <a href="${escape(sheetUrl)}" class="touch-btn" style="display:inline-block;background:#238636;color:#ffffff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;line-height:1.35;margin-right:8px;margin-bottom:8px">${escape(openSheetText)}</a>
      <a href="${escape(meetingLink)}" class="touch-btn" style="display:inline-block;background:#21262d;color:#58a6ff;border:1px solid #30363d;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;line-height:1.35;margin-bottom:8px">${escape(viewOnWebText)}</a>
    </div>
    ${seriesLink ? `<p style="margin:4px 0 16px;font-size:13px;color:#8b949e">${seriesTrendHtml(seriesLink)}</p>` : ''}
    ${isPro ? '' : `<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:16px 0;text-align:left">
      <div style="font-weight:600;color:#e6edf3;font-size:13px;margin-bottom:4px">${escape(reviewBoxTitle)}</div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:10px;line-height:1.4">${escape(reviewBoxBody)}</div>
      <a href="${escape(reviewUrl)}" class="touch-btn-sm" style="display:inline-block;background:#f59e0b;color:#0d1117;font-size:12px;font-weight:700;padding:7px 13px;border-radius:6px;text-decoration:none;line-height:1.35">${escape(reviewBoxBtn)}</a>
    </div>`}
  `;

  const foot = unsubscribeFooter(to);
  const footerHtml = `
    <p style="margin:0 0 10px;color:#8b949e;font-size:12px;line-height:1.5;">
      ${escape(footerNotice)}
    </p>
    ${foot.html}
  `;

  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'success',
    title: `${lang === 'es' ? 'Asistencia' : lang === 'pt' ? 'Presença' : lang === 'bn' ? 'উপস্থিতি' : 'Attendance'}: ${escape(title)}`,
    subtitle: summary,
    contentHtml,
    footerHtml,
  });

  const textRows = (participants || []).map(p => {
    const label = (p.displayName || p.email || '—') + (p.lateMin > 0 ? ` (${lateLabel(p.lateMin)})` : '');
    return `  ${label.padEnd(28)} ${statusLabel(p.status).padEnd(8)} ${fmtDur(p.durationMin)}`;
  }).join('\n');
  const text = [
    greeting,
    ``,
    meetingEndedText,
    ``,
    `${lang === 'es' ? 'Reunión' : lang === 'pt' ? 'Reunião' : lang === 'bn' ? 'মিটিং' : 'Meeting'}: ${title}`,
    `${lang === 'es' ? 'Asistencia' : lang === 'pt' ? 'Presença' : lang === 'bn' ? 'উপস্থিতি' : 'Attendance'}: ${summary}`,
    dateStr ? `${lang === 'es' ? 'Cuándo' : lang === 'pt' ? 'Quando' : lang === 'bn' ? 'সময়' : 'When'}: ${dateStr}` : '',
    ``,
    participants?.length ? `${textRows}${overflow > 0 ? `\n  ${overflowText(overflow)}` : ''}` : '',
    ``,
    `${openSheetText}: ${sheetUrl}`,
    `${viewOnWebText.replace(' →', '')}: ${meetingLink}`,
    seriesLink ? seriesTrendPlain(seriesLink) : '',
    ``,
    ...(isPro ? [] : [
      reviewBoxPlainPrompt,
      reviewUrl,
    ]),
    unsubscribeFooter(to).text,
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [
      { name: 'type', value: 'export_notification' },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'export notification', { sheetUrl, lang });
}

// Daily series attendance alert. Batched: one email per user per day,
// listing every triggered rule across all their series. The point is to
// give the user a reason to come back to the product — so the CTA is a
// "View series →" link, not a static report.
async function sendSeriesAlertEmail({ to, displayName, alerts, language, country, domain }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!alerts?.length) return { skipped: 'no alerts' };

  const resolvedDomain = domain || (to && to.includes('@') ? to.split('@')[1] : null);
  try {
    const { isNotificationCategoryEnabled } = require('../services/firestore');
    if (await isNotificationCategoryEnabled(resolvedDomain, to, 'seriesAlerts') === false) {
      log.info('series alert email skipped — user disabled seriesAlerts', { to });
      return { skipped: 'opted out of seriesAlerts' };
    }
  } catch {}

  const lang = resolveLanguage({ language, country, domain: resolvedDomain, email: to });

  let fallbackSomeone = 'Someone';
  let subject = alerts.length === 1
    ? `Attendance alert: ${alerts[0].personName || alerts[0].personEmail || fallbackSomeone} ${alerts[0].detail}`
    : `${alerts.length} attendance alerts from your recurring meetings`;

  let greeting = displayName ? `Hi ${escape(displayName.split(' ')[0])},` : 'Hi,';
  let leadHtml = alerts.length === 1
    ? `There's an attendance change in one of your recurring meetings:`
    : `There are ${alerts.length} attendance changes across your recurring meetings:`;
  let itemAttendedSummary = (attended, instanceCount) => `${attended} of ${instanceCount} instances attended overall`;
  let badgeText = '📊 Series Alert';
  let ctaText = 'View series →';
  let footerNotice = `You're getting this because you tracked recurring meetings with Attendance Tracker. Alerts run once per day if there's something worth flagging — no email if there's nothing new.`;

  if (lang === 'es') {
    fallbackSomeone = 'Alguien';
    subject = alerts.length === 1
      ? `Alerta de asistencia: ${alerts[0].personName || alerts[0].personEmail || fallbackSomeone} ${alerts[0].detail}`
      : `${alerts.length} alertas de asistencia de tus reuniones recurrentes`;
    greeting = displayName ? `Hola ${escape(displayName.split(' ')[0])},` : 'Hola,';
    leadHtml = alerts.length === 1
      ? `Hay un cambio en la asistencia de una de tus reuniones recurrentes:`
      : `Hay ${alerts.length} cambios de asistencia en tus reuniones recurrentes:`;
    itemAttendedSummary = (attended, instanceCount) => `${attended} de ${instanceCount} sesiones asistidas en total`;
    badgeText = '📊 Alerta de serie';
    ctaText = 'Ver series →';
    footerNotice = `Recibes esto porque registraste reuniones recurrentes con Attendance Tracker. Las alertas se envían una vez al día si hay algo destacable — no recibirás correos si no hay novedades.`;
  } else if (lang === 'pt') {
    fallbackSomeone = 'Alguém';
    subject = alerts.length === 1
      ? `Alerta de presença: ${alerts[0].personName || alerts[0].personEmail || fallbackSomeone} ${alerts[0].detail}`
      : `${alerts.length} alertas de presença das suas reuniões recorrentes`;
    greeting = displayName ? `Olá ${escape(displayName.split(' ')[0])},` : 'Olá,';
    leadHtml = alerts.length === 1
      ? `Há uma mudança de presença em uma de suas reuniões recorrentes:`
      : `Há ${alerts.length} mudanças de presença em suas reuniões recorrentes:`;
    itemAttendedSummary = (attended, instanceCount) => `${attended} de ${instanceCount} sessões comparecidas no total`;
    badgeText = '📊 Alerta de série';
    ctaText = 'Ver séries →';
    footerNotice = `Você está recebendo este e-mail porque registrou reuniões recorrentes com o Attendance Tracker. Os alertas são enviados uma vez por dia quando há algo importante — nenhum e-mail é enviado se não houver novidades.`;
  } else if (lang === 'bn') {
    fallbackSomeone = 'কেউ একজন';
    subject = alerts.length === 1
      ? `উপস্থিতির সতর্কতা: ${alerts[0].personName || alerts[0].personEmail || fallbackSomeone} ${alerts[0].detail}`
      : `আপনার নিয়মিত মিটিংগুলো থেকে ${alerts.length}টি উপস্থিতির সতর্কতা`;
    greeting = displayName ? `হ্যালো ${escape(displayName.split(' ')[0])},` : 'হ্যালো,';
    leadHtml = alerts.length === 1
      ? `আপনার একটি নিয়মিত মিটিংয়ে উপস্থিতিতে পরিবর্তন হয়েছে:`
      : `আপনার নিয়মিত মিটিংগুলোতে ${alerts.length}টি উপস্থিতিতে পরিবর্তন হয়েছে:`;
    itemAttendedSummary = (attended, instanceCount) => `সর্বমোট ${instanceCount}টি সেশনের মধ্যে ${attended}টিতে উপস্থিত`;
    badgeText = '📊 সিরিজের সতর্কতা';
    ctaText = 'সিরিজ দেখুন →';
    footerNotice = `আপনি Attendance Tracker দিয়ে নিয়মিত মিটিং ট্র্যাক করায় এই ইমেইলটি পাঠানো হয়েছে। কোনো পরিবর্তন থাকলে দিনে একবার সতর্কতা পাঠানো হয় — নতুন কিছু না থাকলে কোনো ইমেইল পাঠানো হয় না।`;
  }

  const itemHtml = alerts.map(a => `
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:14px;color:#e6edf3;"><strong style="color:#58a6ff;">${escape(a.personName || a.personEmail || fallbackSomeone)}</strong> ${escape(a.detail)}.</div>
      <div style="color:#8b949e;font-size:12px;margin-top:4px;">${escape(itemAttendedSummary(a.attended, a.instanceCount))}</div>
    </div>
  `).join('');

  const contentHtml = `
    <p style="margin:0 0 8px;font-size:15px;color:#e6edf3;">${escape(greeting)}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#8b949e;">${escape(leadHtml)}</p>
    <div style="margin:16px 0;">${itemHtml}</div>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'info',
    title: subject,
    contentHtml,
    ctaText,
    ctaUrl: 'https://attendancetracker.dev/history.html',
    ctaColor: 'blue',
    footerHtml: `<p style="margin:0 0 8px;font-size:12px;color:#8b949e;">${escape(footerNotice)}</p>${foot.html}`,
  });
  const text = [
    greeting,
    '',
    leadHtml,
    '',
    ...alerts.map(a => `  - ${a.personName || a.personEmail || fallbackSomeone} ${a.detail}. (${a.attended}/${a.instanceCount})`),
    '',
    `${ctaText.replace(' →', '')}: https://attendancetracker.dev/history.html`,
    foot.text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [
      { name: 'type', value: 'series_alert' },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'series alert email', { alertCount: alerts.length, lang });
}

// In-product feedback widget submissions. Lands in your inbox with full
// context (user email, where they were in the app, what they wrote) so you
// can reply quickly. Throws on failure — caller decides whether to retry.
async function sendFeedbackEmail({ body, fromEmail, fromName, source, conferenceId, userAgent }) {
  if (!body) throw new Error('body is required');
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to) throw new Error('NOTIFY_EMAIL or GMAIL_USER must be set as the destination inbox');
  const subjectName = fromName || fromEmail || 'Anonymous';
  const subject = `💬 Feedback from ${subjectName}: ${String(body).slice(0, 60).replace(/\s+/g, ' ')}${body.length > 60 ? '…' : ''}`;
  
  const contentHtml = `
    <div style="background:#0d1117;border-left:3px solid #4ade80;border-top:1px solid #30363d;border-right:1px solid #30363d;border-bottom:1px solid #30363d;border-radius:6px;padding:12px 14px;margin:0 0 16px;white-space:pre-wrap;word-break:break-word;color:#e6edf3;font-size:14px;line-height:1.5;box-sizing:border-box;">${escape(body)}</div>
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;font-size:13px;width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;width:32%;max-width:100px;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">From</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(fromName || '')} ${fromEmail ? `&lt;<a href="mailto:${escape(fromEmail)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(fromEmail)}</a>&gt;` : '(no email)'}</td></tr>
      ${source ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(source)}</td></tr>` : ''}
      ${conferenceId ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Meeting</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#58a6ff;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-all;">${escape(conferenceId)}</code></td></tr>` : ''}
      ${userAgent ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">User agent</td><td style="padding:8px 10px;color:#8b949e;font-size:11px;word-break:break-all;overflow-wrap:anywhere;">${escape(userAgent)}</td></tr>` : ''}
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: '💬 Feedback',
    badgeType: 'info',
    title: `💬 Feedback from ${escape(subjectName)}`,
    subtitle: 'Submitted from Attendance Tracker',
    contentHtml,
    ctaText: fromEmail ? `Reply to ${fromName || fromEmail} →` : null,
    ctaUrl: fromEmail ? `mailto:${fromEmail}` : null,
    ctaColor: 'green',
  });
  const text = [
    body,
    '',
    '---',
    `From: ${fromName || ''} ${fromEmail ? '<' + fromEmail + '>' : ''}`.trim(),
    source ? `Source: ${source}` : '',
    conferenceId ? `Meeting: ${conferenceId}` : '',
  ].filter(Boolean).join('\n');

  return send({
    from: makeFrom('Attendance Tracker feedback'),
    to,
    subject,
    text,
    html,
    replyTo: fromEmail || ownerEmail(),
    tags: [{ name: 'type', value: 'feedback' }],
  });
}

// Re-engagement / lifecycle emails feel like a personal check-in, not a product
// notification: From-name "Derek Gallardo" (not "Attendance Tracker"), plain
// prose paragraphs, reply-to the owner inbox, and a one-click unsubscribe
// footer. This helper captures that shared scaffold; each caller only supplies
// the subject, the body lines, and a Resend tag.
//
// - `lines` are the body paragraphs; the "Hey {firstName}," greeting + blank
//   line are prepended automatically.
// - `htmlLineTransform(line)` optionally returns custom HTML for a given line
//   (e.g. turning a "Your series so far:" line into a link); return falsy to
//   use the default paragraph rendering.
function formatEmailText(str) {
  if (!str) return '';
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = str.split(urlRegex);
  return parts.map(part => {
    if (part.match(/^https?:\/\//)) {
      return `<a href="${escape(part)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(part)}</a>`;
    }
    return escape(part);
  }).join('');
}

function renderPersonalEmailLine(l) {
  const trimmed = (l || '').trim();
  if (!trimmed) {
    return '<div style="height:12px;"></div>';
  }
  // Numbered step (e.g. "1. Open Google Meet...", "১. Google Meet...")
  const stepMatch = trimmed.match(/^(\d+|[১-৯])[\.\)]\s*(.*)$/);
  if (stepMatch) {
    const num = stepMatch[1];
    const rest = stepMatch[2];
    return `<div style="margin:0 0 10px;padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:8px;font-size:13.5px;line-height:1.55;color:#e6edf3;box-sizing:border-box;"><span style="display:inline-block;min-width:20px;font-weight:700;color:#4ade80;">${escape(num)}.</span> ${formatEmailText(rest)}</div>`;
  }
  // Callouts / Tips (e.g. "Tip: ...", "Consejo: ...", "Dica: ...", "টিপস: ...")
  const tipMatch = trimmed.match(/^(Tip:|Consejo:|Dica:|টিপস:|Un consejo:|Uma dica:)\s*(.*)$/i);
  if (tipMatch) {
    return `<div style="margin:14px 0;padding:12px 14px;background:#0d1117;border-left:3px solid #58a6ff;border-top:1px solid #30363d;border-right:1px solid #30363d;border-bottom:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:13px;line-height:1.55;box-sizing:border-box;"><strong style="color:#58a6ff;">💡 ${escape(tipMatch[1])}</strong> ${formatEmailText(tipMatch[2])}</div>`;
  }
  // Signoff lines
  const isSignoff = /^(—\s*Derek|-\s*Derek|Best,|Un saludo,|Abraços,|শুভেচ্ছান্তে,|Derek|Creator of Attendance Tracker|Creador de Attendance Tracker|Criador do Attendance Tracker|Creator, Attendance Tracker|attendancetracker\.dev|https:\/\/attendancetracker\.dev)$/i.test(trimmed);
  if (isSignoff) {
    const isUrl = /attendancetracker\.dev/i.test(trimmed);
    return `<p style="margin:0 0 4px;font-size:13px;line-height:1.4;color:#8b949e;">${isUrl ? '<a href="https://attendancetracker.dev" style="color:#58a6ff;text-decoration:none;">attendancetracker.dev</a>' : escape(trimmed)}</p>`;
  }
  // Regular paragraph
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#e6edf3;">${formatEmailText(l)}</p>`;
}

async function sendPersonalEmail({
  to, displayName, subject, lines, tags, htmlLineTransform, logLabel, logMeta,
  language, country, domain, badge, badgeType = 'info', title, subtitle,
  ctaText = null, ctaUrl = null, ctaColor = 'green', extraHtml = null,
}) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });
  const firstName = displayName ? displayName.split(' ')[0] : null;
  let hi;
  if (lang === 'es') hi = firstName ? `Hola ${firstName},` : 'Hola,';
  else if (lang === 'pt') hi = firstName ? `Olá ${firstName},` : 'Olá,';
  else if (lang === 'bn') hi = firstName ? `হ্যালো ${firstName},` : 'হ্যালো,';
  else hi = firstName ? `Hey ${firstName},` : 'Hey,';

  const body = [hi, '', ...lines].join('\n');
  const foot = unsubscribeFooter(to, lang);

  const contentLinesHtml = body.split('\n')
    .map(l => (htmlLineTransform && htmlLineTransform(l)) || renderPersonalEmailLine(l))
    .join('');

  const contentHtml = extraHtml ? `${contentLinesHtml}${extraHtml}` : contentLinesHtml;

  // Resolve badge if not passed explicitly
  const typeTag = tags?.find(t => t.name === 'type')?.value || logLabel;
  let resolvedBadge = badge;
  let resolvedBadgeType = badgeType;
  if (!resolvedBadge) {
    if (typeTag === 'welcome') {
      resolvedBadge = lang === 'es' ? '👋 Bienvenido' : (lang === 'pt' ? '👋 Bem-vindo' : (lang === 'bn' ? '👋 স্বাগতম' : '👋 Welcome'));
      resolvedBadgeType = 'success';
    } else if (typeTag === 'reactivation') {
      resolvedBadge = lang === 'es' ? '👋 Seguimiento' : (lang === 'pt' ? '👋 Olá' : (lang === 'bn' ? '👋 অনুসন্ধান' : '👋 Quick Check-in'));
      resolvedBadgeType = 'info';
    } else if (typeTag === 'activation_nudge') {
      resolvedBadge = lang === 'es' ? '🚀 Primeros pasos' : (lang === 'pt' ? '🚀 Primeiros passos' : (lang === 'bn' ? '🚀 শুরু করা যাক' : '🚀 Getting Started'));
      resolvedBadgeType = 'info';
    } else if (typeTag === 'solo_nudge') {
      resolvedBadge = lang === 'es' ? '💡 Siguiente paso' : (lang === 'pt' ? '💡 Próximo passo' : (lang === 'bn' ? '💡 পরবর্তী ধাপ' : '💡 Next Step'));
      resolvedBadgeType = 'info';
    } else if (typeTag === 'upcoming_reminder') {
      resolvedBadge = lang === 'es' ? '⏰ Recordatorio' : (lang === 'pt' ? '⏰ Lembrete' : (lang === 'bn' ? '⏰ অনুস্মারক' : '⏰ Starting Soon'));
      resolvedBadgeType = 'info';
    } else if (typeTag === 'forgotten_meeting') {
      resolvedBadge = lang === 'es' ? '📅 Recordatorio de racha' : (lang === 'pt' ? '📅 Lembrete de frequência' : (lang === 'bn' ? '📅 ধারাবাহিকতার অনুস্মারক' : '📅 Streak Reminder'));
      resolvedBadgeType = 'warning';
    } else if (typeTag === 'comeback_7d') {
      resolvedBadge = lang === 'es' ? '📊 Panel web' : (lang === 'pt' ? '📊 Painel web' : (lang === 'bn' ? '📊 ড্যাশবোর্ড' : '📊 Next Meeting'));
      resolvedBadgeType = 'info';
    } else if (typeTag === 'export_gap') {
      resolvedBadge = lang === 'es' ? '📄 Reporte pendiente' : (lang === 'pt' ? '📄 Relatório pendente' : (lang === 'bn' ? '📄 রিপোর্ট সংগ্রহ করুন' : '📄 Missing Report'));
      resolvedBadgeType = 'warning';
    } else if (typeTag === 'referral') {
      resolvedBadge = lang === 'es' ? '🎁 Recompensa' : (lang === 'pt' ? '🎁 Recompensa' : (lang === 'bn' ? '🎁 রেফারেল পুরস্কার' : '🎁 Referral Reward'));
      resolvedBadgeType = 'success';
    }
  }

  // Resolve CTA if not passed explicitly
  let resolvedCtaText = ctaText;
  let resolvedCtaUrl = ctaUrl;
  let resolvedCtaColor = ctaColor;
  if (!resolvedCtaText && !resolvedCtaUrl) {
    if (typeTag === 'welcome') {
      resolvedCtaText = lang === 'es' ? 'Abrir Google Meet →' : (lang === 'pt' ? 'Abrir o Google Meet →' : (lang === 'bn' ? 'Google Meet খুলুন →' : 'Open Google Meet →'));
      resolvedCtaUrl = 'https://meet.google.com';
      resolvedCtaColor = 'green';
    } else if (typeTag === 'activation_nudge') {
      resolvedCtaText = lang === 'es' ? 'Iniciar una llamada en Meet →' : (lang === 'pt' ? 'Iniciar chamada no Meet →' : (lang === 'bn' ? 'Google Meet চালু করুন →' : 'Start a Google Meet →'));
      resolvedCtaUrl = 'https://meet.google.com';
      resolvedCtaColor = 'green';
    } else if (typeTag === 'solo_nudge') {
      resolvedCtaText = lang === 'es' ? 'Probar en una reunión real →' : (lang === 'pt' ? 'Testar em uma reunião real →' : (lang === 'bn' ? 'আসল মিটিংয়ে চেষ্টা করুন →' : 'Try with a Real Meeting →'));
      resolvedCtaUrl = 'https://meet.google.com';
      resolvedCtaColor = 'green';
    } else if (typeTag === 'upcoming_reminder') {
      resolvedCtaText = lang === 'es' ? 'Unirse a Google Meet →' : (lang === 'pt' ? 'Entrar no Google Meet →' : (lang === 'bn' ? 'Google Meet-এ যোগ দিন →' : 'Join Google Meet →'));
      resolvedCtaUrl = 'https://meet.google.com';
      resolvedCtaColor = 'green';
    } else if (typeTag === 'reactivation') {
      resolvedCtaText = lang === 'es' ? 'Abrir Attendance Tracker →' : (lang === 'pt' ? 'Abrir o Attendance Tracker →' : (lang === 'bn' ? 'Attendance Tracker খুলুন →' : 'Open Attendance Tracker →'));
      resolvedCtaUrl = 'https://attendancetracker.dev/history.html';
      resolvedCtaColor = 'blue';
    } else if (typeTag === 'comeback_7d') {
      resolvedCtaText = lang === 'es' ? 'Abrir panel web →' : (lang === 'pt' ? 'Abrir painel web →' : (lang === 'bn' ? 'ড্যাশবোর্ড খুলুন →' : 'Open Web Dashboard →'));
      resolvedCtaUrl = 'https://attendancetracker.dev/history.html';
      resolvedCtaColor = 'blue';
    } else if (typeTag === 'export_gap') {
      resolvedCtaText = lang === 'es' ? 'Ver panel y exportar →' : (lang === 'pt' ? 'Ver painel e exportar →' : (lang === 'bn' ? 'ড্যাশবোর্ড ও এক্সপোর্ট →' : 'View Dashboard & Export →'));
      resolvedCtaUrl = 'https://attendancetracker.dev/history.html';
      resolvedCtaColor = 'green';
    } else if (typeTag === 'referral') {
      resolvedCtaText = lang === 'es' ? 'Abrir Attendance Tracker →' : (lang === 'pt' ? 'Abrir o Attendance Tracker →' : (lang === 'bn' ? 'Attendance Tracker খুলুন →' : 'Open Attendance Tracker →'));
      resolvedCtaUrl = 'https://attendancetracker.dev/history.html';
      resolvedCtaColor = 'green';
    }
  }

  const html = buildDesignSystemEmail({
    badge: resolvedBadge,
    badgeType: resolvedBadgeType,
    title: title !== undefined ? title : subject,
    subtitle,
    contentHtml,
    ctaText: resolvedCtaText,
    ctaUrl: resolvedCtaUrl,
    ctaColor: resolvedCtaColor,
    footerHtml: foot.html.replace('margin:24px 0 0;', 'margin:0;'),
  });

  return dispatchEmail({
    from: makeFrom('Derek Gallardo'),
    to, subject,
    text: body + foot.text,
    html,
    replyTo: ownerEmail(),
    tags: tags ? (tags.some(t => t.name === 'lang') ? tags : [...tags, { name: 'lang', value: lang }]) : [{ name: 'lang', value: lang }],
    headers: unsubscribeHeaders(to),
  }, `${logLabel} email`, { ...logMeta, lang });
}

async function sendWelcomeEmail({ to, displayName, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let subject = 'Welcome to Attendance Tracker for Google Meet';
  let lines;

  if (lang === 'es') {
    subject = '¡Bienvenido a Attendance Tracker para Google Meet!';
    lines = [
      '¡Gracias por instalar Attendance Tracker para Google Meet!',
      '',
      'Aquí te muestro cómo registrar tu primera reunión o clase en 3 sencillos pasos:',
      '',
      '1. Abre Google Meet e inicia o únete a cualquier llamada.',
      '2. Haz clic en el icono de Actividades (figuras geométricas abajo a la derecha) y abre Attendance Tracker.',
      '3. Haz clic en "Iniciar" — los horarios de entrada, salida y permanencia se registran en vivo. Cuando termines, haz clic en "Hoja" para exportar a Google Sheets en un solo clic.',
      '',
      'Consejo: Si estás probando en una llamada vacía, haz clic en "¿Probando en solitario? Carga 10 estudiantes de prueba" dentro del panel lateral para ver cómo funciona antes de tu próxima clase.',
      '',
      'Mira una demo rápida en video de 30 segundos: https://youtu.be/WqX-LxjjY04',
      '',
      'Si tienes cualquier pregunta o sugerencia, solo responde directamente a este correo — leo cada respuesta.',
      '',
      'Un saludo,',
      'Derek',
      'Creador de Attendance Tracker',
      'https://attendancetracker.dev',
    ];
  } else if (lang === 'pt') {
    subject = 'Bem-vindo ao Attendance Tracker para o Google Meet!';
    lines = [
      'Obrigado por instalar o Attendance Tracker para o Google Meet!',
      '',
      'Veja como registrar a frequência da sua primeira reunião ou aula em 3 passos rápidos:',
      '',
      '1. Abra o Google Meet e inicie ou entre em uma chamada.',
      '2. Clique no ícone de Atividades (formas geométricas no canto inferior direito) e abra o Attendance Tracker.',
      '3. Clique em "Iniciar" — horários de entrada, saída e permanência são acompanhados ao vivo. Quando terminar, clique em "Planilha" para exportar para o Google Sheets em um só clique.',
      '',
      'Dica: Se você estiver testando sozinho em uma chamada vazia, clique em "Testando sozinho? Carregar 10 alunos de teste" no painel lateral para ver como funciona.',
      '',
      'Veja uma demonstração rápida de 30 segundos em vídeo: https://youtu.be/WqX-LxjjY04',
      '',
      'Se tiver qualquer dúvida ou sugestão, basta responder diretamente a este e-mail — eu leio todas as respostas.',
      '',
      'Abraços,',
      'Derek',
      'Criador do Attendance Tracker',
      'https://attendancetracker.dev',
    ];
  } else if (lang === 'bn') {
    subject = 'Google Meet-এর জন্য Attendance Tracker-এ স্বাগতম!';
    lines = [
      'Google Meet-এর জন্য Attendance Tracker ইনস্টল করার জন্য ধন্যবাদ!',
      '',
      '৩টি সহজ ধাপে আপনার প্রথম মিটিং বা ক্লাসের উপস্থিতি রেকর্ড করুন:',
      '',
      '১. Google Meet খুলুন এবং যেকোনো কলে যোগ দিন।',
      '২. নিচের ডানদিকের Activities আইকনে ক্লিক করে Attendance Tracker খুলুন।',
      '৩. "Start" এ ক্লিক করুন — যোগদানের সময় এবং থাকার সময় লাইভ ট্র্যাক হবে। শেষে "Sheet" এ ক্লিক করে এক কলিকে Google Sheets-এ এক্সপোর্ট করুন।',
      '',
      'টিপস: আপনি যদি একা পরীক্ষা করতে চান, তবে প্যানেলে "Testing solo? Load 10 demo students"-এ ক্লিক করে দেখতে পারেন।',
      '',
      '৩০ সেকেন্ডের ভিডিও ডেমো দেখুন: https://youtu.be/WqX-LxjjY04',
      '',
      'কোনো প্রশ্ন থাকলে সরাসরি এই ইমেলের উত্তর দিন — আমি প্রতিটি বার্তা নিজে পড়ি।',
      '',
      'শুভেচ্ছান্তে,',
      'Derek',
      'Creator, Attendance Tracker',
      'https://attendancetracker.dev',
    ];
  } else {
    lines = [
      `Thanks for installing Attendance Tracker for Google Meet!`,
      '',
      `Here is how to track your first meeting in 3 quick steps:`,
      '',
      `1. Open Google Meet and start or join any call.`,
      `2. Click the Activities icon (shapes in the bottom-right corner) and open Attendance Tracker.`,
      `3. Click "Start" — join times, leave times, and stay durations update live. When you're ready, click "Sheet" to export to Google Sheets in one click.`,
      '',
      `Tip: If you're testing right now in an empty call, click "Testing solo? Load 10 demo students" inside the side panel to see how it works before your next real meeting.`,
      '',
      `Watch the 30-second video demo: https://youtu.be/WqX-LxjjY04`,
      '',
      `If you have any questions or run into anything, just reply directly to this email — I read every response.`,
      '',
      'Best,',
      'Derek',
      'Creator of Attendance Tracker',
      'https://attendancetracker.dev',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    tags: [{ name: 'type', value: 'welcome' }],
    logLabel: 'welcome', logMeta: {},
    language: lang, country, domain,
  });
}

async function sendReactivationEmail({ to, displayName, daysSinceLogin, variant, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let subject;
  let lines;

  if (lang === 'es') {
    if (variant === '7d') {
      subject = '¿Cómo van tus clases con Attendance Tracker?';
      lines = [
        'Ha pasado aproximadamente una semana desde que usaste Attendance Tracker por última vez. Una pregunta rápida: ¿hubo algo confuso o alguna función que te haya hecho falta para tus clases o reuniones?',
        '',
        'Si tienes un par de minutos, responde a este correo y cuéntame qué te gustaría ver. Estoy construyendo esto basándome directamente en la experiencia de educadores como tú.',
        '',
        '— Derek',
        'attendancetracker.dev',
      ];
    } else {
      subject = '¿Prefieres que elimine tu cuenta de Attendance Tracker?';
      lines = [
        'Creaste tu cuenta de Attendance Tracker hace un mes y no has vuelto a usarla. Dos preguntas rápidas:',
        '',
        '1) ¿Le faltó algo a la aplicación para adaptarse a tus clases o reuniones? Agradecería mucho tus comentarios para poder mejorarla.',
        '',
        '2) Si prefieres que elimine tu cuenta y datos guardados, dímelo con total confianza y lo haré de inmediato.',
        '',
        'En cualquier caso está perfecto, solo quería saber cómo ayudarte.',
        '',
        '— Derek',
      ];
    }
  } else if (lang === 'pt') {
    if (variant === '7d') {
      subject = 'Como estão suas reuniões no Attendance Tracker?';
      lines = [
        'Faz cerca de uma semana desde a última vez que você abriu o Attendance Tracker. Uma pergunta rápida: faltou alguma funcionalidade ou houve algo confuso no uso para suas aulas ou reuniões?',
        '',
        'Se tiver dois minutinhos, responda a este e-mail e me conte o que você gostaria de ver. Estou desenvolvendo esta ferramenta para atender às reais necessidades de quem a utiliza no dia a dia.',
        '',
        '— Derek',
        'attendancetracker.dev',
      ];
    } else {
      subject = 'Você prefere que eu exclua sua conta do Attendance Tracker?';
      lines = [
        'Você criou sua conta no Attendance Tracker há cerca de um mês e não retornou. Duas perguntas rápidas:',
        '',
        '1) Faltou algo no aplicativo para o seu dia a dia? Adoraria receber seu feedback para continuar melhorando.',
        '',
        '2) Se preferir que eu exclua sua conta e todos os dados armazenados, basta me avisar — sem nenhum problema.',
        '',
        'De qualquer forma, agradeço pelo seu tempo.',
        '',
        '— Derek',
      ];
    }
  } else if (lang === 'bn') {
    if (variant === '7d') {
      subject = 'Attendance Tracker কেমন কাজ করছে আপনার জন্য?';
      lines = [
        'আপনি প্রায় এক সপ্তাহ আগে Attendance Tracker ব্যবহার করেছিলেন। একটি দ্রুত প্রশ্ন — আপনার ক্লাসে ব্যবহারের জন্য কি কোনো ফিচারের অভাব ছিল বা কোনো কিছু বুঝতে সমস্যা হয়েছে?',
        '',
        'দুই মিনিট সময় থাকলে এই ইমেইলে উত্তর দিয়ে জানান আপনি কী দেখতে চান।',
        '',
        '— Derek',
        'attendancetracker.dev',
      ];
    } else {
      subject = 'আমি কি আপনার Attendance Tracker অ্যাকাউন্ট মুছে দেব?';
      lines = [
        'আপনি প্রায় এক মাস আগে অ্যাকাউন্ট তৈরি করেছিলেন। দুটি দ্রুত প্রশ্ন:',
        '',
        '১) অ্যাপটিতে কি আপনার প্রয়োজনীয় কোনো ফিচারের ঘাটতি ছিল? আপনার মতামত পেলে খুব উপকৃত হব।',
        '',
        '২) আপনি যদি চান আমি আপনার অ্যাকাউন্ট এবং সংরক্ষিত ডেটা মুছে দিই, নিঃসংকোচে জানাতে পারেন।',
        '',
        'যেকোনো প্রতিক্রিয়াই সাদরে গ্রহণযোগ্য।',
        '',
        '— Derek',
      ];
    }
  } else {
    subject = variant === '7d' ? 'Quick check-in on Attendance Tracker' : 'Should I delete your Attendance Tracker account?';
    lines = variant === '7d' ? [
      `It's been about a week since you last opened Attendance Tracker. Quick question — was there something missing or confusing that kept you from using it for your meetings?`,
      '',
      `If you've got two minutes, hit reply and tell me what you'd want to see. I'm building this for actual users, not in a vacuum.`,
      '',
      '— Derek',
      'attendancetracker.dev',
    ] : [
      `You signed up for Attendance Tracker about a month ago and haven't been back. Two questions:`,
      '',
      `1) Was the product missing something? If you'd reply with what would've made it useful for your workflow, I'd genuinely appreciate the signal.`,
      '',
      `2) If you'd rather I delete your account and any stored data, just say the word — no hard feelings.`,
      '',
      'Either way is fine. I just want to know.',
      '',
      '— Derek',
    ];
  }

  const isDeleteVariant = variant !== '7d';
  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: isDeleteVariant
      ? (lang === 'es' ? '❓ Estado de cuenta' : (lang === 'pt' ? '❓ Status da conta' : (lang === 'bn' ? '❓ অ্যাকাউন্টের অবস্থা' : '❓ Account Status')))
      : (lang === 'es' ? '👋 Seguimiento' : (lang === 'pt' ? '👋 Olá' : (lang === 'bn' ? '👋 অনুসন্ধান' : '👋 Quick Check-in'))),
    badgeType: 'info',
    tags: [{ name: 'type', value: 'reactivation' }, { name: 'variant', value: variant }],
    logLabel: 'reactivation', logMeta: { variant, daysSinceLogin },
    language: lang, country, domain,
  });
}

// Activation nudge for people who signed up but never tracked a meeting — a
// short how-to-start, not a win-back.
async function sendActivationNudgeEmail({ to, displayName, daysSinceLogin, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let subject = 'Getting started with Attendance Tracker';
  let lines;

  if (lang === 'es') {
    subject = 'Cómo empezar con Attendance Tracker';
    lines = [
      'Te registraste en Attendance Tracker pero aún no has tomado asistencia en una reunión o clase. Solo toma 30 segundos:',
      '',
      '1. Inicia o únete a una llamada en Google Meet.',
      '2. Abre Attendance Tracker desde el panel de Actividades (abajo a la derecha en Meet).',
      '3. Presiona Iniciar — registrará quién entra, quién sale y cuánto tiempo permanecieron, y luego podrás exportarlo a Google Sheets al terminar.',
      '',
      'Si algo te detuvo (configuración, permisos o dudas), responde directamente a este correo. Leo cada mensaje.',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else if (lang === 'pt') {
    subject = 'Como começar com o Attendance Tracker';
    lines = [
      'Você se cadastrou no Attendance Tracker mas ainda não registrou presença em nenhuma reunião ou aula. Leva apenas 30 segundos:',
      '',
      '1. Inicie ou entre em uma chamada no Google Meet.',
      '2. Abra o Attendance Tracker no painel de Atividades (canto inferior direito no Meet).',
      '3. Clique em Iniciar — ele registra quem entra, quem sai e o tempo de permanência, exportando para o Google Sheets ao final.',
      '',
      'Se algo impediu seu uso (permissões, dúvidas ou configuração), basta responder a este e-mail. Eu leio todas as mensagens.',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else if (lang === 'bn') {
    subject = 'Attendance Tracker দিয়ে কীভাবে শুরু করবেন';
    lines = [
      'আপনি Attendance Tracker-এ সাইন আপ করেছেন কিন্তু এখনো উপস্থিতি নেননি। এটি শুরু করতে মাত্র ৩০ সেকেন্ড সময় লাগে:',
      '',
      '১. Google Meet চালু করুন বা যোগ দিন।',
      '২. নিচের ডানদিকের Activities প্যানেল থেকে Attendance Tracker খুলুন।',
      '৩. Start চাপুন — কে কখন যোগ দিল বা বের হলো তা রেকর্ড হবে এবং শেষে Google Sheets-এ এক্সপোর্ট করতে পারবেন।',
      '',
      'কোনো সমস্যা থাকলে সরাসরি এই ইমেলের উত্তর দিন।',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else {
    lines = [
      "You signed up for Attendance Tracker but haven't taken attendance in a meeting yet. It takes about 30 seconds:",
      '',
      '1. Start or join a Google Meet.',
      '2. Open Attendance Tracker from the Activities panel (bottom-right in Meet).',
      '3. Press Start — it tracks who joins, who leaves, and how long they stayed, then exports to a Google Sheet when the meeting ends.',
      '',
      "If something got in the way — setup, permissions, or it just didn't fit — hit reply and tell me. I read every one.",
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    tags: [{ name: 'type', value: 'activation_nudge' }],
    logLabel: 'activation nudge', logMeta: { daysSinceLogin },
    language: lang, country, domain,
  });
}

// For users who tried the tool but only on a solo test — move them from "tested
// it on myself" to "used it in a real meeting".
async function sendSoloNudgeEmail({ to, displayName, daysSinceLogin, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let subject = 'You tried Attendance Tracker solo — try it with a real meeting';
  let lines;

  if (lang === 'es') {
    subject = 'Probaste Attendance Tracker en solitario — pruébalo en una clase o reunión real';
    lines = [
      'Noté que probaste Attendance Tracker, pero parece que estabas solo en la llamada. Es la manera perfecta de explorar la herramienta, pero donde realmente brilla es cuando hay más personas en la llamada.',
      '',
      'La próxima vez que tengas una clase, reunión o sesión con alumnos o clientes, abre el panel y presiona Iniciar. Te mostrará exactamente quién llegó, quién salió, quién llegó tarde y guardará toda la lista en Google Sheets al terminar.',
      '',
      'Si algo te impide usarlo en tus reuniones reales, responde a este correo y cuéntame — tus comentarios valen oro.',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else if (lang === 'pt') {
    subject = 'Você testou o Attendance Tracker sozinho — experimente em uma reunião ou aula real';
    lines = [
      'Notei que você testou o Attendance Tracker, mas parece que estava sozinho na chamada. É a forma perfeita de conhecer a ferramenta, mas ela realmente se destaca quando há outras pessoas na sala.',
      '',
      'Na próxima vez que tiver uma aula, reunião ou chamada com alunos ou clientes, abra o painel e clique em Iniciar. Ele mostrará exatamente quem entrou, quem saiu, quem atrasou e salvará a lista completa no Google Sheets ao final.',
      '',
      'Se algo estiver impedindo o seu uso no dia a dia, responda a este e-mail — seu feedback é fundamental.',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else if (lang === 'bn') {
    subject = 'একটি বাস্তব মিটিং বা ক্লাসে Attendance Tracker ব্যবহার করে দেখুন';
    lines = [
      'আমি দেখেছি আপনি Attendance Tracker একা পরীক্ষা করেছেন। টুলটি বোঝার জন্য এটি চমৎকার, তবে অন্য মানুষ যখন কলে থাকে তখন এটি সবচেয়ে বেশি কার্যকর।',
      '',
      'পরের বার যখন আপনার আসল ক্লাস বা মিটিং থাকবে, প্যানেল খুলে Start চাপুন। কে যোগ দিল, কে বের হলো বা দেরি করল তা নির্ভুলভাবে রেকর্ড হয়ে Google Sheets-এ চলে যাবে।',
      '',
      'কোনো প্রশ্ন বা পরামর্শ থাকলে এই ইমেইলে উত্তর দিন।',
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  } else {
    lines = [
      "I noticed you gave Attendance Tracker a spin, but it looks like the meeting was just you. That's the perfect way to kick the tires — but it really earns its keep when other people are in the call.",
      '',
      "Next time you're in a real one — a class, a standup, a client call — open the panel and hit Start. It'll show you exactly who joined, who left, who was late, and drop the whole roll-call into a Google Sheet when the meeting ends.",
      '',
      "If something's getting in the way of using it for real, hit reply and tell me — that feedback is gold.",
      '',
      '— Derek',
      'attendancetracker.dev',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    tags: [{ name: 'type', value: 'solo_nudge' }],
    logLabel: 'solo nudge', logMeta: { daysSinceLogin },
    language: lang, country, domain,
  });
}

async function sendForgottenMeetingEmail({ to, displayName, seriesTitle, recurringEventId, trackedInWindow, daysSinceLast, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });
  const seriesLink = recurringEventId
    ? `https://attendancetracker.dev/history.html#series=${encodeURIComponent(recurringEventId)}`
    : 'https://attendancetracker.dev/history.html';

  let subject = `Forgot to track "${seriesTitle}"?`;
  let lines;
  let linkPrefix = 'Your series so far:';
  let linkLabel = 'view the trend →';
  const countTimes = trackedInWindow ? `${trackedInWindow} times` : 'regularly';
  const countVeces = trackedInWindow ? `${trackedInWindow} veces` : 'con frecuencia';
  const countVezes = trackedInWindow ? `${trackedInWindow} vezes` : 'com frequência';
  const countBar = trackedInWindow ? `${trackedInWindow} বার` : 'নিয়মিত';

  if (lang === 'es') {
    subject = `¿Olvidaste registrar la asistencia de "${seriesTitle}"?`;
    linkPrefix = 'Tu historial de la serie:';
    linkLabel = 'ver la tendencia →';
    lines = [
      `Registraste "${seriesTitle}" ${countVeces} en el último mes, pero han pasado ${daysSinceLast || 'varios'} días desde la última sesión. Si quieres mantener el registro al día, solo abre el panel de Attendance Tracker en tu próxima sesión.`,
      '',
      `Tu historial de la serie: ${seriesLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'pt') {
    subject = `Esqueceu de registrar a presença em "${seriesTitle}"?`;
    linkPrefix = 'Seu histórico da série:';
    linkLabel = 'ver tendência →';
    lines = [
      `Você registrou "${seriesTitle}" ${countVezes} no último mês, mas faz ${daysSinceLast || 'vários'} dias desde a última sessão. Para manter seu histórico em dia, basta abrir o painel do Attendance Tracker na próxima reunião.`,
      '',
      `Seu histórico da série: ${seriesLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'bn') {
    subject = `"${seriesTitle}"-এর উপস্থিতি নিতে কি ভুলে গেছেন?`;
    linkPrefix = 'আপনার সিরিজের হিস্ট্রি:';
    linkLabel = 'ট্রেন্ড দেখুন →';
    lines = [
      `আপনি গত মাসে "${seriesTitle}"-এ ${countBar} উপস্থিতি নিয়েছিলেন, কিন্তু শেষ সেশনের পর ${daysSinceLast || 'কয়েক'} দিন পার হয়ে গেছে। ধারাবাহিকতা বজায় রাখতে পরবর্তী মিটিংয়ে প্যানেলটি খুলুন।`,
      '',
      `আপনার সিরিজের হিস্ট্রি: ${seriesLink}`,
      '',
      '— Derek',
    ];
  } else {
    lines = [
      `You tracked "${seriesTitle}" ${countTimes} in the past month, but it's been ${daysSinceLast || 'a few'} days since the last one. If you want to keep the streak going, just open the Attendance Tracker side panel next time you're in that meeting — it picks up from where you left off.`,
      '',
      `Your series so far: ${seriesLink}`,
      '',
      '— Derek',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: lang === 'es' ? '📅 Recordatorio de racha' : (lang === 'pt' ? '📅 Lembrete de frequência' : (lang === 'bn' ? '📅 ধারাবাহিকতার অনুস্মারক' : '📅 Streak Reminder')),
    badgeType: 'warning',
    ctaText: lang === 'es' ? 'Ver tendencia de la serie →' : (lang === 'pt' ? 'Ver tendência da série →' : (lang === 'bn' ? 'সিরিজের ট্রেন্ড দেখুন →' : 'View Series Trend →')),
    ctaUrl: seriesLink,
    ctaColor: 'blue',
    htmlLineTransform: (l) => l.startsWith(linkPrefix) || l.startsWith('Your series so far:')
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#e6edf3;">${escape(l.split('http')[0])}<a href="${escape(seriesLink)}" style="color:#58a6ff;text-decoration:none;font-weight:600;">${linkLabel}</a></p>`
      : null,
    tags: [{ name: 'type', value: 'forgotten_meeting' }],
    logLabel: 'forgotten-meeting', logMeta: { recurringEventId, daysSinceLast },
    language: lang, country, domain,
  });
}

// Meeting-specific win-back for an activated user who tracked a one-off meeting
// and went quiet — the "come back and track your next one" nudge that a
// non-recurring tracker (e.g. a single class) previously never got (only the
// generic reactivation email). Fires once via the comeback_7d dedup slot.
async function sendComebackEmail({ to, displayName, meetingTitle, daysSinceLogin, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });
  const historyLink = 'https://attendancetracker.dev/history.html';
  const title = meetingTitle || (lang === 'es' ? 'tu última reunión' : (lang === 'pt' ? 'sua última reunião' : 'your last meeting'));

  let subject = 'Track your next meeting?';
  let lines;
  let linkPrefix = 'Your history:';
  let linkLabel = 'open your dashboard →';

  if (lang === 'es') {
    subject = '¿Registrar tu próxima reunión o clase?';
    linkPrefix = 'Tu historial:';
    linkLabel = 'abrir tu panel →';
    lines = [
      `Han pasado unos ${daysSinceLogin} días desde que registraste "${title}". La próxima vez que estés en una reunión o clase, solo abre el panel lateral de Attendance Tracker — registra quién entra, quién sale y cuánto tiempo permanecieron, y expórtalo a Google Sheets en un clic.`,
      '',
      'Un consejo: si es una clase que se repite, ponla en una invitación periódica de Google Calendar — así obtendrás tendencias de asistencia por alumno a lo largo del curso.',
      '',
      `Tu historial: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'pt') {
    subject = 'Registrar sua próxima reunião ou aula?';
    linkPrefix = 'Seu histórico:';
    linkLabel = 'abrir seu painel →';
    lines = [
      `Faz cerca de ${daysSinceLogin} dias desde que você registrou "${title}". Na próxima vez que estiver em uma chamada, abra o painel do Attendance Tracker — ele registra quem entrou, quem saiu e o tempo de permanência, exportando para o Sheets em um clique.`,
      '',
      'Uma dica: se for uma aula ou reunião recorrente, adicione-a no Google Calendar — assim você acompanha a frequência de cada participante ao longo de todas as sessões.',
      '',
      `Seu histórico: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'bn') {
    subject = 'পরবর্তী মিটিং বা ক্লাসের উপস্থিতি নেবেন?';
    linkPrefix = 'আপনার হিস্ট্রি:';
    linkLabel = 'ড্যাশবোর্ড খুলুন →';
    lines = [
      `আপনি প্রায় ${daysSinceLogin} দিন আগে "${title}" ট্র্যাক করেছিলেন। পরবর্তী মিটিংয়ে Attendance Tracker প্যানেল খুলে সহজেই উপস্থিতি সংরক্ষণ করুন।`,
      '',
      'টিপস: মিটিংটি নিয়মিত হলে Google Calendar-এ যোগ করুন, এতে পুরো কোর্সের ট্রেন্ড একসঙ্গে দেখতে পারবেন।',
      '',
      `আপনার হিস্ট্রি: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else {
    lines = [
      `It's been about ${daysSinceLogin} days since you tracked "${title}". Next time you're in a meeting, just open the Attendance Tracker side panel — it captures who joined, who left, and how long they stayed, then exports to Sheets in one click.`,
      '',
      'One tip: if it\'s a class or meeting that repeats, put it on a recurring Google Calendar invite — then you get per-person attendance trends across every session, not just a single day.',
      '',
      `Your history: ${historyLink}`,
      '',
      '— Derek',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: lang === 'es' ? '📊 Panel web' : (lang === 'pt' ? '📊 Painel web' : (lang === 'bn' ? '📊 ড্যাশবোর্ড' : '📊 Next Meeting')),
    badgeType: 'info',
    ctaText: lang === 'es' ? 'Abrir panel web →' : (lang === 'pt' ? 'Abrir painel web →' : (lang === 'bn' ? 'ড্যাশবোর্ড খুলুন →' : 'Open Web Dashboard →')),
    ctaUrl: historyLink,
    ctaColor: 'blue',
    htmlLineTransform: (l) => l.startsWith(linkPrefix) || l.startsWith('Your history:')
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#e6edf3;">${escape(l.split('http')[0])}<a href="${escape(historyLink)}" style="color:#58a6ff;text-decoration:none;font-weight:600;">${linkLabel}</a></p>`
      : null,
    tags: [{ name: 'type', value: 'comeback_7d' }],
    logLabel: 'comeback', logMeta: { daysSinceLogin },
    language: lang, country, domain,
  });
}

// Export-gap win-back: the user tracked a real (multi-person) meeting but never
// saved the report — the Google Sheet is the payoff they missed. Point them
// straight at exporting (and auto-export) rather than a generic come-back.
// Fires once via the export_gap dedup slot.
async function sendExportGapEmail({ to, displayName, meetingTitle, daysSinceLogin, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });
  const historyLink = 'https://attendancetracker.dev/history.html';
  const title = meetingTitle || (lang === 'es' ? 'tu clase' : (lang === 'pt' ? 'sua aula' : 'your class'));

  let subject = 'Your attendance report is one click away';
  let lines;
  let linkPrefix = 'Your history:';
  let linkLabel = 'open your dashboard →';

  if (lang === 'es') {
    subject = 'Tu reporte de asistencia está a un clic';
    linkPrefix = 'Tu historial:';
    linkLabel = 'abrir tu panel →';
    lines = [
      `Registraste "${title}" hace aproximadamente ${daysSinceLogin} días, pero no se guardó el reporte en Google Sheets. La próxima vez, abre el panel de Attendance Tracker y presiona Exportar — obtendrás una hoja limpia con horarios y duraciones. (Activa la exportación automática en Configuración y se guardará solo al terminar).`,
      '',
      `Tu historial: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'pt') {
    subject = 'Seu relatório de presença está a um clique';
    linkPrefix = 'Seu histórico:';
    linkLabel = 'abrir seu painel →';
    lines = [
      `Você registrou "${title}" há cerca de ${daysSinceLogin} dias, mas o relatório não foi salvo no Google Sheets. Na próxima vez, abra o painel do Attendance Tracker e clique em Exportar — você terá uma planilha organizada com todas as presenças. (Ative a exportação automática nas Configurações para salvar sozinho ao final da chamada).`,
      '',
      `Seu histórico: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else if (lang === 'bn') {
    subject = 'আপনার উপস্থিতির রিপোর্ট এক ক্লিকেই তৈরি';
    linkPrefix = 'আপনার হিস্ট্রি:';
    linkLabel = 'ড্যাশবোর্ড খুলুন →';
    lines = [
      `আপনি প্রায় ${daysSinceLogin} দিন আগে "${title}" ট্র্যাক করেছিলেন, কিন্তু রিপোর্টটি Google Sheets-এ এক্সপোর্ট করেননি। পরবর্তী সময়ে প্যানেল থেকে Export চাপলেই সম্পূর্ণ রিপোর্ট পেয়ে যাবেন। (সেটিংস থেকে অটো-এক্সপোর্ট চালু রাখলে মিটিং শেষে নিজ থেকেই সেভ হয়ে যাবে)।`,
      '',
      `আপনার হিস্ট্রি: ${historyLink}`,
      '',
      '— Derek',
    ];
  } else {
    lines = [
      `You tracked "${title}" about ${daysSinceLogin} days ago, but never saved the report. Next time you're in that meeting, open the Attendance Tracker side panel and hit Export — you'll get a clean Google Sheet with who joined, who left, and how long they stayed. (Turn on auto-export in Settings and it happens automatically when the meeting ends.)`,
      '',
      `Your history: ${historyLink}`,
      '',
      '— Derek',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: lang === 'es' ? '📄 Reporte pendiente' : (lang === 'pt' ? '📄 Relatório pendente' : (lang === 'bn' ? '📄 রিপোর্ট সংগ্রহ করুন' : '📄 Missing Report')),
    badgeType: 'warning',
    ctaText: lang === 'es' ? 'Ver panel y exportar →' : (lang === 'pt' ? 'Ver painel e exportar →' : (lang === 'bn' ? 'ড্যাশবোর্ড ও এক্সপোর্ট →' : 'View Dashboard & Export →')),
    ctaUrl: historyLink,
    ctaColor: 'green',
    htmlLineTransform: (l) => l.startsWith(linkPrefix) || l.startsWith('Your history:')
      ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#e6edf3;">${escape(l.split('http')[0])}<a href="${escape(historyLink)}" style="color:#58a6ff;text-decoration:none;font-weight:600;">${linkLabel}</a></p>`
      : null,
    tags: [{ name: 'type', value: 'export_gap' }],
    logLabel: 'export-gap', logMeta: { daysSinceLogin },
    language: lang, country, domain,
  });
}

// Pre-meeting reminder for a recurring series the user tracks but has been
// slipping on — fired shortly before the next scheduled instance so it's
// actionable ("open the panel when you join"). Self-limiting: the sweep only
// qualifies LAPSING series, so reliable trackers never get these. Once per
// calendar instance; honors the standard unsubscribe footer.
async function sendUpcomingMeetingEmail({ to, displayName, meetingTitle, minutesUntil, language, country, domain }) {
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let subject;
  let lines;

  if (lang === 'es') {
    subject = minutesUntil <= 1 ? `Recordatorio: "${meetingTitle}" está comenzando` : `Recordatorio: "${meetingTitle}" comienza pronto`;
    const when = minutesUntil <= 1 ? 'está comenzando ahora' : `comienza en aproximadamente ${minutesUntil} minutos`;
    lines = [
      `Tu sesión programada "${meetingTitle}" ${when}. Al unirte, abre el panel lateral de Attendance Tracker y registrará a los asistentes automáticamente.`,
      '',
      'Recibes esto porque has registrado esta reunión antes — es solo un recordatorio para que no se pase.',
      '',
      '— Derek',
    ];
  } else if (lang === 'pt') {
    subject = minutesUntil <= 1 ? `Lembrete: "${meetingTitle}" está começando` : `Lembrete: "${meetingTitle}" começa em breve`;
    const when = minutesUntil <= 1 ? 'está começando agora' : `começa em cerca de ${minutesUntil} minutos`;
    lines = [
      `Sua reunião "${meetingTitle}" ${when}. Ao entrar na chamada, abra o painel do Attendance Tracker para acompanhar quem está presente.`,
      '',
      'Você está recebendo este aviso porque já registrou esta reunião anteriormente — apenas um lembrete para ajudar.',
      '',
      '— Derek',
    ];
  } else if (lang === 'bn') {
    subject = minutesUntil <= 1 ? `অনুস্মারক: "${meetingTitle}" এখনই শুরু হচ্ছে` : `অনুস্মারক: "${meetingTitle}" শীঘ্রই শুরু হবে`;
    const when = minutesUntil <= 1 ? 'এখনই শুরু হচ্ছে' : `প্রায় ${minutesUntil} মিনিটের মধ্যে শুরু হবে`;
    lines = [
      `আপনার শিডিউল করা মিটিং "${meetingTitle}" ${when}। জয়েন করে Attendance Tracker প্যানেলটি খুলুন।`,
      '',
      '— Derek',
    ];
  } else {
    const when = minutesUntil <= 1 ? 'is starting now' : `starts in about ${minutesUntil} minutes`;
    subject = `Reminder: "${meetingTitle}" ${minutesUntil <= 1 ? 'is starting' : 'starts soon'}`;
    lines = [
      `Your recurring meeting "${meetingTitle}" ${when}. When you join, open the Attendance Tracker side panel and it'll capture who's there — then export the report in one click (or let it auto-export when the meeting ends).`,
      '',
      "You're getting this because you've tracked this meeting before but not in the last few days — just a nudge so it doesn't slip.",
      '',
      '— Derek',
    ];
  }

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: minutesUntil <= 1
      ? (lang === 'es' ? '⏰ Comenzando ahora' : (lang === 'pt' ? '⏰ Começando agora' : (lang === 'bn' ? '⏰ এখনই শুরু হচ্ছে' : '⏰ Starting Now')))
      : (lang === 'es' ? '⏰ Comienza pronto' : (lang === 'pt' ? '⏰ Começa em breve' : (lang === 'bn' ? '⏰ শীঘ্রই শুরু হবে' : '⏰ Starting Soon'))),
    badgeType: 'info',
    ctaText: lang === 'es' ? 'Unirse a Google Meet →' : (lang === 'pt' ? 'Entrar no Google Meet →' : (lang === 'bn' ? 'Google Meet-এ যোগ দিন →' : 'Join Google Meet →')),
    ctaUrl: 'https://meet.google.com',
    ctaColor: 'green',
    tags: [{ name: 'type', value: 'upcoming_reminder' }],
    logLabel: 'upcoming-reminder', logMeta: { minutesUntil },
    language: lang, country, domain,
  });
}

// ── Chat-webhook post-meeting digests (Slack / Google Chat / Discord) ──
// Posts a provider-native summary card to a user-configured incoming webhook
// after every export. Fire-and-forget: failures are logged but don't break
// the export flow. Every webhook URL embeds a bearer-token secret, so we
// never log the full URL — only the provider's masked form.

// Shared pieces: the meta line ("8 of 10 attended · 45m · started 9:00 AM")
// and the Present / Left early / Absent name buckets, capped at 8 names +
// overflow. Each provider builder renders these in its own markup.
const DIGEST_BUCKET_CAP = 8;

function digestMetaParts({ totalAttended, totalInvited, durationMin, startTime }) {
  return {
    summary: totalInvited ? `${totalAttended} of ${totalInvited} attended` : `${totalAttended} attended`,
    durStr: durationMin ? hm(durationMin) : '',
    timeStr: startTime ? new Date(startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '',
  };
}

function digestBuckets(participants) {
  const nameOf = p => p.displayName || p.email || '?';
  const all = participants || [];
  return {
    present: all.filter(p => p.status === 'Present').map(nameOf),
    left: all.filter(p => p.status === 'Left').map(nameOf),
    absent: all.filter(p => p.status === 'Absent' || p.status === 'Excused')
      .map(p => `${nameOf(p)}${p.status === 'Excused' ? ' (excused)' : ''}`),
  };
}

function capBucket(names) {
  const shown = names.slice(0, DIGEST_BUCKET_CAP).join(', ');
  const text = names.length > DIGEST_BUCKET_CAP ? `${shown}, +${names.length - DIGEST_BUCKET_CAP} more` : shown;
  // Hard length guard: Slack rejects the ENTIRE payload (invalid_blocks) when
  // a field exceeds its limit — the count cap alone doesn't bound very long
  // display names, and a rejected digest just silently disappears.
  return text.length > 1800 ? text.slice(0, 1797) + '…' : text;
}

// Slack mrkdwn control characters. Meet display names are attacker-controlled
// by anyone who joins a meeting — an unescaped <https://evil|IT Support>
// rendered as a live link inside the host org's Slack channel.
function slackEscape(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Discord renders markdown (incl. masked [links](url)) inside embed field
// values — neutralize formatting syntax in user-supplied strings.
function discordEscape(s) {
  return String(s == null ? '' : s).replace(/([\\`*_~|[\]()])/g, '\\$1');
}

// Build the Slack Block Kit payload. Pulled out for testability.
function buildSlackDigestBlocks({ meetingTitle, totalAttended, totalInvited, participants, sheetUrl, durationMin, startTime }) {
  const title = meetingTitle || 'Google Meet';
  const { summary, durStr, timeStr } = digestMetaParts({ totalAttended, totalInvited, durationMin, startTime });
  const metaLine = [`*${summary}*`, durStr, timeStr ? `started ${timeStr}` : ''].filter(Boolean).join(' · ');
  const { present, left, absent } = digestBuckets(participants);

  const fields = [];
  if (present.length) fields.push({ type: 'mrkdwn', text: `*✅ Present (${present.length})*\n${slackEscape(capBucket(present))}` });
  if (left.length) fields.push({ type: 'mrkdwn', text: `*🟡 Left early (${left.length})*\n${slackEscape(capBucket(left))}` });
  if (absent.length) fields.push({ type: 'mrkdwn', text: `*❌ Absent (${absent.length})*\n${slackEscape(capBucket(absent))}` });

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📊 ${title}`.slice(0, 150) } },
    { type: 'section', text: { type: 'mrkdwn', text: metaLine } },
  ];
  if (fields.length) blocks.push({ type: 'section', fields });
  if (sheetUrl) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open sheet' }, url: sheetUrl }],
    });
  }
  return blocks;
}

// Fallback plain-text body, used by Slack clients that don't render blocks
// and as the Google Chat notification-preview text.
function buildSlackFallbackText({ meetingTitle, totalAttended, totalInvited, sheetUrl }) {
  // The fallback `text` IS rendered as mrkdwn by Slack — escape the
  // user-controlled title (it also feeds the Chat notification preview,
  // where the entities are harmless).
  const title = slackEscape(meetingTitle || 'Google Meet');
  const summary = totalInvited ? `${totalAttended} of ${totalInvited} attended` : `${totalAttended} attended`;
  return `📊 ${title} — ${summary}${sheetUrl ? '\nOpen sheet: ' + sheetUrl : ''}`;
}

// Build the Google Chat cardsV2 payload. Chat cards use HTML-ish markup in
// textParagraph widgets, so names are escaped.
function buildChatDigestCard({ meetingTitle, totalAttended, totalInvited, participants, sheetUrl, durationMin, startTime }) {
  const title = meetingTitle || 'Google Meet';
  const { summary, durStr, timeStr } = digestMetaParts({ totalAttended, totalInvited, durationMin, startTime });
  const subtitle = [summary, durStr, timeStr ? `started ${timeStr}` : ''].filter(Boolean).join(' · ');
  const { present, left, absent } = digestBuckets(participants);

  const widgets = [];
  if (present.length) widgets.push({ textParagraph: { text: `<b>✅ Present (${present.length})</b><br>${escape(capBucket(present))}` } });
  if (left.length) widgets.push({ textParagraph: { text: `<b>🟡 Left early (${left.length})</b><br>${escape(capBucket(left))}` } });
  if (absent.length) widgets.push({ textParagraph: { text: `<b>❌ Absent (${absent.length})</b><br>${escape(capBucket(absent))}` } });
  if (sheetUrl) {
    widgets.push({ buttonList: { buttons: [{ text: 'Open sheet', onClick: { openLink: { url: sheetUrl } } }] } });
  }

  // Chat's top-level `text` renders VERBATIM (no mrkdwn, no HTML) — reusing
  // the Slack fallback (which slackEscapes the title) showed literal &amp;
  // entities in channel/notification previews for titles containing & < >.
  const plainSummary = totalInvited ? `${totalAttended} of ${totalInvited} attended` : `${totalAttended} attended`;
  return {
    text: `📊 ${title} — ${plainSummary}${sheetUrl ? '\nOpen sheet: ' + sheetUrl : ''}`,
    cardsV2: [{
      cardId: 'attendance-digest',
      card: {
        header: { title: `📊 ${title}`.slice(0, 150), subtitle },
        sections: [{ widgets }],
      },
    }],
  };
}

// Build the Discord embed payload. Embed limits: title 256, field value 1024.
function buildDiscordDigestEmbed({ meetingTitle, totalAttended, totalInvited, participants, sheetUrl, durationMin, startTime }) {
  const title = meetingTitle || 'Google Meet';
  const { summary, durStr, timeStr } = digestMetaParts({ totalAttended, totalInvited, durationMin, startTime });
  const description = [`**${summary}**`, durStr, timeStr ? `started ${timeStr}` : ''].filter(Boolean).join(' · ');
  const { present, left, absent } = digestBuckets(participants);

  const fields = [];
  if (present.length) fields.push({ name: `✅ Present (${present.length})`, value: discordEscape(capBucket(present)).slice(0, 1024), inline: false });
  if (left.length) fields.push({ name: `🟡 Left early (${left.length})`, value: discordEscape(capBucket(left)).slice(0, 1024), inline: false });
  if (absent.length) fields.push({ name: `❌ Absent (${absent.length})`, value: discordEscape(capBucket(absent)).slice(0, 1024), inline: false });

  const embed = { title: `📊 ${title}`.slice(0, 256), description, color: 0x4ade80 };
  if (sheetUrl) embed.url = sheetUrl; // makes the title an "Open sheet" link
  if (fields.length) embed.fields = fields;
  return { embeds: [embed] };
}

// Shared send path: POST the payload, log with the provider's masked URL,
// never throw (fire-and-forget contract).
async function postDigestPayload({ webhookUrl, payload, mask, label, meetingTitle }) {
  try {
    const res = await postJsonWithTimeout(webhookUrl, JSON.stringify(payload));
    if (!res.ok) {
      const respText = await res.text().catch(() => '');
      log.warn(`${label} digest send failed`, { webhook: mask(webhookUrl), status: res.status, response: respText.slice(0, 200) });
      return { sent: false, status: res.status };
    }
    log.info(`${label} digest sent`, { webhook: mask(webhookUrl), meetingTitle });
    return { sent: true };
  } catch (err) {
    log.warn(`${label} digest exception`, { webhook: mask(webhookUrl), error: err.message });
    return { sent: false, error: err.message };
  }
}

async function sendSlackDigest(args) {
  if (!args.webhookUrl) return { sent: false, reason: 'no_webhook' };
  const payload = { text: buildSlackFallbackText(args), blocks: buildSlackDigestBlocks(args) };
  return postDigestPayload({ webhookUrl: args.webhookUrl, payload, mask: maskSlackWebhook, label: 'slack', meetingTitle: args.meetingTitle });
}

async function sendChatDigest(args) {
  if (!args.webhookUrl) return { sent: false, reason: 'no_webhook' };
  return postDigestPayload({ webhookUrl: args.webhookUrl, payload: buildChatDigestCard(args), mask: maskGoogleChatWebhook, label: 'google chat', meetingTitle: args.meetingTitle });
}

async function sendDiscordDigest(args) {
  if (!args.webhookUrl) return { sent: false, reason: 'no_webhook' };
  return postDigestPayload({ webhookUrl: args.webhookUrl, payload: buildDiscordDigestEmbed(args), mask: maskDiscordWebhook, label: 'discord', meetingTitle: args.meetingTitle });
}

// Test-only pings used by the settings modal's "Send test" buttons to verify
// a webhook is reachable + posts correctly. Minimal payloads; the route
// surfaces the result, so no logging here.
const TEST_PING_TEXT = '✅ Attendance Tracker is connected. Future meeting digests will land in this channel.';

async function postTestPing(webhookUrl, payload) {
  if (!webhookUrl) return { sent: false, reason: 'no_webhook' };
  try {
    const res = await postJsonWithTimeout(webhookUrl, JSON.stringify(payload));
    if (!res.ok) {
      const respText = await res.text().catch(() => '');
      return { sent: false, status: res.status, response: respText.slice(0, 200) };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

async function sendSlackTestPing({ webhookUrl }) {
  return postTestPing(webhookUrl, { text: TEST_PING_TEXT });
}

async function sendChatTestPing({ webhookUrl }) {
  return postTestPing(webhookUrl, { text: TEST_PING_TEXT });
}

async function sendDiscordTestPing({ webhookUrl }) {
  return postTestPing(webhookUrl, { content: TEST_PING_TEXT });
}

// Weekly org digest for the team admin of a Pro domain — the retention spine
// of the domain/Institution tier: weekly proof the license is working across
// the whole org, with a deep link back to the dashboard.
async function sendOrgWeeklyDigest({ to, domain, totals, weeklyMeetings, language, country }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  try {
    const { isNotificationCategoryEnabled } = require('../services/firestore');
    if (await isNotificationCategoryEnabled(domain, to, 'weeklyDigest') === false) {
      log.info('org weekly digest skipped — user disabled weeklyDigest', { to, domain });
      return { skipped: 'opted out of weeklyDigest' };
    }
  } catch {}
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  const t = totals || {};
  let subject = weeklyMeetings > 0
    ? `${domain}: ${weeklyMeetings} meetings tracked this week`
    : `${domain}: your weekly attendance digest`;
  let badgeText = '🏛️ Org Digest';
  let title = `Weekly Attendance: ${escape(domain)}`;
  let greeting = 'Hi,';
  let introHtml = `Your weekly attendance summary for <strong style="color:#e6edf3;">${escape(domain)}</strong>:`;
  let lblMeetingsWeek = 'Meetings this week';
  let lblTeachers = 'Teachers using it';
  let lblMeetingsAllTime = 'Meetings all-time';
  let lblPeople = 'People tracked';
  let ctaText = 'Open the org dashboard →';
  let footerNotice = `You're getting this weekly summary because you're the team admin for ${escape(domain)} on Attendance Tracker Pro.`;

  if (lang === 'es') {
    subject = weeklyMeetings > 0
      ? `${domain}: ${weeklyMeetings} reuniones registradas esta semana`
      : `${domain}: tu resumen semanal de asistencia`;
    badgeText = '🏛️ Resumen institucional';
    title = `Asistencia semanal: ${escape(domain)}`;
    greeting = 'Hola,';
    introHtml = `Tu resumen semanal de asistencia para <strong style="color:#e6edf3;">${escape(domain)}</strong>:`;
    lblMeetingsWeek = 'Reuniones esta semana';
    lblTeachers = 'Docentes activos';
    lblMeetingsAllTime = 'Total histórico de reuniones';
    lblPeople = 'Personas registradas';
    ctaText = 'Abrir panel institucional →';
    footerNotice = `Recibes este resumen semanal porque eres administrador de equipo de ${escape(domain)} en Attendance Tracker Pro.`;
  } else if (lang === 'pt') {
    subject = weeklyMeetings > 0
      ? `${domain}: ${weeklyMeetings} reuniões registradas esta semana`
      : `${domain}: seu resumo semanal de presença`;
    badgeText = '🏛️ Resumo institucional';
    title = `Presença semanal: ${escape(domain)}`;
    greeting = 'Olá,';
    introHtml = `Seu resumo semanal de presença para <strong style="color:#e6edf3;">${escape(domain)}</strong>:`;
    lblMeetingsWeek = 'Reuniões esta semana';
    lblTeachers = 'Professores ativos';
    lblMeetingsAllTime = 'Total histórico de reuniões';
    lblPeople = 'Pessoas registradas';
    ctaText = 'Abrir painel institucional →';
    footerNotice = `Você está recebendo este resumo semanal porque é administrador de equipe de ${escape(domain)} no Attendance Tracker Pro.`;
  } else if (lang === 'bn') {
    subject = weeklyMeetings > 0
      ? `${domain}: এই সপ্তাহে ${weeklyMeetings}টি মিটিং ট্র্যাক করা হয়েছে`
      : `${domain}: আপনার সাপ্তাহিক উপস্থিতির সারাংশ`;
    badgeText = '🏛️ প্রাতিষ্ঠানিক সারাংশ';
    title = `সাপ্তাহিক উপস্থিতি: ${escape(domain)}`;
    greeting = 'হ্যালো,';
    introHtml = `<strong style="color:#e6edf3;">${escape(domain)}</strong>-এর জন্য আপনার সাপ্তাহিক উপস্থিতির সারাংশ:`;
    lblMeetingsWeek = 'এই সপ্তাহের মিটিং';
    lblTeachers = 'ব্যবহারকারী শিক্ষক';
    lblMeetingsAllTime = 'সর্বমোট মিটিং';
    lblPeople = 'উপস্থিত ব্যক্তি';
    ctaText = 'প্রাতিষ্ঠানিক ড্যাশবোর্ড খুলুন →';
    footerNotice = `আপনি Attendance Tracker Pro-তে ${escape(domain)}-এর টিম অ্যাডমিন হওয়ায় এই সাপ্তাহিক সারাংশ পাঠানো হয়েছে।`;
  }

  const contentHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#e6edf3;">${greeting}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#8b949e;">${introHtml}</p>
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;font-size:13px;width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:16px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:45%;vertical-align:top;word-break:break-word;">${escape(lblMeetingsWeek)}</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#4ade80;font-weight:700;word-break:break-word;">${weeklyMeetings || 0}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">${escape(lblTeachers)}</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;word-break:break-word;">${t.users || 0}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">${escape(lblMeetingsAllTime)}</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;">${t.meetings || 0}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">${escape(lblPeople)}</td><td style="padding:8px 10px;color:#e6edf3;word-break:break-word;">${t.people || 0}</td></tr>
    </table>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'info',
    title,
    contentHtml,
    ctaText,
    ctaUrl: 'https://attendancetracker.dev/team.html',
    ctaColor: 'blue',
    footerHtml: `<p style="margin:0 0 8px;font-size:12px;color:#8b949e;">${escape(footerNotice)}</p>${foot.html}`,
  });
  const text = [
    greeting,
    '',
    introHtml.replace(/<[^>]+>/g, ''),
    `  ${lblMeetingsWeek}: ${weeklyMeetings || 0}`,
    `  ${lblTeachers}:  ${t.users || 0}`,
    `  ${lblMeetingsAllTime}:  ${t.meetings || 0}`,
    `  ${lblPeople}:     ${t.people || 0}`,
    '',
    `${ctaText.replace(' →', '')}: https://attendancetracker.dev/team.html`,
    foot.text,
  ].join('\n');
  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [
      { name: 'type', value: 'org_weekly_digest' },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
    }, 'org weekly digest', { domain, lang });
}

// ── Requested Upgrade Link (for teachers finishing class) ─────────────────
async function sendUpgradeLinkEmail({ to, displayName, educatorUrl, lifetimeUrl, educatorPrice, lifetimePrice, flag, isPpp, language, country, domain }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!to) throw new Error('to is required');

  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let greeting = displayName ? `Hi ${displayName.split(' ')[0]},` : 'Hi there,';
  let pppNote = isPpp ? ` (50% Regional Subsidy applied ${flag || ''})` : ' (20% 24-Hour Discount applied ⚡)';
  let subject = 'Your Attendance Tracker 24-hour discount & upgrade link';
  let bodyIntro = "Here is your direct 1-click link to unlock unlimited classes and exports with a special 24-hour discount. Whenever your class wraps up and you're back at your desk, you can complete your upgrade below:";
  let bestValueTag = 'Best Value';
  let lifetimeTitle = `Lifetime Pro — ${escape(lifetimePrice)} one-time${escape(pppNote)}`;
  let lifetimeDesc = 'Pay once, own forever — no recurring subscription. Unlimited Sheets exports & auto-capture.';
  let lifetimeBtn = `Get Lifetime Pro (${escape(lifetimePrice)}) →`;
  let educatorTitle = `Educator Pass — ${escape(educatorPrice)}/yr${escape(pppNote)}`;
  let educatorDesc = 'Unlimited Google Sheets exports & attendance records for 1 full year.';
  let educatorBtn = `Unlock Educator Pass (${escape(educatorPrice)}/yr) →`;
  let dashboardNote = 'Or view your previous attendance history anytime in your';
  let dashboardLinkText = 'Web Dashboard';
  let thankYouNote = 'Thank you for teaching with Attendance Tracker!';
  let badgeText = '⚡ 24-Hour Special Offer';
  let badgeSubtitle = 'Special discount on unlimited attendance tracking and exports';

  if (lang === 'es') {
    greeting = displayName ? `Hola ${displayName.split(' ')[0]},` : 'Hola,';
    pppNote = isPpp ? ` (50% de subsidio regional aplicado ${flag || ''})` : ' (20% de descuento por 24 horas ⚡)';
    subject = 'Tu enlace para actualizar Attendance Tracker (descuento especial de 24 horas)';
    bodyIntro = 'Aquí tienes tu enlace directo para desbloquear clases y exportaciones ilimitadas con un descuento especial de 24 horas. Cuando tu clase termine y vuelvas a tu escritorio, puedes completar tu actualización aquí:';
    bestValueTag = 'Mejor valor';
    lifetimeTitle = `Pro de por vida — ${escape(lifetimePrice)} pago único${escape(pppNote)}`;
    lifetimeDesc = 'Pago único · Para siempre · Sin renovaciones ni sorpresas. Exportaciones automáticas y registros ilimitados.';
    lifetimeBtn = `Obtener Pro de por vida (${escape(lifetimePrice)}) →`;
    educatorTitle = `Pase Educador — ${escape(educatorPrice)}/año${escape(pppNote)}`;
    educatorDesc = 'Exportaciones ilimitadas a Google Sheets y registros de asistencia por 1 año completo.';
    educatorBtn = `Desbloquear Pase Educador (${escape(educatorPrice)}/año) →`;
    dashboardNote = 'O consulta tu historial de asistencia en cualquier momento en tu';
    dashboardLinkText = 'Panel Web';
    thankYouNote = '¡Gracias por enseñar con Attendance Tracker!';
    badgeText = '⚡ Oferta especial de 24 horas';
    badgeSubtitle = 'Descuento especial en registros y exportaciones ilimitadas';
  } else if (lang === 'pt') {
    greeting = displayName ? `Olá ${displayName.split(' ')[0]},` : 'Olá,';
    pppNote = isPpp ? ` (50% de subsídio regional aplicado ${flag || ''})` : ' (20% de desconto por 24 horas ⚡)';
    subject = 'Seu link para atualizar o Attendance Tracker (desconto especial de 24 horas)';
    bodyIntro = 'Aqui está o seu link direto para desbloquear turmas e exportações ilimitadas com um desconto especial de 24 horas. Quando sua aula terminar e você estiver de volta à sua mesa, você pode concluir seu upgrade abaixo:';
    bestValueTag = 'Melhor valor';
    lifetimeTitle = `Pro Vitalício — ${escape(lifetimePrice)} pagamento único${escape(pppNote)}`;
    lifetimeDesc = 'Pagamento único · Para sempre · Sem renovações nem surpresas. Exportações automáticas e registros ilimitados.';
    lifetimeBtn = `Obter Pro Vitalício (${escape(lifetimePrice)}) →`;
    educatorTitle = `Passe Educador — ${escape(educatorPrice)}/ano${escape(pppNote)}`;
    educatorDesc = 'Exportações ilimitadas para o Google Sheets e registros de presença por 1 ano completo.';
    educatorBtn = `Desbloquear Passe Educador (${escape(educatorPrice)}/ano) →`;
    dashboardNote = 'Ou visualize seu histórico de presença a qualquer momento no seu';
    dashboardLinkText = 'Painel Web';
    thankYouNote = 'Obrigado por ensinar com o Attendance Tracker!';
    badgeText = '⚡ Oferta especial de 24 horas';
    badgeSubtitle = 'Desconto especial em registros e exportações ilimitadas';
  } else if (lang === 'bn') {
    greeting = displayName ? `হ্যালো ${displayName.split(' ')[0]},` : 'হ্যালো,';
    pppNote = isPpp ? ` (৫০% আঞ্চলিক ডিসকাউন্ট প্রযোজ্য ${flag || ''})` : ' (২৪ ঘণ্টার জন্য ২০% বিশেষ ছাড় ⚡)';
    subject = 'আপনার Attendance Tracker আপগ্রেড লিংক (২৪ ঘণ্টার বিশেষ অফার)';
    bodyIntro = '২৪ ঘণ্টার বিশেষ ডিসকাউন্টে আনলিমিটেড ক্লাস ও এক্সপোর্ট আনলক করার জন্য সরাসরি লিংক এখানে দেওয়া হলো। ক্লাস শেষ করে যখনই টেবিলে ফিরবেন, নিচের লিংক থেকে আপগ্রেড সম্পন্ন করতে পারবেন:';
    bestValueTag = 'সেরা অফার';
    lifetimeTitle = `লাইফটাইম প্রো — ${escape(lifetimePrice)} এককালীন${escape(pppNote)}`;
    lifetimeDesc = 'একবার পেমেন্ট করুন, আজীবন আনলিমিটেড ব্যবহার করুন। কোনো মাসিক বা বাৎসরিক ফি নেই।';
    lifetimeBtn = `লাইফটাইম প্রো নিন (${escape(lifetimePrice)}) →`;
    educatorTitle = `এডুকেটর পাস — ${escape(educatorPrice)}/বছর${escape(pppNote)}`;
    educatorDesc = 'পুরো ১ বছরের জন্য আনলিমিটেড গুগল শিট এক্সপোর্ট ও উপস্থিতি রেকর্ড।';
    educatorBtn = `এডুকেটর পাস আনলক করুন (${escape(educatorPrice)}/বছর) →`;
    dashboardNote = 'অথবা যেকোনো সময় আপনার পূর্বের হিস্ট্রি দেখতে ভিজিট করুন';
    dashboardLinkText = 'ওয়েব ড্যাশবোর্ড';
    thankYouNote = 'Attendance Tracker ব্যবহার করার জন্য ধন্যবাদ!';
    badgeText = '⚡ ২৪ ঘণ্টার বিশেষ অফার';
    badgeSubtitle = 'আনলিমিটেড উপস্থিতি ও এক্সপোর্টে বিশেষ ডিসকাউন্ট';
  }

  const contentHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#e6edf3;">${escape(greeting)}</p>
    <p style="margin:0 0 20px;font-size:14px;color:#8b949e;line-height:1.5;">${escape(bodyIntro)}</p>

    <!-- Plan 1: Featured Lifetime Pro Pass (Crown Jewel / Best Value) -->
    <div class="plan-card" style="background:#161b22;border:1.5px solid rgba(74,222,128,0.45);border-radius:10px;padding:16px 18px;margin-bottom:14px;box-sizing:border-box;">
      <div style="margin-bottom:8px;">
        <span style="display:inline-block;background:rgba(35,134,54,0.25);border:1px solid rgba(74,222,128,0.4);color:#4ade80;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;line-height:1.4;">${escape(bestValueTag)}</span>
      </div>
      <div style="font-weight:700;font-size:15px;color:#4ade80;line-height:1.4;margin-bottom:8px;word-break:break-word;">${lifetimeTitle}</div>
      <p style="margin:0 0 14px;color:#c9d1d9;font-size:13px;line-height:1.5;">${escape(lifetimeDesc)}</p>
      <a href="${escape(lifetimeUrl)}" class="touch-btn-block" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#238636;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px;font-size:13px;line-height:1.35;">${lifetimeBtn}</a>
    </div>

    <!-- Plan 2: Annual Educator Pass -->
    <div class="plan-card" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin-bottom:16px;box-sizing:border-box;">
      <div style="font-weight:700;font-size:14px;color:#58a6ff;margin-bottom:6px;line-height:1.4;word-break:break-word;">${educatorTitle}</div>
      <p style="margin:0 0 12px;color:#8b949e;font-size:12.5px;line-height:1.45;">${escape(educatorDesc)}</p>
      <a href="${escape(educatorUrl)}" class="touch-btn-block" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#21262d;border:1px solid #388bfd;color:#79c0ff;text-decoration:none;font-weight:600;padding:9px 15px;border-radius:6px;font-size:12.5px;line-height:1.35;">${educatorBtn}</a>
    </div>

    <p style="margin:16px 0 0;font-size:13px;color:#8b949e;">${escape(dashboardNote)} <a href="https://attendancetracker.dev/history.html" style="color:#58a6ff;text-decoration:none;">${escape(dashboardLinkText)}</a>.</p>
    <p style="margin:8px 0 0;font-size:13px;color:#8b949e;">${escape(thankYouNote)}</p>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'success',
    title: 'Attendance Tracker for Google Meet',
    subtitle: badgeSubtitle,
    contentHtml,
    footerHtml: foot.html,
  });

  const text = [
    greeting,
    '',
    bodyIntro,
    '',
    `* ${lifetimeTitle.replace(/&amp;/g, '&')}`,
    `  ${lifetimeUrl}`,
    '',
    `* ${educatorTitle.replace(/&amp;/g, '&')}`,
    `  ${educatorUrl}`,
    '',
    `${dashboardNote} https://attendancetracker.dev/history.html`,
    '',
    thankYouNote,
    foot.text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Derek from Attendance Tracker'),
    to, subject, text, html,
    replyTo: ownerEmail(),
    tags: [
      { name: 'type', value: 'upgrade_link_requested' },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'upgrade link email', { to, lang });
}

// ── Subscription Cancelled (Auto-Renewal Stopped) Confirmation ────────────
async function sendSubscriptionCancelledEmail({ to, displayName, planName, currentPeriodEnd, language, country, domain }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!to) throw new Error('to is required');

  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  let greeting = displayName ? `Hi ${displayName.split(' ')[0]},` : 'Hi there,';
  let subject = 'Your Attendance Tracker subscription has been cancelled';
  let badgeText = 'ℹ️ Subscription Update';
  let title = 'Auto-Renewal Cancelled';
  let reassurance1 = "We've confirmed the cancellation of your Attendance Tracker auto-renewal. Your credit card will NOT be charged again.";
  let reassurance2 = currentPeriodEnd
    ? `You will keep full access to all Pro features through the end of your billing period on ${escape(currentPeriodEnd)}.`
    : 'You will keep full access to all Pro features through the end of your current billing period.';
  let dataReassurance = 'All your saved Google Sheets, export history, and attendance records remain permanently yours in your Google Drive and dashboard.';
  let resumeNote = 'If you ever change your mind or want to resume your subscription before it expires, you can re-enable auto-renewal anytime in your dashboard settings.';
  let ctaText = 'Open Dashboard →';

  if (lang === 'es') {
    greeting = displayName ? `Hola ${displayName.split(' ')[0]},` : 'Hola,';
    subject = 'Tu suscripción a Attendance Tracker ha sido cancelada';
    badgeText = 'ℹ️ Estado de suscripción';
    title = 'Renovación automática cancelada';
    reassurance1 = 'Hemos confirmado la cancelación de tu renovación automática en Attendance Tracker. Tu tarjeta de crédito NO volverá a recibir ningún cargo.';
    reassurance2 = currentPeriodEnd
      ? `Seguirás teniendo acceso completo a todas las funciones Pro hasta que finalice tu período de facturación el ${escape(currentPeriodEnd)}.`
      : 'Seguirás teniendo acceso completo a todas las funciones Pro hasta que finalice tu período de facturación actual.';
    dataReassurance = 'Todas tus hojas de Google Sheets, historial de exportaciones y registros de asistencia permanecerán permanentemente accesibles en tu Google Drive y panel.';
    resumeNote = 'Si en algún momento deseas reanudar tu suscripción antes de que expire, puedes reactivar la renovación automática cuando quieras desde los ajustes del panel.';
    ctaText = 'Abrir panel →';
  } else if (lang === 'pt') {
    greeting = displayName ? `Olá ${displayName.split(' ')[0]},` : 'Olá,';
    subject = 'Sua assinatura do Attendance Tracker foi cancelada';
    badgeText = 'ℹ️ Atualização da assinatura';
    title = 'Renovação automática cancelada';
    reassurance1 = 'Confirmamos o cancelamento da renovação automática da sua assinatura do Attendance Tracker. Seu cartão de crédito NÃO receberá novas cobranças.';
    reassurance2 = currentPeriodEnd
      ? `Você continuará com acesso total a todos os recursos Pro até o fim do seu período de faturamento em ${escape(currentPeriodEnd)}.`
      : 'Você continuará com acesso total a todos os recursos Pro até o fim do seu período de faturamento atual.';
    dataReassurance = 'Todas as suas planilhas do Google Sheets, histórico de exportações e registros de presença permanecerão salvos com segurança no seu Google Drive e painel.';
    resumeNote = 'Se quiser retomar sua assinatura antes do término do período, você pode reativar a renovação automática a qualquer momento nas configurações do seu painel.';
    ctaText = 'Abrir painel →';
  } else if (lang === 'bn') {
    greeting = displayName ? `হ্যালো ${displayName.split(' ')[0]},` : 'হ্যালো,';
    subject = 'আপনার Attendance Tracker সাবস্ক্রিপশন বাতিল করা হয়েছে';
    badgeText = 'ℹ️ সাবস্ক্রিপশন আপডেট';
    title = 'স্বয়ংক্রিয় পুনর্নবীকরণ বাতিল';
    reassurance1 = 'আপনার Attendance Tracker-এর স্বয়ংক্রিয় পুনর্নবীকরণ সফলভাবে বাতিল করা হয়েছে। আপনার কার্ডে আর কোনো চার্জ কাটা হবে না।';
    reassurance2 = currentPeriodEnd
      ? `আপনার বর্তমান বিলিং চক্র শেষ হওয়া পর্যন্ত (${escape(currentPeriodEnd)}) আপনি প্রো-এর সকল সুবিধা পুরোপুরি উপভোগ করতে পারবেন।`
      : 'আপনার বর্তমান বিলিং চক্র শেষ হওয়া পর্যন্ত আপনি প্রো-এর সকল সুবিধা পুরোপুরি উপভোগ করতে পারবেন।';
    dataReassurance = 'আপনার সমস্ত গুগল শিট, উপস্থিতির ইতিহাস ও ডেটা আপনার গুগল ড্রাইভ ও ড্যাশবোর্ডে সম্পূর্ণ নিরাপদে থাকবে।';
    resumeNote = 'আপনি চাইলে মেয়াদ শেষ হওয়ার আগে যেকোনো সময় ড্যাশবোর্ড সেটিংস থেকে পুনরায় সাবস্ক্রিপশন চালু করতে পারবেন।';
    ctaText = 'ড্যাশবোর্ড খুলুন →';
  }

  const contentHtml = `
    <p style="margin:0 0 12px;font-size:15px;color:#e6edf3;">${escape(greeting)}</p>
    <p style="margin:0 0 14px;font-size:14px;color:#e6edf3;line-height:1.5;">${escape(reassurance1)}</p>
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin:16px 0;">
      <div style="font-size:14px;color:#4ade80;font-weight:600;margin-bottom:6px;">✓ ${escape(reassurance2)}</div>
      <div style="font-size:13px;color:#8b949e;line-height:1.45;">${escape(dataReassurance)}</div>
    </div>
    <p style="margin:14px 0 0;font-size:13px;color:#8b949e;line-height:1.5;">${escape(resumeNote)}</p>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'info',
    title,
    contentHtml,
    ctaText,
    ctaUrl: 'https://attendancetracker.dev/history.html',
    ctaColor: 'blue',
    footerHtml: foot.html,
  });

  const text = [
    greeting,
    '',
    reassurance1,
    '',
    reassurance2,
    dataReassurance,
    '',
    resumeNote,
    '',
    `Dashboard: https://attendancetracker.dev/history.html`,
    foot.text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [
      { name: 'type', value: 'subscription_cancelled' },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'subscription cancelled email', { to, lang });
}

/**
 * Build a warm, localized confirmation email content for an educator whose review has been verified,
 * unlocking 1 free month of Educator Pro ($0 cost, zero surprise charges).
 */
function buildReviewRewardEmailContent({ to, displayName, domain, country, language, expiresAt, reviewId, rating = 5 }) {
  const lang = resolveLanguage({ language, country, domain, email: to });
  const name = displayName ? displayName.trim().split(' ')[0] : '';
  const dateStr = expiresAt
    ? (new Date(expiresAt).toLocaleDateString(
        lang === 'es' ? 'es-MX' : lang === 'pt' ? 'pt-BR' : lang === 'bn' ? 'bn-BD' : 'en-US',
        { year: 'numeric', month: 'long', day: 'numeric' }
      ))
    : null;

  let greeting = name ? `Hi ${name},` : 'Hello,';
  let subject = '⭐ Your Free Month of Pro is Active in Attendance Tracker';
  let badgeText = '⭐ Review Reward';
  let title = 'Pro Access Unlocked!';
  let p1 = 'Thank you so much for rating Attendance Tracker on the Google Workspace Marketplace! As an independent tool built for educators, your feedback and support make all the difference.';
  let cardTitle = '🎉 1 Month of Educator Pro Activated';
  let cardSubtitle = dateStr
    ? `Your account (${to}) now has full access to all Pro features through ${dateStr}.`
    : `Your account (${to}) now has full access to all Pro features.`;
  let bullets = [
    'Unlimited automatic tracking & exact join/leave times in Google Meet.',
    'Direct export to Google Sheets in your Drive.',
    'No credit card required & $0 cost — zero surprise charges.',
  ];
  let pClosing = 'We hope this saves you time with your classes. If you ever have questions or suggestions, feel free to reply directly to this email!';
  let signoff = 'Warm regards,';
  let ctaText = 'Open Attendance Tracker →';

  if (lang === 'es') {
    greeting = name ? `Estimado/a ${name},` : 'Hola,';
    subject = '⭐ Tu mes de Pro gratuito ya está activo en Attendance Tracker';
    badgeText = '⭐ Recompensa de Reseña';
    title = '¡Acceso Pro Activado!';
    p1 = 'Muchísimas gracias por calificar Attendance Tracker en Google Workspace Marketplace. Para un proyecto enfocado en la educación, el apoyo y la confianza de los profesores significa todo.';
    cardTitle = '🎉 1 mes de Educator Pro activado';
    cardSubtitle = dateStr
      ? `Tu cuenta (${to}) ya tiene acceso completo a todas las funciones avanzadas hasta el ${dateStr}.`
      : `Tu cuenta (${to}) ya tiene acceso completo a todas las funciones avanzadas.`;
    bullets = [
      'Registro automático ilimitado de asistencia y tiempos exactos de permanencia en Google Meet.',
      'Guardado y exportación directa a Google Sheets en tu Drive.',
      'Sin requerir tarjeta de crédito ni renovación automática (costo $0).',
    ];
    pClosing = 'Esperamos que te sea de gran utilidad en tus clases. Si en algún momento tienes comentarios o alguna sugerencia para mejorar la herramienta, puedes responder directamente a este correo.';
    signoff = 'Un cordial saludo,';
    ctaText = 'Abrir Attendance Tracker →';
  } else if (lang === 'pt') {
    greeting = name ? `Olá ${name},` : 'Olá,';
    subject = '⭐ Seu mês de Pro gratuito já está ativo no Attendance Tracker';
    badgeText = '⭐ Recompensa de Avaliação';
    title = 'Acesso Pro Ativado!';
    p1 = 'Muito obrigado por avaliar o Attendance Tracker no Google Workspace Marketplace! Como uma ferramenta independente criada para educadores, o seu apoio faz toda a diferença.';
    cardTitle = '🎉 1 mês de Educator Pro ativado';
    cardSubtitle = dateStr
      ? `Sua conta (${to}) agora tem acesso total a todos os recursos Pro até ${dateStr}.`
      : `Sua conta (${to}) agora tem acesso total a todos os recursos Pro.`;
    bullets = [
      'Registro automático ilimitado de presença e horários de entrada/saída no Google Meet.',
      'Exportação direta para o Google Sheets no seu Google Drive.',
      'Sem necessidade de cartão de crédito e sem cobranças automáticas (custo $0).',
    ];
    pClosing = 'Esperamos que seja muito útil nas suas aulas. Se tiver dúvidas ou sugestões, sinta-se à vontade para responder diretamente a este e-mail!';
    signoff = 'Um abraço cordial,';
    ctaText = 'Abrir o Attendance Tracker →';
  } else if (lang === 'bn') {
    greeting = name ? `হ্যালো ${name},` : 'হ্যালো,';
    subject = '⭐ Attendance Tracker-এ আপনার ১ মাসের ফ্রি প্রো সক্রিয় হয়েছে';
    badgeText = '⭐ রিভিউ রিওয়ার্ড';
    title = 'প্রো সুবিধা সক্রিয় করা হয়েছে!';
    p1 = 'Google Workspace Marketplace-এ Attendance Tracker রেট করার জন্য আপনাকে অনেক ধন্যবাদ! শিক্ষকদের জন্য তৈরি একটি স্বাধীন টুল হিসেবে আপনার সমর্থন আমাদের জন্য অত্যন্ত মূল্যবান।';
    cardTitle = '🎉 ১ মাসের এডুকেটর প্রো আনলক হয়েছে';
    cardSubtitle = dateStr
      ? `আপনার অ্যাকাউন্ট (${to})-এ ${dateStr} পর্যন্ত সমস্ত প্রো সুবিধার সম্পূর্ণ অ্যাক্সেস রয়েছে।`
      : `আপনার অ্যাকাউন্ট (${to})-এ সমস্ত প্রো সুবিধার সম্পূর্ণ অ্যাক্সেস রয়েছে।`;
    bullets = [
      'গুগল মিটে স্বয়ংক্রিয় উপস্থিতি ও সুনির্দিষ্ট প্রবেশ/প্রস্থান সময়ের আনলিমিটেড ট্র্যাকিং।',
      'আপনার গুগল ড্রাইভে গুগল শিট-এ সরাসরি এক্সপোর্ট।',
      'কোনো ক্রেডিট কার্ড বা অটো-রিনিউয়াল চার্জের প্রয়োজন নেই (সম্পূর্ণ $0)।',
    ];
    pClosing = 'আশা করি এটি আপনার ক্লাসের সময় বাঁচাতে সাহায্য করবে। আপনার কোনো প্রশ্ন বা পরামর্শ থাকলে সরাসরি এই ইমেলের উত্তর দিতে পারেন!';
    signoff = 'আন্তরিক শুভেচ্ছা,';
    ctaText = 'Attendance Tracker খুলুন →';
  }

  const contentHtml = `
    <p style="margin:0 0 14px;font-size:15px;color:#e6edf3;line-height:1.6;">${escape(greeting)}</p>
    <p style="margin:0 0 14px;font-size:14px;color:#e6edf3;line-height:1.6;">${escape(p1)}</p>
    <div style="background:#0d1117;border:1px solid #238636;border-radius:8px;padding:16px;margin:18px 0;">
      <div style="font-size:14px;color:#3fb950;font-weight:600;margin-bottom:8px;">${escape(cardTitle)}</div>
      <div style="font-size:13px;color:#c9d1d9;line-height:1.5;">${escape(cardSubtitle)}</div>
      <div style="margin-top:10px;font-size:13px;color:#8b949e;line-height:1.5;">
        ${bullets.map(b => `• ${escape(b)}<br>`).join('')}
      </div>
    </div>
    <p style="margin:0 0 14px;font-size:14px;color:#e6edf3;line-height:1.6;">${escape(pClosing)}</p>
    <p style="margin:16px 0 0;font-size:14px;color:#8b949e;line-height:1.5;">
      ${escape(signoff)}<br>
      <strong style="color:#e6edf3;">Derek Gallardo</strong><br>
      Attendance Tracker
    </p>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'success',
    title,
    contentHtml,
    ctaText,
    ctaUrl: 'https://attendancetracker.dev/history.html',
    ctaColor: 'green',
    footerHtml: foot.html,
  });

  const text = [
    greeting,
    '',
    p1,
    '',
    cardTitle,
    cardSubtitle,
    ...bullets.map(b => `• ${b}`),
    '',
    pClosing,
    '',
    signoff,
    'Derek Gallardo',
    'Attendance Tracker',
    '',
    `Dashboard: https://attendancetracker.dev/history.html`,
    foot.text,
  ].join('\n');

  const from = process.env.RESEND_FROM_DOMAIN
    ? 'Derek Gallardo <derek@attendancetracker.dev>'
    : makeFrom('Derek Gallardo');

  return {
    to,
    from,
    replyTo: 'derek@attendancetracker.dev',
    subject,
    text,
    html,
    lang,
    dateStr,
  };
}

const REVIEW_APPROVAL_KEY_LABEL = 'review_approval:v1';
function createReviewApprovalToken(reviewId, email) {
  return crypto
    .createHmac('sha256', CONFIG.deriveSecret(REVIEW_APPROVAL_KEY_LABEL))
    .update(`${String(reviewId)}:${String(email).toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function verifyReviewApprovalToken(reviewId, email, token) {
  if (!reviewId || !email || !token) return false;
  const expected = createReviewApprovalToken(reviewId, email);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function reviewApprovalUrl(reviewId, email) {
  const t = createReviewApprovalToken(reviewId, email);
  return `${CONFIG.publicApiUrl}/admin/reviews/approve-reward?reviewId=${encodeURIComponent(reviewId)}&email=${encodeURIComponent(email)}&t=${t}`;
}

/**
 * Alert Derek about a new verified review + Pro activation with full draft email
 * for inspection before sending out to the user.
 */
async function sendReviewRewardDraftAlert({
  to = 'derekgallardo01@gmail.com',
  userEmail,
  domain,
  displayName,
  review,
  expiresAt,
  draft,
}) {
  const approvalUrl = reviewApprovalUrl(review.reviewId, userEmail);
  const stars = '★'.repeat(review.rating || 5) + '☆'.repeat(5 - (review.rating || 5));
  const dateStr = draft.dateStr || new Date(expiresAt).toISOString().slice(0, 10);
  const mailtoUrl = `mailto:${encodeURIComponent(userEmail)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.text)}`;

  const bodyText = `⭐ Verified Marketplace Review & Pro Activated: ${userEmail}

A Google Workspace Marketplace review has been verified, and 1 Month Educator Pro has been ACTIVATED in Firestore!

[STATUS]:
- User: ${userEmail} (${displayName || 'Unknown Name'})
- Domain: ${domain}
- Pro Activated: YES (Active until ${dateStr}, 35 days)
- Reward Email to User: PENDING YOUR APPROVAL (Not yet sent)

[REVIEW DETAILS]:
- Rating: ${stars} (${review.rating}/5)
- Author: ${review.authorName}
- Date: ${review.date || (review.timestampMs ? new Date(review.timestampMs).toISOString() : 'Recent')}
- Comment:
"${review.comment}"

[DRAFT EMAIL FOR USER (Language: ${draft.lang.toUpperCase()})]:
From: ${draft.from}
Reply-To: ${draft.replyTo}
To: ${userEmail}
Subject: ${draft.subject}

${draft.text}

--------------------------------------------------
[ACTIONS FOR DEREK]:
1. One-Click Approve & Dispatch Email via Resend:
${approvalUrl}

2. Or Send via your Email Client (from derek@attendancetracker.dev):
${mailtoUrl}

3. Admin Dashboard:
${CONFIG.publicSiteUrl}/admin.html
`;

  return sendAdminEmail({
    to,
    subject: `⭐ Review Verified & Pro Activated: ${userEmail} (${review.rating}★) - Review Draft Email`,
    body: bodyText,
  });
}

/**
 * Send a warm, localized confirmation email to an educator whose review has been verified.
 * Always sends from Derek Gallardo <derek@attendancetracker.dev>.
 */
async function sendReviewRewardEmail(params) {
  const { to } = params || {};
  if (!getResend()) return { sent: false, reason: 'no_resend' };
  if (!to || !to.includes('@')) return { sent: false, reason: 'invalid_email' };

  const content = buildReviewRewardEmailContent(params);
  const subject = params.customSubject || content.subject;
  const text = params.customText || content.text;
  const html = params.customHtml || content.html;

  return dispatchEmail({
    from: content.from,
    replyTo: content.replyTo,
    to,
    subject,
    text,
    html,
    tags: [
      { name: 'type', value: 'review_reward' },
      { name: 'lang', value: content.lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'review reward email', { to, lang: content.lang });
}

module.exports = {
  sendSignupWebhook, sendUpgradeNotification, sendAdminSubscriptionCancelledNotification, sendAdminEmailUnsubscribedNotification, maybeSendSignupNotification, sendWelcomeEmail, sendReferralNotification, maybeSendReferralNotification, flushDeferredNotifications, sendAdminEmail, sendErrorAlertEmail, sendWeeklySelfReport, sendExportNotification, sendOrgWeeklyDigest,
  sendSeriesAlertEmail, sendFeedbackEmail, sendReactivationEmail, sendActivationNudgeEmail, sendSoloNudgeEmail, sendForgottenMeetingEmail, sendComebackEmail, sendExportGapEmail, sendUpcomingMeetingEmail, sendUpgradeLinkEmail, sendSubscriptionCancelledEmail, sendReviewRewardEmail, buildReviewRewardEmailContent, sendReviewRewardDraftAlert, createReviewApprovalToken, verifyReviewApprovalToken, reviewApprovalUrl,
  sendSlackDigest, sendSlackTestPing, buildSlackDigestBlocks, buildSlackFallbackText, maskSlackWebhook,
  sendChatDigest, sendChatTestPing, buildChatDigestCard, maskGoogleChatWebhook,
  sendDiscordDigest, sendDiscordTestPing, buildDiscordDigestEmbed, maskDiscordWebhook,
  unsubscribeUrl, unsubscribeToken, verifyUnsubscribeToken, unsubscribeFooter, buildDesignSystemEmail, resolveLanguage,
};
