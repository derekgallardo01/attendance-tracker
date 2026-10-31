const crypto = require('crypto');
const { Resend } = require('resend');
const log = require('./logger');
const CONFIG = require('../config');
const { maskSlackWebhook } = require('./slack');
const { maskGoogleChatWebhook } = require('./googleChat');
const { maskDiscordWebhook } = require('./discord');
const { escapeHtml: escape } = require('./html');
const { resolveGeo, isGenericUsPlaceholder } = require('./geoip');
const { tf, strictLocale, normalizeLocale, priceTableFor, withPrices, fmtMinutes, fmtDateTime, fmtRelativeDays, fmtMoney, fmtDate } = require('./i18n');

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
// Evaluates explicit language preference (any of the 60 app locales — the
// language the user chose in the app) -> user's country -> domain extension
// (guessed only for es/pt/bn) -> defaults to 'en'.
function resolveLanguage({ language, country, domain, email } = {}) {
  if (language && typeof language === 'string') {
    const l = strictLocale(language.trim());
    if (l) return l;
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
          to: Array.isArray(params.to) ? params.to[0] : params.to,
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
  const prompt = tf('mail.unsubPrompt', lang, null, "Don't want these emails?");
  const link = tf('mail.unsubLink', lang, null, 'Unsubscribe');
  const optOutText = `${prompt} ${link}:`;
  const optOutHtml = `${escape(prompt)} <a href="${escape(url)}" style="color:#58a6ff;text-decoration:none;">${escape(link)}</a>.`;

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
  lang = 'en',
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

  const defaultFooter = `${escape(tf('mail.sentBy', lang, null, 'Sent by Attendance Tracker'))} &bull; <a href="https://attendancetracker.dev" style="color:#58a6ff;text-decoration:none;">attendancetracker.dev</a>`;
  const htmlLang = normalizeLocale(lang);
  const dir = ['ar', 'he', 'ur'].includes(htmlLang) ? 'rtl' : 'ltr';

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
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
      .responsive-table, .responsive-table tbody, .responsive-table tr, .responsive-table td {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        box-sizing: border-box !important;
      }
      .responsive-table td:first-child {
        padding: 8px 12px 2px !important;
        border-bottom: none !important;
        font-size: 11px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.04em !important;
        color: #8b949e !important;
      }
      .responsive-table td:last-child {
        padding: 0 12px 8px !important;
        font-size: 13px !important;
        word-break: break-word !important;
        overflow-wrap: anywhere !important;
      }
      .responsive-table tr:last-child td:last-child {
        border-bottom: none !important;
      }
      .responsive-data-table td { padding: 8px 8px !important; font-size: 12px !important; }
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
        ${title ? `<h2 style="margin:6px 0 4px;font-size:17px;font-weight:700;color:#e6edf3;word-break:break-word;">${escape(title)}</h2>` : ''}
        ${subtitle ? `<p style="margin:0;font-size:13px;color:#8b949e;line-height:1.4;word-break:break-word;">${escape(subtitle)}</p>` : ''}
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

// "March 3, 2026" in the recipient's language.
function fmtLongDate(date, lang) {
  // UTC: these are calendar dates (period ends, expiries), not instants.
  return new Date(date).toLocaleDateString(normalizeLocale(lang), { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
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

  let country = signupGeo?.country || null;
  if (signupIp && (!country || (typeof isGenericUsPlaceholder === 'function' && isGenericUsPlaceholder(signupGeo)))) {
    try {
      const resolved = typeof resolveGeo === 'function' ? await resolveGeo(signupIp, { domain, email }) : null;
      if (resolved?.country) {
        country = resolved.country;
      }
    } catch (_) {}
  }
  const flag = country ? String.fromCodePoint(0x1F1E6 + country.toUpperCase().charCodeAt(0) - 65, 0x1F1E6 + country.toUpperCase().charCodeAt(1) - 65) + ' ' : '';
  const ipLine = signupIp
    ? `${flag}${signupIp}${country ? ` (${country})` : ''}`
    : 'Unknown';
  const ipLink = signupIp ? `https://ipinfo.io/${encodeURIComponent(signupIp)}` : null;

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Name</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source (self-reported)</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(reportedText)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source (detected)</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(detectedText)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">IP / Location</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;">${ipLink ? `<a href="${escape(ipLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(ipLine)}</a>` : `<span style="color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(ipLine)}</span>`}</td></tr>
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

// Follow-up notification when a user answers the "How did you find us?" modal
// after the initial signup notification was already sent at sign-in.
async function sendSourceReportedNotification({ email, displayName, domain, reportedSource, reportedDetail, detectedSource }) {
  if (!getResend()) return { skipped: "no resend" };
  const to = process.env.NOTIFY_EMAIL || ownerEmail();
  if (!to || !reportedSource) return { skipped: "missing target or source" };

  const reportedText = `${reportedSource}${reportedDetail ? ` — ${reportedDetail}` : ""}`;
  const detectedText = detectedSource || "Unknown";
  const subject = `🔎 Source reported: ${displayName || email} (via ${reportedText})`;

  const contentHtml = `
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:8px;box-sizing:border-box;">
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Name</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || "—"}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source (self-reported)</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#4ade80;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escape(reportedText)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">Source (detected)</td><td style="padding:8px 10px;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(detectedText)}</td></tr>
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: "🔎 Attribution",
    badgeType: "info",
    title: `🔎 ${displayName || email}`,
    subtitle: "User answered the \"How did you find us?\" prompt.",
    contentHtml,
    ctaText: "Open admin dashboard →",
    ctaUrl: "https://attendancetracker.dev/admin.html",
    ctaColor: "green",
  });

  const text = [
    `Source reported by: ${displayName || email}`,
    `Email: ${email}`,
    `Domain: ${domain}`,
    `Source (self-reported): ${reportedText}`,
    `Source (detected): ${detectedText}`,
    "",
    "Open admin dashboard: https://attendancetracker.dev/admin.html",
  ].join("\n");

  return dispatchEmail({
    from: makeFrom("Attendance Tracker"),
    to, subject, text, html,
    tags: [{ name: "type", value: "source_reported" }],
  }, "source reported notification", { email, domain, reportedSource });
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
  else if (plan === 'single_meeting') planLabel = 'Single Meeting Pass';
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
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Plan</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#4ade80;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escape(planLabel)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Amount</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;word-break:break-word;overflow-wrap:anywhere;">${escape(formattedAmount)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain || '—')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Country / Location</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(locationText)}</td></tr>
      ${stripeSubLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Subscription</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeSubLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(subscriptionId)}</a></td></tr>` : ''}
      ${stripeCustomerLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Stripe Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeCustomerLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(customerId)}</a></td></tr>` : ''}
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
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Plan</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#f85149;font-weight:700;word-break:break-word;overflow-wrap:anywhere;">${escape(planLabel)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain || '—')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Active Until</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(currentPeriodEnd || 'End of current period')}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#8b949e;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;">${escape(source)}</code></td></tr>
      ${stripeSubLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Subscription</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeSubLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(subscriptionId)}</a></td></tr>` : ''}
      ${stripeCustomerLink ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Stripe Customer</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="${escape(stripeCustomerLink)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(customerId)}</a></td></tr>` : ''}
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

// Fire-and-forget celebratory founder email when a major growth milestone is unlocked.
// Alerts NOTIFY_EMAIL / owner with milestone metrics, growth trajectory, and a ready-to-share social snippet.
async function sendAdminMilestoneEmail({
  milestone,
  currentStats = {},
  meta = {},
} = {}) {
  if (!getResend()) return { skipped: 'no resend' };
  const to = process.env.NOTIFY_EMAIL || ownerEmail() || 'derekgallardo01@gmail.com';
  if (!to) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const metric = milestone?.metric || 'users';
  const threshold = milestone?.threshold || 0;
  const label = milestone?.label || `${threshold} ${metric}`;
  const userCount = Number(currentStats.userCount || currentStats.users || threshold);
  const proCount = Number(currentStats.proCount || currentStats.activeProUsers || 0);
  const meetingCount = Number(currentStats.meetingCount || currentStats.meetings || 0);

  const subject = `🎉 Milestone Unlocked: ${label} on Attendance Tracker!`;

  let socialCopy = '';
  if (metric === 'users') {
    socialCopy = `🎉 Milestone unlocked: Attendance Tracker just crossed ${Number(threshold).toLocaleString()} registered educators and organizers across Google Meet! 🚀\n\nBuilt as an independent, bootstrapped add-on with zero VC funding.\n\nThank you to all our teachers and teams!\nhttps://attendancetracker.dev`;
  } else if (metric === 'pro') {
    socialCopy = `💰 Milestone unlocked: Attendance Tracker just reached ${Number(threshold).toLocaleString()} paying Pro customers! 📈\n\nProfitable, sustainable unit economics for a Google Workspace add-on.\nhttps://attendancetracker.dev/pricing.html`;
  } else {
    socialCopy = `📊 Milestone unlocked: ${Number(threshold).toLocaleString()} meetings tracked automatically on Attendance Tracker! Millions of minutes saved for teachers worldwide. 🍎\nhttps://attendancetracker.dev`;
  }

  const contentHtml = `
    <div style="background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.25);border-radius:10px;padding:16px;margin-bottom:18px;text-align:center;">
      <div style="font-size:2rem;margin-bottom:4px;">🎉 🏆 🚀</div>
      <div style="font-size:1.15rem;font-weight:700;color:#4ade80;margin-bottom:4px;">${escape(label)}</div>
      <div style="font-size:13px;color:#8b949e;">Huge accomplishment Derek! Attendance Tracker just crossed another milestone on its growth trajectory.</div>
    </div>

    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;width:100%;font-size:13px;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:18px;box-sizing:border-box;">
      <tr><td style="padding:9px 12px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:40%;">Milestone Metric</td><td style="padding:9px 12px;border-bottom:1px solid #21262d;color:#4ade80;font-weight:700;">${escape(label)}</td></tr>
      <tr><td style="padding:9px 12px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;">Total Registered Users</td><td style="padding:9px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;">${userCount.toLocaleString()}</td></tr>
      <tr><td style="padding:9px 12px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;">Active Pro Customers</td><td style="padding:9px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;">${proCount > 0 ? proCount.toLocaleString() : '—'}</td></tr>
      <tr><td style="padding:9px 12px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;">Meetings Tracked</td><td style="padding:9px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-weight:600;">${meetingCount > 0 ? meetingCount.toLocaleString() : '—'}</td></tr>
      <tr><td style="padding:9px 12px;color:#8b949e;font-weight:600;">Unlocked At</td><td style="padding:9px 12px;color:#e6edf3;">${new Date().toUTCString()}</td></tr>
    </table>

    <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-bottom:14px;">
      <div style="font-size:12px;font-weight:700;color:#58a6ff;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">📱 Ready-to-Post Social Snippet (X / LinkedIn / Indie Hackers)</div>
      <pre style="margin:0;padding:10px;background:#0d1117;border:1px solid #21262d;border-radius:6px;font-size:12px;color:#e6edf3;white-space:pre-wrap;font-family:monospace;line-height:1.5;">${escape(socialCopy)}</pre>
    </div>
  `;

  const html = buildDesignSystemEmail({
    badge: '🏆 Growth Milestone',
    badgeType: 'success',
    title: `🎉 ${label} Reached!`,
    subtitle: 'Automated growth milestone notification for Kinetic Helix.',
    contentHtml,
    ctaText: 'Open Admin Command Center →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'green',
  });

  const text = [
    `🎉 MILESTONE UNLOCKED: ${label}!`,
    '',
    `Total Users: ${userCount.toLocaleString()}`,
    `Pro Customers: ${proCount > 0 ? proCount.toLocaleString() : '—'}`,
    `Meetings Tracked: ${meetingCount > 0 ? meetingCount.toLocaleString() : '—'}`,
    '',
    'Social Snippet:',
    socialCopy,
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Milestones'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'admin_milestone' }],
  }, 'admin milestone notification', { metric, threshold });
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
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">User Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
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

  // Automatic founder milestone check: when a new signup crosses a growth threshold
  // (e.g. 100, 250, 500, 1,000, 2,500, 5,000, 10,000+ users), trigger celebration email immediately.
  if (typeof totalUsers === 'number' && totalUsers > 0) {
    try {
      const { checkAndRecordMilestones } = require('../services/firestore');
      if (typeof checkAndRecordMilestones === 'function') {
        await checkAndRecordMilestones({ userCount: totalUsers }, {
          meta: { trigger: 'signup', email: payload.email, domain: payload.domain },
        });
      }
    } catch (mErr) {
      log.warn('milestone check on signup failed', { error: mErr.message, totalUsers });
    }
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
  const R = (key, vars) => tf(`mail.referral.${key}`, lang, vars);

  const months = rewardMonths === 1 ? R('monthOne') : R('monthMany', { n: rewardMonths });
  const rewardLine = !rewarded
    ? R('rewardThanks')
    : promoCode
      ? R('rewardCode', { months, code: promoCode })
      : R('rewardEarned', { months });
  const subject = R(rewarded ? 'subjectRewarded' : 'subjectInvite', { name: newUserName });
  const introLine = R('intro', { name: newUserName });
  const totalLine = totalReferrals > 1 ? R('totalMany', { n: totalReferrals }) : R('totalOne');

  const promoBox = promoCode ? `
    <div style="margin:16px 0;padding:14px 16px;background:#0d1117;border:1px dashed #4ade80;border-radius:8px;text-align:center;box-sizing:border-box;">
      <div style="font-size:11px;text-transform:uppercase;color:#8b949e;letter-spacing:0.05em;margin-bottom:6px;font-weight:600;">${escape(R('promoLabel'))}</div>
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
    badge: tf('mail.badge.referral', lang),
    badgeType: 'success',
    ctaText: `${tf(promoCode ? 'mail.cta.redeemCode' : 'mail.cta.openTracker', lang)} →`,
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
async function flushDeferredNotifications(domain, email) {
  // Returns a never-rejecting promise so callers that need the flush to
  // COMPLETE before their process may be CPU-throttled (the oauth exchange on
  // Cloud Run) can await it; fire-and-forget callers ignore the return.
  // Run sequentially so claimSignupNotification and claimReferral never open
  // two concurrent transactions on the same users/{email} document.
  const r1 = await maybeSendSignupNotification(domain, email).catch(() => { /* best-effort */ });
  const r2 = await maybeSendReferralNotification(domain, email).catch(() => { /* best-effort */ });
  return [
    { status: 'fulfilled', value: r1 },
    { status: 'fulfilled', value: r2 },
  ];
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
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;width:34%;max-width:120px;vertical-align:top;word-break:break-word;">User Email</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><a href="mailto:${escape(email)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(email)}</a></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Domain</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(domain)}</td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Context</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#f85149;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-word;overflow-wrap:anywhere;">${escape(context)}</code></td></tr>
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">Error Message</td><td style="padding:8px 10px;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#f85149;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-word;overflow-wrap:anywhere;">${escape(error)}</code></td></tr>
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

// Hourly error spike alert email. Alerts admin/owner using the design system
// when export failure volume exceeds the configured threshold.
async function sendErrorSpikeAlertEmail({ to, total, threshold = 5, windowMin = 60, byReason = {}, users = [], samples = [] }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const target = to || process.env.NOTIFY_EMAIL || ownerEmail();
  if (!target) return { skipped: 'no NOTIFY_EMAIL/owner' };

  const sortedReasons = Object.entries(byReason || {}).sort((a, b) => b[1] - a[1]);
  const userList = Array.isArray(users) ? users : [];
  const sampleList = Array.isArray(samples) ? samples : [];

  const isClientPermission = (reason) => {
    if (!reason || typeof reason !== 'string') return false;
    const r = reason.toLowerCase();
    return ['scope_blocked', 'drive_permission_missing', 'auth_expired', 'permission_denied', 'access_denied', 'insufficient_permissions'].includes(r)
      || r.includes('permission') || r.includes('scope');
  };

  const reasonRowsHtml = sortedReasons.length > 0
    ? sortedReasons.map(([r, n]) => {
        const isPerm = isClientPermission(r);
        const pillStyle = isPerm
          ? 'color:#e3b341;background:rgba(227,179,65,0.12);border:1px solid rgba(227,179,65,0.3);'
          : 'color:#f85149;background:rgba(248,81,73,0.12);border:1px solid rgba(248,81,73,0.3);';
        const label = isPerm ? '<span style="font-size:11px;color:#8b949e;margin-left:6px;">(client permission)</span>' : '';
        return `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #21262d;vertical-align:middle;word-break:break-word;">
            <span style="font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:10px;font-family:monospace;display:inline-block;${pillStyle}">${escape(r)}</span>${label}
          </td>
          <td style="padding:8px 10px;border-bottom:1px solid #21262d;text-align:right;font-weight:700;color:#e6edf3;">${escape(n)}×</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="2" style="padding:8px 10px;color:#8b949e;font-size:12px;">(none categorized)</td></tr>';

  const userEmailsHtml = userList.length > 0
    ? `<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.5;margin-bottom:16px;word-break:break-word;">
        ${userList.slice(0, 20).map(u => `<a href="mailto:${escape(u)}" style="color:#58a6ff;text-decoration:none;word-break:break-all;">${escape(u)}</a>`).join(', ')}${userList.length > 20 ? ` <span style="color:#8b949e;">(+${userList.length - 20} more)</span>` : ''}
      </div>`
    : '<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px 12px;font-size:13px;color:#8b949e;margin-bottom:16px;">(none recorded)</div>';

  const sampleMessagesHtml = sampleList.length > 0
    ? `<div style="margin-top:16px;">
        <h4 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">Sample Messages</h4>
        <pre style="background:#0d1117;border:1px solid #30363d;padding:10px 12px;border-radius:6px;font-size:12px;color:#f85149;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-family:monospace;margin:0 0 16px;box-sizing:border-box;">${escape(sampleList.join('\n'))}</pre>
      </div>`
    : '';

  const contentHtml = `
    <!-- Summary Metrics -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="padding:12px 8px;background:#0d1117;border:1px solid #30363d;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.04em;">Failures</div>
          <div style="font-size:22px;font-weight:700;color:#f85149;margin-top:4px;">${Number(total) || 0}</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px 8px;background:#0d1117;border:1px solid #30363d;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.04em;">Window</div>
          <div style="font-size:20px;font-weight:700;color:#e6edf3;margin-top:4px;">${windowMin}m</div>
        </td>
        <td style="width:8px;"></td>
        <td style="padding:12px 8px;background:#0d1117;border:1px solid #30363d;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:11px;color:#8b949e;text-transform:uppercase;font-weight:600;letter-spacing:0.04em;">Threshold</div>
          <div style="font-size:20px;font-weight:700;color:#e6edf3;margin-top:4px;">${threshold}</div>
        </td>
      </tr>
    </table>

    <!-- Breakdown by Reason -->
    <h4 style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">Breakdown by Reason</h4>
    <table class="responsive-table" style="table-layout:fixed;border-collapse:collapse;font-size:13px;width:100%;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin-bottom:16px;box-sizing:border-box;">
      <thead>
        <tr style="border-bottom:1px solid #30363d;background:#161b22;">
          <th style="padding:8px 10px;text-align:left;color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;">Reason</th>
          <th style="padding:8px 10px;text-align:right;color:#8b949e;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;width:80px;">Count</th>
        </tr>
      </thead>
      <tbody>
        ${reasonRowsHtml}
      </tbody>
    </table>

    <!-- Affected Users -->
    <h4 style="margin:16px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#8b949e;">Affected Users (${userList.length})</h4>
    ${userEmailsHtml}

    ${sampleMessagesHtml}

    <p style="margin:12px 0 0;font-size:12px;color:#8b949e;line-height:1.5;">
      Full detail + stack traces are in Sentry (issue &ldquo;sheets export failed&rdquo; and recent frontend exceptions).
    </p>
  `;

  const html = buildDesignSystemEmail({
    badge: '⚠️ Export Alert',
    badgeType: 'error',
    title: 'Export Failure Spike Detected',
    subtitle: `${total} failures in the last ${windowMin} minutes (threshold: ${threshold})`,
    contentHtml,
    ctaText: 'Open Admin Dashboard →',
    ctaUrl: `${CONFIG.publicSiteUrl}/admin.html`,
    ctaColor: 'blue',
  });

  const reasonsText = sortedReasons.map(([r, n]) => `  ${n}× ${r}`).join('\n');
  const text = [
    `${total} Attendance Tracker export failures in the last ${windowMin} minutes (alert threshold: ${threshold}).`,
    '',
    'By reason:',
    reasonsText || '  (none categorized)',
    '',
    `Affected users (${userList.length}): ${userList.slice(0, 20).join(', ')}${userList.length > 20 ? ' …' : ''}`,
    sampleList.length ? `\nSample messages:\n${sampleList.map(s => '  ' + s).join('\n')}` : '',
    '',
    'Full detail + stack traces are in Sentry (issue "sheets export failed" and recent frontend exceptions).',
    '',
    `Open Admin Dashboard: ${CONFIG.publicSiteUrl}/admin.html`,
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Alerts'),
    to: target,
    subject: `⚠️ ${total} Attendance Tracker export failures in the last hour`,
    text,
    html,
    tags: [{ name: 'type', value: 'error_spike_alert' }],
  }, 'error spike alert', { total, threshold, windowMin });
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

  // Revenue from the payments ledger (USD; regional currencies FX-estimated).
  const rv = report.revenue;
  const usd = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
  const revenueHtml = rv ? `
      <div style="padding:20px 24px;border-bottom:1px solid #30363d;">
        <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;color:#4ade80;">💰 Revenue</h3>
        <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.6;color:#e6edf3;">
          <div><b>This week:</b> <strong style="color:#4ade80;">${usd(rv.approxUsd?.last7d)}</strong> <span style="color:#8b949e;">· 30d ${usd(rv.approxUsd?.last30d)} · all-time ${usd(rv.approxUsd?.allTime)}</span></div>
          <div><b>MRR:</b> <strong style="color:#4ade80;">${usd(rv.mrrApproxUsd)}</strong> <span style="color:#8b949e;">from ${rv.activeSubscriptions || 0} active subscription${rv.activeSubscriptions === 1 ? '' : 's'}</span></div>
          <div><b>Mix (all-time):</b> <span style="color:#8b949e;">one-time ${usd(rv.approxUsd?.oneTime)} · recurring ${usd(rv.approxUsd?.recurring)}</span></div>
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

          ${revenueHtml}
          ${retentionHtml}
          ${report.billing ? `
          <div style="padding:16px 20px;border-bottom:1px solid #30363d;background:#0d1117;">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#58a6ff;margin-bottom:6px;font-weight:700;">☁️ Cloud Billing &amp; Firestore Usage</div>
            <div style="font-size:13px;color:#e6edf3;line-height:1.6;">
              24h Reads: <strong>${Number(report.billing.last24h?.reads || 0).toLocaleString()}</strong> · 24h Est: <strong>$${Number(report.billing.last24h?.cost?.totalCostUsd || 0).toFixed(2)}</strong> · MTD Est: <strong>$${Number(report.billing.monthToDate?.cost?.totalCostUsd || 0).toFixed(2)}</strong> · Projected Month: <strong>$${Number(report.billing.projections?.monthTotalFrom24hRateUsd || 0).toFixed(2)}</strong>
            </div>
          </div>` : ''}

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
    ...(report.billing ? [
      ``,
      `Cloud Billing & Firestore:`,
      `  24h Reads: ${Number(report.billing.last24h?.reads || 0).toLocaleString()} ($${Number(report.billing.last24h?.cost?.totalCostUsd || 0).toFixed(2)})`,
      `  MTD Cost:  $${Number(report.billing.monthToDate?.cost?.totalCostUsd || 0).toFixed(2)} (Projected month: $${Number(report.billing.projections?.monthTotalFrom24hRateUsd || 0).toFixed(2)})`,
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
async function sendExportNotification({ to, displayName, sheetUrl, meetingTitle, totalAttended, totalInvited, exportedAt, participants, overflow, conferenceId, recurringEventId, isPro = false, plan, language, country, domain, durationMin }) {
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

  const prices = priceTableFor({ country, email: to });
  const L = (key, vars) => withPrices(tf(key, lang, vars), prices);

  const title = meetingTitle || 'Google Meet';
  const summary = totalInvited
    ? L('mail.export.summaryOf', { attended: totalAttended, invited: totalInvited })
    : L('mail.export.summary', { attended: totalAttended });
  const subject = L('mail.export.subject', { title, summary });
  const firstName = displayName ? displayName.split(' ')[0] : '';
  const greeting = escape(firstName ? L('mail.greetingName', { name: firstName }) : L('mail.greeting'));
  const badgeText = L('mail.export.badge');
  const meetingEndedText = L('mail.export.ended');
  const colPerson = L('mail.export.colPerson');
  const colStatus = L('mail.export.colStatus');
  const colTime = L('mail.export.colTime');
  const colDuration = L('mail.export.colDuration');
  const colAttendance = L('mail.export.colAttendance');
  const colTopAttendee = L('mail.export.colTopAttendee');
  const overflowText = (n) => L('mail.export.overflow', { n });
  const openSheetText = L('mail.export.openSheet');
  const viewOnWebText = `${L('mail.export.viewOnWeb')} →`;
  const seriesTrendHtml = (link) => `${escape(L('mail.export.seriesPart'))} <a href="${escape(link)}" style="color:#58a6ff;font-weight:500;text-decoration:none">${escape(L('mail.export.seriesLink'))} →</a>`;
  const seriesTrendPlain = (link) => `${L('mail.export.seriesPlain')} ${link}`;
  const reviewBoxTitle = L('mail.export.reviewTitle');
  const reviewBoxBody = L('mail.export.reviewBody');
  const reviewBoxBtn = `${L('mail.export.reviewBtn')} →`;
  const reviewBoxPlainPrompt = L('mail.export.reviewPlain');
  const footerNotice = L('mail.export.footer');

  const dateStr = exportedAt ? fmtDateTime(exportedAt, lang) : '';

  const STATUS_KEYS = { Present: 'mail.export.statusPresent', Left: 'mail.export.statusLeft', Excused: 'mail.export.statusExcused', Absent: 'mail.export.statusAbsent' };
  const statusLabel = (st) => (STATUS_KEYS[st] ? L(STATUS_KEYS[st]) : st);
  const lateLabel = (min) => L('mail.export.late', { n: min });

  // Inline attendance table. Color-codes status: green=present, amber=left
  // early, red=absent. Keeps the email scannable in 2 seconds.
  const statusColor = (s) => {
    if (s === 'Present') return '#4ade80';
    if (s === 'Left') return '#f59e0b';
    if (s === 'Excused') return '#8b949e'; // muted gray — excused isn't a problem
    return '#f85149';
  };
  const fmtDur = (m) => !m ? '—' : fmtMinutes(m, lang);

  // Executive summary highlights
  const meetingDur = (durationMin != null && durationMin > 0)
    ? durationMin
    : (participants || []).reduce((max, p) => Math.max(max, p.durationMin || 0), 0);

  const attendeesWithDuration = (participants || []).filter(p => (p.durationMin || 0) > 0);
  const topAttendee = attendeesWithDuration.length > 0
    ? attendeesWithDuration.reduce((max, p) => ((p.durationMin || 0) > (max.durationMin || 0) ? p : max), attendeesWithDuration[0])
    : null;

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

  const highlightsHtml = `
      <div style="display:table;width:100%;table-layout:fixed;border-top:1px solid #21262d;margin-top:12px;padding-top:10px">
        <div style="display:table-cell;width:33%;text-align:left;vertical-align:top">
          <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">${escape(colDuration)}</div>
          <div style="font-size:13px;color:#e6edf3;font-weight:600;margin-top:2px">${escape(meetingDur > 0 ? fmtDur(meetingDur) : '—')}</div>
        </div>
        <div style="display:table-cell;width:33%;text-align:left;vertical-align:top">
          <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">${escape(colAttendance)}</div>
          <div style="font-size:13px;color:#4ade80;font-weight:600;margin-top:2px">${escape(String(totalAttended))}${totalInvited ? `<span style="color:#8b949e;font-size:11px"> / ${escape(String(totalInvited))}</span>` : ''}</div>
        </div>
        ${topAttendee ? `
        <div style="display:table-cell;width:34%;text-align:left;vertical-align:top">
          <div style="font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:0.5px;font-weight:600">${escape(colTopAttendee)}</div>
          <div style="font-size:12px;color:#e6edf3;font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escape(topAttendee.displayName || topAttendee.email || '—')} <span style="color:#8b949e;font-size:11px">(${escape(fmtDur(topAttendee.durationMin))})</span></div>
        </div>` : ''}
      </div>
  `;

  const isFree = plan ? plan !== 'pro' : !isPro;
  let clusterBoxHtml = '';
  let clusterBoxText = '';
  if (!isPro && resolvedDomain) {
    try {
      const { PERSONAL_EMAIL_DOMAINS } = require('../services/firestore/_core');
      if (!PERSONAL_EMAIL_DOMAINS.has(resolvedDomain.toLowerCase())) {
        const { getDomainTeacherCount, getUser, setUserSettings } = require('../services/firestore');
        if (typeof getDomainTeacherCount === 'function') {
          const teacherCount = await getDomainTeacherCount(resolvedDomain);
          if (teacherCount >= 2) {
            const userObj = (typeof getUser === 'function') ? await getUser(resolvedDomain, to) : null;
            const lastClusterSent = userObj?.lastClusterPromoSentAt ? new Date(userObj.lastClusterPromoSentAt).getTime() : 0;
            // Frequency cap: maximum once every 14 days
            if (!lastClusterSent || (Date.now() - lastClusterSent > 14 * 24 * 3600 * 1000)) {
              const clusterTitle = L('email.clusterSchoolTitle', { count: teacherCount });
              const clusterBody = L('email.clusterSchoolBody', { count: teacherCount, domain: resolvedDomain });
              const clusterCta = L('email.clusterSchoolCta');
              const clusterUrl = `https://attendancetracker.dev/pricing.html?plan=department&domain=${encodeURIComponent(resolvedDomain)}&utm_source=export_email_cluster`;
              clusterBoxHtml = `
                <div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:16px 0;text-align:left">
                  <div style="font-weight:600;color:#e6edf3;font-size:13px;margin-bottom:4px">🏫 ${escape(clusterTitle)}</div>
                  <div style="font-size:12px;color:#8b949e;margin-bottom:10px;line-height:1.4">${escape(clusterBody)}</div>
                  <a href="${escape(clusterUrl)}" class="touch-btn-sm" style="display:inline-block;background:#238636;color:#ffffff;font-size:12px;font-weight:600;padding:7px 13px;border-radius:6px;text-decoration:none;line-height:1.35">${escape(clusterCta)}</a>
                </div>
              `;
              clusterBoxText = `\n${clusterTitle}\n${clusterBody}\n${clusterUrl}\n`;
              try {
                if (typeof setUserSettings === 'function') {
                  setUserSettings(resolvedDomain, to, { lastClusterPromoSentAt: new Date().toISOString() }).catch(() => {});
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }

  const contentHtml = `
    <p style="margin:0 0 6px;font-size:15px;color:#e6edf3">${greeting}</p>
    <p style="margin:0 0 16px;font-size:14px;color:#8b949e">${escape(meetingEndedText)}</p>
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:0 0 16px 0">
      <div style="font-weight:700;font-size:15px;color:#e6edf3;margin-bottom:4px;word-break:break-word">${escape(title)}</div>
      <div style="font-size:13px;color:#8b949e;line-height:1.4">
        <span style="font-weight:600;color:#4ade80">${escape(summary)}</span>${dateStr ? `<span style="color:#8b949e;margin:0 6px">&bull;</span><span>${escape(dateStr)}</span>` : ''}
      </div>
      ${highlightsHtml}
    </div>
    ${tableHtml}
    <div style="margin:16px 0 12px 0">
      <a href="${escape(sheetUrl)}" class="touch-btn" style="display:inline-block;background:#238636;color:#ffffff;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;line-height:1.35;margin-right:8px;margin-bottom:8px">${escape(openSheetText)}</a>
      <a href="${escape(meetingLink)}" class="touch-btn" style="display:inline-block;background:#21262d;color:#58a6ff;border:1px solid #30363d;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;line-height:1.35;margin-bottom:8px">${escape(viewOnWebText)}</a>
    </div>
    ${seriesLink ? `<p style="margin:4px 0 16px;font-size:13px;color:#8b949e">${seriesTrendHtml(seriesLink)}</p>` : ''}
    ${clusterBoxHtml}
    ${isFree ? `<div style="background:#161b22;border:1px solid rgba(88,166,255,.4);border-radius:8px;padding:14px 16px;margin:16px 0;text-align:left">
      <div style="font-weight:700;color:#e6edf3;font-size:14px;margin-bottom:6px">${escape(L('mail.export.upsellTitle'))}</div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:12px;line-height:1.45">${escape(L('mail.export.upsellBody'))}</div>
      <a href="${CONFIG.publicSiteUrl}/pricing.html?ref=export_email&amp;utm_source=export_digest" class="touch-btn-sm" style="display:inline-block;background:#238636;color:#ffffff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:6px;text-decoration:none;line-height:1.35">${escape(L('mail.export.upsellCta'))} →</a>
    </div>` : ''}
    ${isPro ? '' : `<div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin:16px 0;text-align:left">
      <div style="font-weight:600;color:#e6edf3;font-size:13px;margin-bottom:4px">${escape(reviewBoxTitle)}</div>
      <div style="font-size:12px;color:#8b949e;margin-bottom:10px;line-height:1.4">${escape(reviewBoxBody)}</div>
      <a href="${escape(reviewUrl)}" class="touch-btn-sm" style="display:inline-block;background:#f59e0b;color:#0d1117;font-size:12px;font-weight:700;padding:7px 13px;border-radius:6px;text-decoration:none;line-height:1.35">${escape(reviewBoxBtn)}</a>
    </div>`}
  `;

  const foot = unsubscribeFooter(to, lang);
  const footerHtml = `
    <p style="margin:0 0 10px;color:#8b949e;font-size:12px;line-height:1.5;">
      ${escape(footerNotice)}
    </p>
    ${foot.html}
  `;

  const html = buildDesignSystemEmail({
    badge: badgeText,
    badgeType: 'success',
    title: L('mail.export.headerTitle', { title }),
    subtitle: summary,
    contentHtml,
    footerHtml,
    lang,
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
    `${L('mail.export.labelMeeting')}: ${title}`,
    `${colAttendance}: ${summary}`,
    dateStr ? `${L('mail.export.labelWhen')}: ${dateStr}` : '',
    `${colDuration}: ${meetingDur > 0 ? fmtDur(meetingDur) : '—'}`,
    topAttendee ? `${colTopAttendee}: ${topAttendee.displayName || topAttendee.email || '—'} (${fmtDur(topAttendee.durationMin)})` : '',
    ``,
    participants?.length ? `${textRows}${overflow > 0 ? `\n  ${overflowText(overflow)}` : ''}` : '',
    ``,
    `${openSheetText}: ${sheetUrl}`,
    `${L('mail.export.viewOnWeb')}: ${meetingLink}`,
    seriesLink ? seriesTrendPlain(seriesLink) : '',
    clusterBoxText ? clusterBoxText.trim() : '',
    ``,
    ...(isFree ? [
      L('mail.export.upsellTitle'),
      L('mail.export.upsellBody'),
      `${CONFIG.publicSiteUrl}/pricing.html?ref=export_email&utm_source=export_digest`,
      ``,
    ] : []),
    ...(isPro ? [] : [
      reviewBoxPlainPrompt,
      reviewUrl,
    ]),
    unsubscribeFooter(to, lang).text,
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

  const S = (key, vars) => tf(`mail.series.${key}`, lang, vars);
  const fallbackSomeone = S('someone');
  // Rule alerts carry their type + numbers, so the sentence is rendered in the
  // recipient's language; unknown types fall back to the stored English detail.
  const detailOf = (a) => {
    if (a.type === 'streak' && a.seriesTitle) return S('detailStreak', { title: a.seriesTitle });
    if (a.type === 'threshold' && a.seriesTitle && a.fromPct != null) return S('detailDrop', { title: a.seriesTitle, from: a.fromPct, to: a.toPct });
    return a.detail;
  };
  const subject = alerts.length === 1
    ? S('subjectOne', { name: alerts[0].personName || alerts[0].personEmail || fallbackSomeone, detail: detailOf(alerts[0]) })
    : S('subjectMany', { n: alerts.length });

  const firstName = displayName ? displayName.split(' ')[0] : '';
  const greeting = firstName ? tf('mail.greetingName', lang, { name: firstName }) : tf('mail.greeting', lang);
  const leadHtml = alerts.length === 1 ? S('leadOne') : S('leadMany', { n: alerts.length });
  const itemAttendedSummary = (attended, instanceCount) => S('attendedSummary', { attended, total: instanceCount });
  const badgeText = S('badge');
  const ctaText = `${S('cta')} →`;
  const footerNotice = S('footer');

  const itemHtml = alerts.map(a => `
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
      <div style="font-size:14px;color:#e6edf3;"><strong style="color:#58a6ff;">${escape(a.personName || a.personEmail || fallbackSomeone)}</strong> ${escape(detailOf(a))}.</div>
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
    lang,
  });
  const text = [
    greeting,
    '',
    leadHtml,
    '',
    ...alerts.map(a => `  - ${a.personName || a.personEmail || fallbackSomeone} ${detailOf(a)}. (${a.attended}/${a.instanceCount})`),
    '',
    `${S('cta')}: https://attendancetracker.dev/history.html`,
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
      <tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;width:32%;max-width:100px;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">From</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(fromName || '')} ${fromEmail ? `&lt;<a href="mailto:${escape(fromEmail)}" style="color:#58a6ff;text-decoration:none;word-break:break-word;overflow-wrap:anywhere;">${escape(fromEmail)}</a>&gt;` : '(no email)'}</td></tr>
      ${source ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Source</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;color:#e6edf3;word-break:break-word;overflow-wrap:anywhere;">${escape(source)}</td></tr>` : ''}
      ${conferenceId ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;border-bottom:1px solid #21262d;vertical-align:top;word-break:break-word;">Meeting</td><td style="padding:8px 10px;border-bottom:1px solid #21262d;word-break:break-word;overflow-wrap:anywhere;"><code style="background:#21262d;color:#58a6ff;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px;word-break:break-word;overflow-wrap:anywhere;">${escape(conferenceId)}</code></td></tr>` : ''}
      ${userAgent ? `<tr><td style="padding:8px 10px;color:#8b949e;font-weight:600;vertical-align:top;word-break:break-word;">User agent</td><td style="padding:8px 10px;color:#8b949e;font-size:11px;word-break:break-word;overflow-wrap:anywhere;">${escape(userAgent)}</td></tr>` : ''}
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

// Default badge + CTA per lifecycle email type (dictionary keys, 60 locales).
const PERSONAL_EMAIL_PRESETS = {
  welcome: { badge: 'mail.badge.welcome', badgeType: 'success', cta: 'mail.cta.openMeet', ctaUrl: 'https://meet.google.com', ctaColor: 'green' },
  reactivation: { badge: 'mail.badge.checkIn', badgeType: 'info', cta: 'mail.cta.openTracker', ctaUrl: 'https://attendancetracker.dev/history.html', ctaColor: 'blue' },
  activation_nudge: { badge: 'mail.badge.gettingStarted', badgeType: 'info', cta: 'mail.cta.startMeet', ctaUrl: 'https://meet.google.com', ctaColor: 'green' },
  solo_nudge: { badge: 'mail.badge.nextStep', badgeType: 'info', cta: 'mail.cta.tryRealMeeting', ctaUrl: 'https://meet.google.com', ctaColor: 'green' },
  upcoming_reminder: { badge: 'mail.badge.startingSoon', badgeType: 'info', cta: 'mail.cta.joinMeet', ctaUrl: 'https://meet.google.com', ctaColor: 'green' },
  forgotten_meeting: { badge: 'mail.badge.streak', badgeType: 'warning' },
  comeback_7d: { badge: 'mail.badge.nextMeeting', badgeType: 'info', cta: 'mail.cta.openDashboard', ctaUrl: 'https://attendancetracker.dev/history.html', ctaColor: 'blue' },
  export_gap: { badge: 'mail.badge.missingReport', badgeType: 'warning', cta: 'mail.cta.dashboardExport', ctaUrl: 'https://attendancetracker.dev/history.html', ctaColor: 'green' },
  referral: { badge: 'mail.badge.referral', badgeType: 'success', cta: 'mail.cta.openTracker', ctaUrl: 'https://attendancetracker.dev/history.html', ctaColor: 'green' },
};

// Subject + body lines of a dictionary-driven lifecycle email.
function mailCopy(id, lang, vars) {
  return {
    subject: tf(`mail.${id}.subject`, lang, vars),
    lines: tf(`mail.${id}.body`, lang, vars).split('\n'),
  };
}

async function sendPersonalEmail({
  to, displayName, subject, lines, tags, htmlLineTransform, logLabel, logMeta,
  language, country, domain, badge, badgeType = 'info', title, subtitle,
  ctaText = null, ctaUrl = null, ctaColor = 'green', extraHtml = null,
}) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });
  const firstName = displayName ? displayName.split(' ')[0] : null;
  const hi = firstName ? tf('mail.heyName', lang, { name: firstName }) : tf('mail.hey', lang);

  const body = [hi, '', ...lines].join('\n');
  const foot = unsubscribeFooter(to, lang);

  const contentLinesHtml = body.split('\n')
    .map(l => (htmlLineTransform && htmlLineTransform(l)) || renderPersonalEmailLine(l))
    .join('');

  const contentHtml = extraHtml ? `${contentLinesHtml}${extraHtml}` : contentLinesHtml;

  // Resolve badge if not passed explicitly
  const typeTag = tags?.find(t => t.name === 'type')?.value || logLabel;
  const preset = PERSONAL_EMAIL_PRESETS[typeTag] || {};
  let resolvedBadge = badge;
  let resolvedBadgeType = badgeType;
  if (!resolvedBadge && preset.badge) {
    resolvedBadge = tf(preset.badge, lang);
    resolvedBadgeType = preset.badgeType;
  }

  // Resolve CTA if not passed explicitly
  let resolvedCtaText = ctaText;
  let resolvedCtaUrl = ctaUrl;
  let resolvedCtaColor = ctaColor;
  if (!resolvedCtaText && !resolvedCtaUrl && preset.cta) {
    resolvedCtaText = `${tf(preset.cta, lang)} →`;
    resolvedCtaUrl = preset.ctaUrl;
    resolvedCtaColor = preset.ctaColor;
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
    lang,
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
  const { subject, lines } = mailCopy('welcome', lang);
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
  const isDeleteVariant = variant !== '7d';
  const { subject, lines } = mailCopy(isDeleteVariant ? 'reactivation30d' : 'reactivation7d', lang);
  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: tf(isDeleteVariant ? 'mail.badge.accountStatus' : 'mail.badge.checkIn', lang),
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

  const { subject, lines } = mailCopy('activation', lang);

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

  const { subject, lines } = mailCopy('solo', lang);

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
  const count = trackedInWindow
    ? tf('mail.forgotten.countTimes', lang, { n: trackedInWindow })
    : tf('mail.forgotten.countRegular', lang);
  const days = daysSinceLast || tf('mail.forgotten.fewDays', lang);
  const { subject, lines } = mailCopy('forgotten', lang, { title: seriesTitle, count, days, link: seriesLink });
  const linkPrefix = tf('mail.forgotten.linkPrefix', lang);
  const linkLabel = `${escape(tf('mail.forgotten.linkLabel', lang))} →`;

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: tf('mail.badge.streak', lang),
    badgeType: 'warning',
    ctaText: `${tf('mail.cta.seriesTrend', lang)} →`,
    ctaUrl: seriesLink,
    ctaColor: 'blue',
    htmlLineTransform: (l) => l.startsWith(linkPrefix)
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
  const title = meetingTitle || tf('mail.comeback.defaultTitle', lang);
  const { subject, lines } = mailCopy('comeback', lang, { title, days: daysSinceLogin, link: historyLink });
  const linkPrefix = tf('mail.history.linkPrefix', lang);
  const linkLabel = `${escape(tf('mail.history.linkLabel', lang))} →`;

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: tf('mail.badge.nextMeeting', lang),
    badgeType: 'info',
    ctaText: `${tf('mail.cta.openDashboard', lang)} →`,
    ctaUrl: historyLink,
    ctaColor: 'blue',
    htmlLineTransform: (l) => l.startsWith(linkPrefix)
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
  const title = meetingTitle || tf('mail.exportGap.defaultTitle', lang);
  const { subject, lines } = mailCopy('exportGap', lang, { title, days: daysSinceLogin, link: historyLink });
  const linkPrefix = tf('mail.history.linkPrefix', lang);
  const linkLabel = `${escape(tf('mail.history.linkLabel', lang))} →`;

  return sendPersonalEmail({
    to, displayName,
    subject,
    lines,
    badge: tf('mail.badge.missingReport', lang),
    badgeType: 'warning',
    ctaText: `${tf('mail.cta.dashboardExport', lang)} →`,
    ctaUrl: historyLink,
    ctaColor: 'green',
    htmlLineTransform: (l) => l.startsWith(linkPrefix)
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
  const variant = minutesUntil <= 1 ? 'now' : 'soon';
  const vars = { title: meetingTitle, minutes: minutesUntil };

  return sendPersonalEmail({
    to, displayName,
    subject: tf(`mail.upcoming.${variant}.subject`, lang, vars),
    lines: tf(`mail.upcoming.${variant}.body`, lang, vars).split('\n'),
    badge: tf(`mail.upcoming.${variant}.badge`, lang),
    badgeType: 'info',
    ctaText: `${tf('mail.cta.joinMeet', lang)} →`,
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
  const O = (key, vars) => tf(`mail.orgDigest.${key}`, lang, vars);
  const subject = weeklyMeetings > 0 ? O('subject', { domain, n: weeklyMeetings }) : O('subjectQuiet', { domain });
  const badgeText = O('badge');
  const title = O('title', { domain });
  const greeting = escape(tf('mail.greeting', lang));
  const introPlain = O('intro', { domain });
  const introHtml = escape(O('intro', { domain: '\u0000' })).replace('\u0000', `<strong style="color:#e6edf3;">${escape(domain)}</strong>`);
  const lblMeetingsWeek = O('lblMeetingsWeek');
  const lblTeachers = O('lblTeachers');
  const lblMeetingsAllTime = O('lblMeetingsAllTime');
  const lblPeople = O('lblPeople');
  const ctaText = `${O('cta')} →`;
  const footerNotice = O('footer', { domain });

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
    lang,
  });
  const text = [
    greeting,
    '',
    introPlain,
    `  ${lblMeetingsWeek}: ${weeklyMeetings || 0}`,
    `  ${lblTeachers}:  ${t.users || 0}`,
    `  ${lblMeetingsAllTime}:  ${t.meetings || 0}`,
    `  ${lblPeople}:     ${t.people || 0}`,
    '',
    `${O('cta')}: https://attendancetracker.dev/team.html`,
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
async function sendUpgradeLinkEmail({ to, displayName, educatorUrl, lifetimeUrl, monthlyUrl, educatorPrice, lifetimePrice, monthlyPrice, expArm, flag, isPpp, language, country, domain }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!to) throw new Error('to is required');

  const lang = resolveLanguage({ language, country, domain: domain || (to && to.includes('@') ? to.split('@')[1] : null), email: to });

  const cleanEduPrice = educatorPrice ? String(educatorPrice).replace(/\/(yr|ano|año|year|mês|mes|mo|month|বছর)$/i, '').trim() : '';
  const displayEduPrice = cleanEduPrice || educatorPrice || '$4.99';
  const displayLifetimePrice = lifetimePrice || '$9.99';
  const cleanMonthlyPrice = monthlyPrice ? String(monthlyPrice).replace(/\/(yr|ano|año|year|mês|mes|mo|month|মাস)$/i, '').trim() : '';
  const displayMonthlyPrice = cleanMonthlyPrice || '$3.99';

  const U = (key, vars) => tf(`mail.upgrade.${key}`, lang, vars);
  const firstName = displayName ? displayName.split(' ')[0] : '';
  const greeting = firstName ? tf('mail.greetingName', lang, { name: firstName }) : tf('mail.greetingThere', lang);
  const pppNote = expArm ? '' : ` ${U(isPpp ? 'noteRegional' : 'noteDiscount', { flag: flag || '' })}`;
  let subject = U('subject');
  let bodyIntro = U('bodyIntro');
  let bestValueTag = U('bestValue');
  // Titles/buttons are rendered as pre-escaped HTML below.
  let lifetimeTitle = escape(U('lifetimeTitle', { lifetime: displayLifetimePrice }) + pppNote);
  let lifetimeDesc = U('lifetimeDesc');
  let lifetimeBtn = `${escape(U('lifetimeBtn', { lifetime: displayLifetimePrice }))} →`;
  const educatorTitle = escape(U('educatorTitle', { educator: displayEduPrice }) + pppNote);
  const educatorDesc = U('educatorDesc');
  const educatorBtn = `${escape(U('educatorBtn', { educator: displayEduPrice }))} →`;
  const monthlyTitle = escape(U('monthlyTitle', { monthly: displayMonthlyPrice }));
  const monthlyDesc = U('monthlyDesc');
  const monthlyBtn = `${escape(U('monthlyBtn', { monthly: displayMonthlyPrice }))} →`;
  const dashboardNote = U('dashboardNote');
  const dashboardLinkText = U('dashboardLink');
  const thankYouNote = U('thanks');
  const badgeText = U('badge');
  const badgeSubtitle = U('badgeSubtitle');

  const isIndia = (country || '').toUpperCase() === 'IN';
  if (isIndia) {
    subject = U('indiaSubject', { lifetime: displayLifetimePrice });
    bodyIntro = U('bodyIntroIndia');
    bestValueTag = U('indiaBestValue');
    lifetimeTitle = escape(U('indiaLifetimeTitle', { lifetime: displayLifetimePrice }));
    lifetimeDesc = U('indiaLifetimeDesc');
    lifetimeBtn = `${escape(U('indiaLifetimeBtn', { lifetime: displayLifetimePrice }))} →`;
  }
  const upiBadgeHtml = isIndia ? `<p style="margin:8px 0 0;font-size:11.5px;color:#7ee787;text-align:center;line-height:1.4;">${escape(U('upiBadge'))}</p>` : '';

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
      ${upiBadgeHtml}
    </div>

    ${educatorUrl ? `
    <!-- Plan 2: Annual Educator Pass -->
    <div class="plan-card" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin-bottom:14px;box-sizing:border-box;">
      <div style="font-weight:700;font-size:14px;color:#58a6ff;margin-bottom:6px;line-height:1.4;word-break:break-word;">${educatorTitle}</div>
      <p style="margin:0 0 12px;color:#8b949e;font-size:12.5px;line-height:1.45;">${escape(educatorDesc)}</p>
      <a href="${escape(educatorUrl)}" class="touch-btn-block" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#21262d;border:1px solid #388bfd;color:#79c0ff;text-decoration:none;font-weight:600;padding:9px 15px;border-radius:6px;font-size:12.5px;line-height:1.35;">${educatorBtn}</a>
      ${upiBadgeHtml}
    </div>
    ` : ''}

    ${monthlyUrl ? `
    <!-- Plan 3: Monthly Recurring Pass -->
    <div class="plan-card" style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin-bottom:16px;box-sizing:border-box;">
      <div style="font-weight:700;font-size:14px;color:#d2a8ff;margin-bottom:6px;line-height:1.4;word-break:break-word;">${monthlyTitle}</div>
      <p style="margin:0 0 12px;color:#8b949e;font-size:12.5px;line-height:1.45;">${escape(monthlyDesc)}</p>
      <a href="${escape(monthlyUrl)}" class="touch-btn-block" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#21262d;border:1px solid rgba(163,113,247,0.6);color:#d2a8ff;text-decoration:none;font-weight:600;padding:9px 15px;border-radius:6px;font-size:12.5px;line-height:1.35;">${monthlyBtn}</a>
    </div>
    ` : ''}

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
    lang,
  });

  const text = [
    greeting,
    '',
    bodyIntro,
    '',
    `* ${lifetimeTitle.replace(/&amp;/g, '&')}`,
    `  ${lifetimeUrl}`,
    ...(educatorUrl ? [
      '',
      `* ${educatorTitle.replace(/&amp;/g, '&')}`,
      `  ${educatorUrl}`,
    ] : []),
    ...(monthlyUrl ? [
      '',
      `* ${monthlyTitle.replace(/&amp;/g, '&')}`,
      `  ${monthlyUrl}`,
    ] : []),
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

  const C = (key, vars) => tf(`mail.cancelled.${key}`, lang, vars);
  // Accepts a date or an already-formatted string; shown in the recipient's language.
  const endDate = currentPeriodEnd && !Number.isNaN(new Date(currentPeriodEnd).getTime())
    ? fmtLongDate(currentPeriodEnd, lang)
    : currentPeriodEnd;
  const firstName = displayName ? displayName.split(' ')[0] : '';
  const greeting = firstName ? C('greeting', { name: firstName }) : C('greetingAnon');
  const subject = C('subject');
  const badgeText = C('badge');
  const title = C('title');
  const reassurance1 = C('reassurance1');
  const reassurance2 = endDate ? C('reassurance2Date', { date: endDate }) : C('reassurance2');
  const dataReassurance = C('data');
  const resumeNote = C('resume');
  const ctaText = `${C('cta')} →`;

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
    lang,
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
    `${tf('mail.review.dashboard', lang)} https://attendancetracker.dev/history.html`,
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
  const dateStr = expiresAt ? fmtLongDate(expiresAt, lang) : null;
  const R = (key, vars) => tf(`mail.review.${key}`, lang, vars);

  const greeting = name ? R('greeting', { name }) : R('greetingAnon');
  const subject = R('subject');
  const badgeText = R('badge');
  const title = R('title');
  const p1 = R('p1');
  const cardTitle = R('cardTitle');
  const cardSubtitle = dateStr ? R('cardSubtitleDate', { email: to, date: dateStr }) : R('cardSubtitle', { email: to });
  const bullets = R('bullets').split('\n');
  const pClosing = R('closing');
  const signoff = R('signoff');
  const ctaText = `${R('cta')} →`;

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
    lang,
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
    `${R('dashboard')} https://attendancetracker.dev/history.html`,
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
const REVIEW_APPROVAL_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function createReviewApprovalToken(reviewId, email, expiresAt = null) {
  const expSec = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : Math.floor((Date.now() + REVIEW_APPROVAL_EXPIRY_MS) / 1000);
  const expHex = expSec.toString(16).padStart(8, '0');
  const sig = crypto
    .createHmac('sha256', CONFIG.deriveSecret(REVIEW_APPROVAL_KEY_LABEL))
    .update(`${String(reviewId)}:${String(email).toLowerCase()}:${expHex}`)
    .digest('hex')
    .slice(0, 24);
  return `${expHex}${sig}`;
}

function verifyReviewApprovalToken(reviewId, email, token) {
  if (!reviewId || !email || !token || typeof token !== 'string') return false;
  if (token.length !== 32) return false;

  const expHex = token.slice(0, 8);
  const expSec = parseInt(expHex, 16);
  if (Number.isFinite(expSec) && expSec > 1600000000 && expSec < 4000000000) {
    const expectedSig = crypto
      .createHmac('sha256', CONFIG.deriveSecret(REVIEW_APPROVAL_KEY_LABEL))
      .update(`${String(reviewId)}:${String(email).toLowerCase()}:${expHex}`)
      .digest('hex')
      .slice(0, 24);
    const a = Buffer.from(token.slice(8));
    const b = Buffer.from(expectedSig);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      if (Math.floor(Date.now() / 1000) > expSec) {
        return false; // Expired
      }
      return true;
    }
  }

  // Backwards compatibility with legacy 32-char tokens without embedded timestamp
  const legacyExpected = crypto
    .createHmac('sha256', CONFIG.deriveSecret(REVIEW_APPROVAL_KEY_LABEL))
    .update(`${String(reviewId)}:${String(email).toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
  const legA = Buffer.from(token);
  const legB = Buffer.from(legacyExpected);
  return legA.length === legB.length && crypto.timingSafeEqual(legA, legB);
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
1. Review & Approve Reward Dispatch via Resend:
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

/**
 * Send an email notification when 3D Secure / SCA payment action is required to authorize an invoice payment.
 */
async function sendInvoiceActionRequiredEmail({
  to,
  hostedInvoiceUrl,
  amountDue,
  currency = 'usd',
  language,
  country,
} = {}) {
  if (!getResend()) return { skipped: 'no resend' };
  if (!to || !to.includes('@')) return { skipped: 'invalid email' };
  if (!hostedInvoiceUrl) return { skipped: 'no invoice url' };

  const lang = resolveLanguage({ language, country, email: to });
  const I = (key, vars) => tf(`mail.invoice.${key}`, lang, vars);
  // The charge's own currency, formatted for the recipient ("₹499.00", "19,99 €").
  const formattedAmount = (amountDue != null && amountDue > 0)
    ? fmtMoney(amountDue, currency, lang)
    : null;

  const subject = formattedAmount ? I('subjectAmount', { amount: formattedAmount }) : I('subject');
  const strongAmount = formattedAmount ? `<strong>${escape(formattedAmount)}</strong>` : '';
  const bodyHtml = formattedAmount
    ? escape(I('bodyAmount', { amount: '\u0000' })).replace('\u0000', strongAmount)
    : escape(I('body'));

  const contentHtml = `
    <p style="margin:0 0 16px;color:#e6edf3;font-size:14px;line-height:1.6;">
      ${bodyHtml}
    </p>
    <p style="margin:0 0 20px;color:#e6edf3;font-size:14px;line-height:1.6;">
      ${escape(I('deadline'))}
    </p>
  `;

  const html = buildDesignSystemEmail({
    badge: I('badge'),
    badgeType: 'warning',
    title: I('title'),
    subtitle: I('subtitle'),
    contentHtml,
    ctaText: `${I('cta')} →`,
    ctaUrl: hostedInvoiceUrl,
    ctaColor: 'blue',
    lang,
  });

  const text = [
    I('subject'),
    '',
    formattedAmount ? I('bodyAmount', { amount: formattedAmount }) : I('body'),
    I('textLink'),
    hostedInvoiceUrl,
    '',
    I('textDeadline'),
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Billing'),
    to,
    subject,
    text,
    html,
    tags: [{ name: 'type', value: 'payment_action_required' }, { name: 'lang', value: lang }],
  }, 'payment action required notification', { to, lang });
}

/**
 * Send a renewal / trial-expiry reminder email (T-14, T-3, or T+1) with realized
 * value stats and a one-click JIT checkout link.
 */
async function sendPassExpiryReminderEmail({
  to,
  displayName,
  reminderType,
  planType = 'educator',
  expiresAt,
  daysUntilExpiry,
  stats = {},
  checkoutUrl,
  domain,
  country,
  language,
} = {}) {
  if (!getResend()) return { skipped: 'no resend' };
  if (!to || !to.includes('@')) return { skipped: 'invalid email' };

  const lang = resolveLanguage({ language, email: to, domain, country });
  const E = (key, vars) => tf(`mail.expiry.${key}`, lang, vars);
  // Fill a translated sentence for HTML: escape the copy, then drop in
  // pre-built markup for the {placeholders}.
  const htmlFill = (key, parts) => {
    const marks = Object.fromEntries(Object.keys(parts).map((k, i) => [k, `\u0000${i}\u0000`]));
    let out = escape(E(key, marks));
    Object.keys(parts).forEach((k, i) => { out = out.split(`\u0000${i}\u0000`).join(parts[k]); });
    return out;
  };
  const firstName = displayName ? String(displayName).trim().split(/\s+/)[0] : '';
  const greeting = firstName ? tf('mail.greetingName', lang, { name: firstName }) : tf('mail.greetingThere', lang);
  const isGrant = planType === 'review_reward' || planType === 'referral_reward' || String(reminderType || '').startsWith('grant_');
  const isTrial = planType === 'auto_export_trial' || String(reminderType || '').startsWith('trial_');
  const isExpired = reminderType?.endsWith('t_plus_1') || (typeof daysUntilExpiry === 'number' && daysUntilExpiry <= 0);
  const daysLeft = Math.max(1, Math.ceil(Number(daysUntilExpiry) || 3));
  const when = fmtRelativeDays(daysLeft, lang); // "in 3 days" / "tomorrow"
  const dateNote = expiresAt ? ` (${fmtDate(expiresAt, lang) || String(expiresAt).slice(0, 10)})` : '';

  const passLabel = E(isGrant ? 'passGrant' : (isTrial ? 'passTrial' : (planType === 'educator' ? 'passEducator' : 'passPro')));

  const subject = isExpired
    ? E('subjectEnded', { pass: passLabel })
    : E('subjectEnding', { pass: passLabel, when });

  const exportsCount = Number(stats?.exportsCount) || 0;
  const certificatesCount = Number(stats?.certificatesCount) || 0;
  const largeClassesCount = Number(stats?.largeClassesCount) || 0;
  // "Label: N" sidesteps per-language plural rules.
  const stats3 = [['statExports', exportsCount], ['statLarge', largeClassesCount], ['statCerts', certificatesCount]].filter(([, n]) => n > 0);
  const valueBullets = stats3.map(([key, n]) => `${escape(E(key))}: <strong>${n}</strong>`);

  const targetUrl = checkoutUrl || `${CONFIG.publicSiteUrl}/pricing.html?utm_source=expiry_reminder&utm_campaign=${encodeURIComponent(reminderType || 'expiry')}`;

  const valueBoxHtml = valueBullets.length > 0 ? `
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px 16px;margin:16px 0">
      <div style="font-size:12px;font-weight:700;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">${escape(E('valueTitle'))}</div>
      <ul style="margin:0;padding-left:18px;color:#e6edf3;font-size:13px;line-height:1.6">
        ${valueBullets.map(b => `<li>${b}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const strongPass = `<strong>${escape(passLabel)}</strong>`;
  const contentHtml = `
    <p style="margin:0 0 14px;color:#e6edf3;font-size:14px;line-height:1.6">${escape(greeting)}</p>
    <p style="margin:0 0 14px;color:#e6edf3;font-size:14px;line-height:1.6">
      ${isExpired
        ? htmlFill('bodyEnded', { pass: strongPass })
        : htmlFill('bodyEnding', { pass: strongPass, when: `<strong>${escape(when)}</strong>`, date: escape(dateNote) })}
    </p>
    ${valueBoxHtml}
    <p style="margin:0 0 18px;color:#c9d1d9;font-size:13.5px;line-height:1.6">
      ${escape(E('renewBody'))}
    </p>
  `;

  const foot = unsubscribeFooter(to, lang);
  const html = buildDesignSystemEmail({
    badge: E(isExpired ? 'badgeEnded' : 'badgeReminder'),
    badgeType: isExpired ? 'warning' : 'info',
    title: isExpired ? E('titleEnded') : E('titleEnding', { when }),
    subtitle: E('subtitle'),
    contentHtml,
    ctaText: `${E(isExpired ? 'ctaRenewAccess' : 'ctaRenewNow')} →`,
    ctaUrl: targetUrl,
    ctaColor: 'green',
    footerHtml: foot.html,
    lang,
  });

  const textValueLines = stats3.map(([key, n]) => `- ${E(key)}: ${n}`);

  const text = [
    greeting,
    '',
    isExpired
      ? E('textEnded', { pass: passLabel })
      : E('bodyEnding', { pass: passLabel, when, date: dateNote }),
    ...(textValueLines.length ? ['', E('textValueTitle'), ...textValueLines] : []),
    '',
    E('textRenew'),
    targetUrl,
    '',
    foot.text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to,
    subject,
    text,
    html,
    tags: [
      { name: 'type', value: String(reminderType || 'expiry_reminder').replace(/[^a-zA-Z0-9_-]/g, '_') },
      { name: 'lang', value: lang },
    ],
    headers: unsubscribeHeaders(to),
  }, 'pass expiry reminder email', { to, reminderType, lang });
}

async function sendBillingSpikeAlertEmail({
  to,
  telemetry,
  evaluation,
  projectId,
} = {}) {
  const recipients = Array.isArray(to)
    ? to.filter(Boolean)
    : [to || CONFIG.superAdminEmail, 'derekgallardo01@gmail.com'].filter(Boolean);
  const uniqueRecipients = [...new Set(recipients.map(r => String(r).trim()).filter(r => r.includes('@')))];
  if (!getResend()) return { skipped: 'no resend' };
  if (uniqueRecipients.length === 0) return { skipped: 'no recipients' };

  const currentHourReads = Number(telemetry?.currentHour?.reads) || 0;
  const currentHourWrites = Number(telemetry?.currentHour?.writes) || 0;
  const last24hReads = Number(telemetry?.last24h?.reads) || 0;
  const last24hWrites = Number(telemetry?.last24h?.writes) || 0;
  const last24hCost = Number(telemetry?.last24h?.cost?.totalCostUsd) || 0;
  const mtdCost = Number(telemetry?.monthToDate?.cost?.totalCostUsd) || 0;
  const projectedMonth = Number(telemetry?.projections?.monthTotalFrom24hRateUsd) || 0;
  const reasons = Array.isArray(evaluation?.reasons) && evaluation.reasons.length > 0
    ? evaluation.reasons
    : ['Firestore read/write threshold exceeded'];

  const subject = `🚨 [BILLING ALERT] Firestore Usage Spike — $${last24hCost.toFixed(2)}/24h (${currentHourReads.toLocaleString()} reads/hr)`;

  const contentHtml = `
    <div style="background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.4);border-radius:8px;padding:14px 16px;margin:0 0 16px">
      <div style="font-size:12px;font-weight:700;color:#f85149;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Triggered Thresholds</div>
      <ul style="margin:0;padding-left:18px;color:#e6edf3;font-size:13px;line-height:1.6">
        ${reasons.map(r => `<li>${escape(r)}</li>`).join('')}
      </ul>
    </div>
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin:0 0 16px">
      <tbody>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px">Trailing 1h Reads / Writes</td>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:700;text-align:right">${currentHourReads.toLocaleString()} reads · ${currentHourWrites.toLocaleString()} writes</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px">Last 24h Reads / Writes</td>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:700;text-align:right">${last24hReads.toLocaleString()} reads · ${last24hWrites.toLocaleString()} writes</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px">Estimated 24h Firestore Cost</td>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#f85149;font-size:14px;font-weight:700;text-align:right">$${last24hCost.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#8b949e;font-size:12px">Month-to-Date Firestore Cost</td>
          <td style="padding:10px 12px;border-bottom:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:700;text-align:right">$${mtdCost.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;color:#8b949e;font-size:12px">Projected Full-Month Cost (at 24h rate)</td>
          <td style="padding:10px 12px;color:#e3b341;font-size:13px;font-weight:700;text-align:right">$${projectedMonth.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>
    <p style="margin:0;color:#8b949e;font-size:12px;line-height:1.5">
      Project: <code style="color:#c9d1d9">${escape(projectId || telemetry?.projectId || 'attendance-tracker-490319')}</code> · Checked at ${escape(telemetry?.generatedAt || new Date().toISOString())}
    </p>
  `;

  const html = buildDesignSystemEmail({
    badge: 'Billing & Usage Alert',
    badgeType: 'danger',
    title: 'Firestore Usage Spike Detected',
    subtitle: 'Automated Cloud Monitoring & Billing Watchdog',
    contentHtml,
    ctaText: 'Open Billing & Usage Monitor →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'green',
  });

  const text = [
    '🚨 [BILLING ALERT] Firestore Usage Spike Detected',
    '',
    'Triggered thresholds:',
    ...reasons.map(r => `- ${r}`),
    '',
    `Trailing 1h: ${currentHourReads.toLocaleString()} reads / ${currentHourWrites.toLocaleString()} writes`,
    `Last 24h:    ${last24hReads.toLocaleString()} reads / ${last24hWrites.toLocaleString()} writes`,
    `Est 24h Cost: $${last24hCost.toFixed(2)}`,
    `MTD Cost:     $${mtdCost.toFixed(2)}`,
    `Projected Month Cost (at 24h rate): $${projectedMonth.toFixed(2)}`,
    '',
    'Admin Dashboard: https://attendancetracker.dev/admin.html',
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Ops'),
    to: uniqueRecipients,
    subject,
    text,
    html,
    tags: [{ name: 'type', value: 'billing_spike_alert' }],
  }, 'billing spike alert email', { to: uniqueRecipients, last24hCost, currentHourReads });
}

async function sendDailySummaryEmail({
  to,
  pulse,
  billing,
} = {}) {
  const recipients = Array.isArray(to)
    ? to.filter(Boolean)
    : [to || CONFIG.superAdminEmail].filter(Boolean);
  const uniqueRecipients = [...new Set(recipients.map(r => String(r).trim()).filter(r => r.includes('@')))];
  if (!getResend()) return { skipped: 'no resend' };
  if (uniqueRecipients.length === 0) return { skipped: 'no recipients' };

  const signups24h = Number(pulse?.signups24h ?? pulse?.last24h?.signups) || 0;
  const tracks24h = Number(pulse?.tracks24h ?? pulse?.last24h?.tracks ?? pulse?.checkins24h) || 0;
  const exports24h = Number(pulse?.exports24h ?? pulse?.last24h?.exports) || 0;
  const activeUsers24h = Number(pulse?.active24h ?? pulse?.last24h?.activeUsers) || 0;

  const reads1h = Number(billing?.currentHour?.reads) || 0;
  const writes1h = Number(billing?.currentHour?.writes) || 0;
  const reads24h = Number(billing?.last24h?.reads) || 0;
  const writes24h = Number(billing?.last24h?.writes) || 0;
  const deletes24h = Number(billing?.last24h?.deletes) || 0;
  const cost24h = Number(billing?.last24h?.cost?.totalCostUsd ?? billing?.last24h?.totalCostUsd) || 0;
  const mtdObj = billing?.monthToDate || billing?.mtd || {};
  const readsMtd = Number(mtdObj.reads) || 0;
  const writesMtd = Number(mtdObj.writes) || 0;
  const costMtd = Number(mtdObj.cost?.totalCostUsd ?? mtdObj.totalCostUsd) || 0;
  const projectedMonth = Number(billing?.projections?.monthTotalFrom24hRateUsd ?? mtdObj.projectedFullMonthTotalCostUsd) || 0;
  const statusLabel = billing?.currentHour?.status?.label || 'Healthy';

  const subject = `📊 Daily Ops & Billing Digest — $${cost24h.toFixed(2)}/24h · ${signups24h} signups · ${tracks24h} meetings`;

  const contentHtml = `
    <p style="margin:0 0 14px;color:#e6edf3;font-size:14px;line-height:1.6">
      Here is your 24-hour Attendance Tracker activity &amp; Cloud Billing summary:
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#0d1117;border:1px solid #30363d;border-radius:8px;overflow:hidden;margin:0 0 16px">
      <tbody>
        <tr style="background:#161b22">
          <td colspan="2" style="padding:8px 12px;font-size:11px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:.05em">Product Activity (Last 24h)</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">New Signups / Active Educators</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:600;text-align:right">${signups24h} signups · ${activeUsers24h} active</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Meetings Tracked / Sheet Exports</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:600;text-align:right">${tracks24h} meetings · ${exports24h} exports</td>
        </tr>
        <tr style="background:#161b22">
          <td colspan="2" style="padding:8px 12px;border-top:1px solid #30363d;font-size:11px;font-weight:700;color:#58a6ff;text-transform:uppercase;letter-spacing:.05em">Cloud Billing &amp; Firestore Usage</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Current 1h Rate</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:600;text-align:right">${reads1h.toLocaleString()} reads · ${writes1h.toLocaleString()} writes/hr (${escape(statusLabel)})</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Last 24h Reads / Writes / Deletes</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:600;text-align:right">${reads24h.toLocaleString()} reads · ${writes24h.toLocaleString()} writes · ${deletes24h.toLocaleString()} deletes</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Estimated 24h Firestore Cost</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#4ade80;font-size:13px;font-weight:700;text-align:right">$${cost24h.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Month-to-Date Reads / Writes</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:600;text-align:right">${readsMtd.toLocaleString()} reads · ${writesMtd.toLocaleString()} writes</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#8b949e;font-size:12px">Month-to-Date Cost / Projected Full Month</td>
          <td style="padding:8px 12px;border-top:1px solid #21262d;color:#e6edf3;font-size:13px;font-weight:700;text-align:right">$${costMtd.toFixed(2)} MTD · $${projectedMonth.toFixed(2)} proj</td>
        </tr>
      </tbody>
    </table>
  `;

  const html = buildDesignSystemEmail({
    badge: 'Daily Ops & Billing',
    badgeType: statusLabel === 'Critical' ? 'danger' : (statusLabel === 'Warning' ? 'warning' : 'success'),
    title: 'Daily Activity & Cloud Cost Digest',
    subtitle: `${new Date().toLocaleDateString('en-US', { dateStyle: 'medium' })} · Status: ${statusLabel}`,
    contentHtml,
    ctaText: 'Open Admin Dashboard →',
    ctaUrl: 'https://attendancetracker.dev/admin.html',
    ctaColor: 'green',
  });

  const text = [
    'Daily Ops & Billing Digest',
    '',
    `Signups (24h): ${signups24h}`,
    `Active Educators (24h): ${activeUsers24h}`,
    `Meetings Tracked (24h): ${tracks24h}`,
    `Exports (24h): ${exports24h}`,
    '',
    `Current 1h Rate: ${reads1h.toLocaleString()} reads · ${writes1h.toLocaleString()} writes/hr (${statusLabel})`,
    `Last 24h Reads/Writes/Deletes: ${reads24h.toLocaleString()} reads / ${writes24h.toLocaleString()} writes / ${deletes24h.toLocaleString()} deletes`,
    `Estimated 24h Cost: $${cost24h.toFixed(2)}`,
    `Month-to-Date Reads/Writes: ${readsMtd.toLocaleString()} reads / ${writesMtd.toLocaleString()} writes`,
    `Month-to-Date Cost: $${costMtd.toFixed(2)} (Projected Month: $${projectedMonth.toFixed(2)})`,
    '',
    'Admin: https://attendancetracker.dev/admin.html',
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker Ops'),
    to: uniqueRecipients,
    subject,
    text,
    html,
    tags: [{ name: 'type', value: 'daily_ops_summary' }],
  }, 'daily ops summary email', { to: uniqueRecipients, cost24h, signups24h });
}

module.exports = {
  sendSignupWebhook, sendSourceReportedNotification, sendUpgradeNotification, sendAdminSubscriptionCancelledNotification, sendAdminEmailUnsubscribedNotification, sendAdminMilestoneEmail, maybeSendSignupNotification, sendWelcomeEmail, sendReferralNotification, maybeSendReferralNotification, flushDeferredNotifications, sendAdminEmail, sendErrorAlertEmail, sendErrorSpikeAlertEmail, sendBillingSpikeAlertEmail, sendDailySummaryEmail, sendWeeklySelfReport, sendExportNotification, sendOrgWeeklyDigest,
  sendSeriesAlertEmail, sendFeedbackEmail, sendReactivationEmail, sendActivationNudgeEmail, sendSoloNudgeEmail, sendForgottenMeetingEmail, sendComebackEmail, sendExportGapEmail, sendUpcomingMeetingEmail, sendUpgradeLinkEmail, sendSubscriptionCancelledEmail, sendInvoiceActionRequiredEmail, sendReviewRewardEmail, buildReviewRewardEmailContent, sendReviewRewardDraftAlert, createReviewApprovalToken, verifyReviewApprovalToken, reviewApprovalUrl, sendPassExpiryReminderEmail,
  sendSlackDigest, sendSlackTestPing, buildSlackDigestBlocks, buildSlackFallbackText, maskSlackWebhook,
  sendChatDigest, sendChatTestPing, buildChatDigestCard, maskGoogleChatWebhook,
  sendDiscordDigest, sendDiscordTestPing, buildDiscordDigestEmbed, maskDiscordWebhook,
  unsubscribeUrl, unsubscribeToken, verifyUnsubscribeToken, unsubscribeFooter, buildDesignSystemEmail, resolveLanguage,
};
