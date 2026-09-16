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
function unsubscribeFooter(email) {
  const url = unsubscribeUrl(email);
  return {
    text: `\n\n—\nDon't want these emails? Unsubscribe: ${url}`,
    html: `<p style="margin:24px 0 0;color:#8a8f98;font-size:12px;font-family:sans-serif">`
      + `Don't want these emails? <a href="${escape(url)}" style="color:#8a8f98">Unsubscribe</a>.</p>`,
  };
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

  const html = `
    <p>A new user just signed up for Attendance Tracker.</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${escape(email)}">${escape(email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Domain</td><td>${escape(domain)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Source (self-reported)</td><td>${escape(reportedText)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Source (detected)</td><td>${escape(detectedText)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">IP / Location</td><td>${ipLink ? `<a href="${escape(ipLink)}">${escape(ipLine)}</a>` : escape(ipLine)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Total users now</td><td>${totalUsers ?? '?'}</td></tr>
    </table>
    <p style="margin-top:16px">
      <a href="https://attendancetracker.dev/admin.html">Open admin dashboard</a>
    </p>
  `;

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
      await sendWelcomeEmail({ to: payload.email, displayName: payload.displayName });
    }
  } catch (err) {
    log.warn('welcome email failed', { to: payload.email, error: err.message });
  }

  return ownerResult;
}

// Referral win: tell the inviter that someone they invited just joined and
// that they've earned a free month of Pro. Uses sendPersonalEmail so it carries
// the reply-to + CAN-SPAM unsubscribe footer like other lifecycle mail.
async function sendReferralNotification({ to, inviterName, newUserName, rewardMonths = 1, totalReferrals = 1, promoCode = null, rewarded = true }) {
  const monthWord = rewardMonths === 1 ? 'a free month' : `${rewardMonths} free months`;
  // Three states: rewarded + code (apply at checkout), rewarded but no code
  // (billing not yet configured — we'll apply it), or capped (attribution only,
  // no money-bearing reward — see REFERRAL_REWARD_CAP).
  const rewardLine = !rewarded
    ? `Thanks for spreading the word — that's a big help.`
    : promoCode
      ? `As a thank-you, here's ${monthWord} of Pro on us — apply code ${promoCode} at checkout.`
      : `As a thank-you, you've earned ${monthWord} of Pro — it'll be applied to your account (or your next upgrade).`;
  const subject = rewarded
    ? `🎉 ${newUserName} joined Attendance Tracker — you earned a free month`
    : `🎉 ${newUserName} joined Attendance Tracker via your invite`;
  return sendPersonalEmail({
    to, displayName: inviterName,
    subject,
    lines: [
      `Good news — ${newUserName} just signed up for Attendance Tracker using your invite.`,
      '',
      rewardLine,
      totalReferrals > 1 ? `That's ${totalReferrals} people you've brought in so far. Seriously, thank you.` : `Thanks again.`,
      '',
      '— Derek',
      'attendancetracker.dev',
    ],
    tags: [{ name: 'type', value: 'referral' }],
    logLabel: 'referral notification', logMeta: { totalReferrals, hasPromo: !!promoCode, rewarded },
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

  const html = `
    <div style="font-family:sans-serif;max-width:600px;color:#111;font-size:14px;line-height:1.5">
      <h2 style="color:#cf222e;margin-top:0">⚠️ User Error Alert</h2>
      <p>An error was encountered or reported on Attendance Tracker:</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        <tr><td style="padding:4px 12px 4px 0;color:#666;font-weight:600">User Email</td><td><a href="mailto:${escape(email)}">${escape(email)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;font-weight:600">Domain</td><td>${escape(domain)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;font-weight:600">Context</td><td>${escape(context)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;font-weight:600">Error Message</td><td style="color:#cf222e;font-family:monospace">${escape(error)}</td></tr>
      </table>
      ${meta ? `<h3 style="margin-top:16px">Details</h3><pre style="background:#f6f8fa;padding:12px;border-radius:6px;font-size:12px">${escape(JSON.stringify(meta, null, 2))}</pre>` : ''}
      <p style="margin-top:20px"><a href="https://attendancetracker.dev/admin.html" style="background:#1f6feb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600">Open Admin Dashboard</a></p>
    </div>
  `;

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
          .touch-btn { width: 100% !important; text-align: center !important; min-height: 44px !important; line-height: 44px !important; display: block !important; box-sizing: border-box !important; }
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
async function sendExportNotification({ to, displayName, sheetUrl, meetingTitle, totalAttended, totalInvited, exportedAt, participants, overflow, conferenceId, recurringEventId }) {
  if (!getResend()) return;
  const title = meetingTitle || 'Google Meet';
  const summary = totalInvited
    ? `${totalAttended} of ${totalInvited} attended`
    : `${totalAttended} attended`;
  const subject = `Attendance: ${title} — ${summary}`;
  const dateStr = exportedAt ? new Date(exportedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const greeting = displayName ? `Hi ${escape(displayName.split(' ')[0])},` : 'Hi,';

  // Inline attendance table. Color-codes status: green=present, amber=left
  // early, red=absent. Keeps the email scannable in 2 seconds.
  const statusColor = (s) => {
    if (s === 'Present') return '#16a34a';
    if (s === 'Left') return '#d97706';
    if (s === 'Excused') return '#6b7280'; // muted gray — excused isn't a problem
    return '#dc2626';
  };
  const fmtDur = (m) => !m ? '—' : hm(m);
  const tableRows = (participants || []).map(p => {
    const lateBadge = p.lateMin > 0
      ? `<span style="display:inline-block;white-space:nowrap;background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;margin-left:4px;vertical-align:middle;line-height:1.3">+${p.lateMin}m late</span>`
      : '';
    return `
    <tr>
      <td style="padding:8px 10px;border-top:1px solid #e2e8f0;vertical-align:middle">
        <div style="font-size:13px;line-height:1.35;word-break:break-word">
          <span style="font-weight:600;color:#0f172a">${escape(p.displayName || p.email || '—')}</span> ${lateBadge}
        </div>
        ${p.email && p.displayName ? `<div style="color:#64748b;font-size:11px;line-height:1.3;margin-top:2px;word-break:break-all">${escape(p.email)}</div>` : ''}
      </td>
      <td style="padding:8px 8px;border-top:1px solid #e2e8f0;vertical-align:middle;color:${statusColor(p.status)};font-weight:600;font-size:12px;white-space:nowrap">${escape(p.status)}</td>
      <td style="padding:8px 10px;border-top:1px solid #e2e8f0;vertical-align:middle;color:#64748b;text-align:right;font-size:12px;white-space:nowrap">${escape(fmtDur(p.durationMin))}</td>
    </tr>
  `;
  }).join('');
  const overflowRow = overflow > 0
    ? `<tr><td colspan="3" style="padding:8px 10px;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;font-style:italic;background:#f8fafc">…and ${overflow} more in the sheet</td></tr>`
    : '';
  const tableHtml = participants?.length ? `
    <table role="presentation" style="border-collapse:collapse;width:100%;margin:16px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;table-layout:fixed">
      <thead>
        <tr style="background:#f8fafc">
          <th style="text-align:left;padding:8px 10px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;width:58%">Person</th>
          <th style="text-align:left;padding:8px 8px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;width:22%;white-space:nowrap">Status</th>
          <th style="text-align:right;padding:8px 10px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;width:20%;white-space:nowrap">Time</th>
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

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e293b;font-size:14px;line-height:1.5;padding:16px 12px">
      <p style="margin:0 0 6px;font-size:15px;color:#1e293b">${greeting}</p>
      <p style="margin:0 0 14px;font-size:14px;color:#475569">Your meeting just ended — attendance has been auto-exported.</p>
      <table role="presentation" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px 0">
        <tr>
          <td style="padding:12px 14px">
            <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:4px;word-break:break-word">${escape(title)}</div>
            <div style="font-size:13px;color:#64748b;line-height:1.4">
              <span style="font-weight:600;color:#0f172a">${escape(summary)}</span>${dateStr ? `<span style="color:#94a3b8;margin:0 6px">&bull;</span><span>${escape(dateStr)}</span>` : ''}
            </div>
          </td>
        </tr>
      </table>
      ${tableHtml}
      <div style="margin:20px 0 16px 0">
        <a href="${escape(sheetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-right:8px;margin-bottom:8px">Open sheet</a>
        <a href="${escape(meetingLink)}" style="display:inline-block;background:#ffffff;color:#2563eb;border:1px solid #cbd5e1;padding:9px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-bottom:8px">View on web →</a>
      </div>
      ${seriesLink ? `<p style="margin:4px 0 16px;font-size:13px;color:#64748b">This is part of a recurring series — <a href="${escape(seriesLink)}" style="color:#2563eb;font-weight:500;text-decoration:none">see the full trend →</a></p>` : ''}
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:20px 0;text-align:left">
        <div style="font-weight:600;color:#0f172a;font-size:13px;margin-bottom:4px">⭐ Did this save you time today?</div>
        <div style="font-size:12px;color:#64748b;margin-bottom:12px;line-height:1.4">If Attendance Tracker helped your call, could you spare 10 seconds to leave a 5-star review on Google Marketplace? It helps independent creators like me keep building for educators!</div>
        <a href="${escape(reviewUrl)}" style="display:inline-block;background:#f59e0b;color:#111827;font-size:12px;font-weight:700;padding:8px 14px;border-radius:6px;text-decoration:none">Leave a 5-Star Review (takes 10s) →</a>
      </div>
      <p style="color:#64748b;font-size:12px;line-height:1.5;margin-top:24px">
        You're getting this because you tracked this meeting with Attendance Tracker.
        The sheet lives in your Drive folder "Meet Attendance Tracker" — reuse the same
        spreadsheet next time, each meeting gets its own tab.
      </p>
      ${unsubscribeFooter(to).html}
    </div>
  `;

  const textRows = (participants || []).map(p => {
    const label = (p.displayName || p.email || '—') + (p.lateMin > 0 ? ` (+${p.lateMin}m late)` : '');
    return `  ${label.padEnd(28)} ${p.status.padEnd(8)} ${fmtDur(p.durationMin)}`;
  }).join('\n');
  const text = [
    `${displayName ? 'Hi ' + displayName.split(' ')[0] + ',' : 'Hi,'}`,
    ``,
    `Your meeting just ended — attendance has been auto-exported.`,
    ``,
    `Meeting: ${title}`,
    `Attendance: ${summary}`,
    dateStr ? `When: ${dateStr}` : '',
    ``,
    participants?.length ? `${textRows}${overflow > 0 ? `\n  ...and ${overflow} more in the sheet` : ''}` : '',
    ``,
    `Open sheet: ${sheetUrl}`,
    `View on web: ${meetingLink}`,
    seriesLink ? `Series trend: ${seriesLink}` : '',
    ``,
    `Did this save you time today? Leave a quick 5-star review (takes 10s):`,
    reviewUrl,
    unsubscribeFooter(to).text,
  ].filter(Boolean).join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'export_notification' }],
    headers: unsubscribeHeaders(to),
  }, 'export notification', { sheetUrl });
}

// Daily series attendance alert. Batched: one email per user per day,
// listing every triggered rule across all their series. The point is to
// give the user a reason to come back to the product — so the CTA is a
// "View series →" link, not a static report.
async function sendSeriesAlertEmail({ to, displayName, alerts }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!alerts?.length) return { skipped: 'no alerts' };

  const subject = alerts.length === 1
    ? `Attendance alert: ${alerts[0].personName || alerts[0].personEmail || 'Someone'} ${alerts[0].detail}`
    : `${alerts.length} attendance alerts from your recurring meetings`;

  const greeting = displayName ? `Hi ${escape(displayName.split(' ')[0])},` : 'Hi,';
  const leadHtml = alerts.length === 1
    ? `There's an attendance change in one of your recurring meetings:`
    : `There are ${alerts.length} attendance changes across your recurring meetings:`;

  const itemHtml = alerts.map(a => `
    <li style="margin-bottom:12px">
      <strong>${escape(a.personName || a.personEmail || 'Someone')}</strong> ${escape(a.detail)}.
      <div style="color:#666;font-size:12px;margin-top:2px">${a.attended} of ${a.instanceCount} instances attended overall</div>
    </li>
  `).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#111;font-size:14px;line-height:1.5">
      <p>${greeting}</p>
      <p>${leadHtml}</p>
      <ul style="padding-left:18px;margin:14px 0">${itemHtml}</ul>
      <p style="margin-top:20px"><a href="https://attendancetracker.dev/history.html" style="display:inline-block;background:#1f6feb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">View series →</a></p>
      <p style="color:#666;font-size:12px;margin-top:24px">
        You're getting this because you tracked recurring meetings with Attendance Tracker.
        Alerts run once per day if there's something worth flagging — no email if there's nothing new.
      </p>
      ${unsubscribeFooter(to).html}
    </div>
  `;
  const text = [
    displayName ? `Hi ${displayName.split(' ')[0]},` : 'Hi,',
    '',
    alerts.length === 1
      ? "There's an attendance change in one of your recurring meetings:"
      : `There are ${alerts.length} attendance changes across your recurring meetings:`,
    '',
    ...alerts.map(a => `  - ${a.personName || a.personEmail || 'Someone'} ${a.detail}. (${a.attended}/${a.instanceCount})`),
    '',
    'View series: https://attendancetracker.dev/history.html',
    unsubscribeFooter(to).text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'series_alert' }],
    headers: unsubscribeHeaders(to),
  }, 'series alert email', { alertCount: alerts.length });
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
  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#111;font-size:14px;line-height:1.5">
      <p style="white-space:pre-wrap;border-left:3px solid #4ade80;padding:0 0 0 14px;margin:0">${escape(body)}</p>
      <table style="border-collapse:collapse;margin-top:18px;font-size:13px;color:#666">
        <tr><td style="padding:3px 12px 3px 0">From</td><td>${escape(fromName || '')} ${fromEmail ? `&lt;<a href="mailto:${escape(fromEmail)}">${escape(fromEmail)}</a>&gt;` : '(no email)'}</td></tr>
        ${source ? `<tr><td style="padding:3px 12px 3px 0">Source</td><td>${escape(source)}</td></tr>` : ''}
        ${conferenceId ? `<tr><td style="padding:3px 12px 3px 0">Meeting</td><td><code>${escape(conferenceId)}</code></td></tr>` : ''}
        ${userAgent ? `<tr><td style="padding:3px 12px 3px 0">User agent</td><td style="font-size:11px">${escape(userAgent)}</td></tr>` : ''}
      </table>
    </div>
  `;
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
const emailParagraph = (l) =>
  `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.55;color:#111">${escape(l) || '&nbsp;'}</p>`;

async function sendPersonalEmail({ to, displayName, subject, lines, tags, htmlLineTransform, logLabel, logMeta }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const firstName = displayName ? displayName.split(' ')[0] : null;
  const hi = firstName ? `Hey ${firstName},` : 'Hey,';
  const body = [hi, '', ...lines].join('\n');

  const foot = unsubscribeFooter(to);
  const html = body.split('\n')
    .map(l => (htmlLineTransform && htmlLineTransform(l)) || emailParagraph(l))
    .join('') + foot.html;

  return dispatchEmail({
    from: makeFrom('Derek Gallardo'),
    to, subject,
    text: body + foot.text,
    html,
    replyTo: ownerEmail(),
    tags,
    headers: unsubscribeHeaders(to),
  }, `${logLabel} email`, logMeta);
}

async function sendWelcomeEmail({ to, displayName }) {
  const lines = [
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
  return sendPersonalEmail({
    to, displayName,
    subject: 'Welcome to Attendance Tracker for Google Meet',
    lines,
    tags: [{ name: 'type', value: 'welcome' }],
    logLabel: 'welcome', logMeta: {},
  });
}

async function sendReactivationEmail({ to, displayName, daysSinceLogin, variant }) {
  const lines = variant === '7d' ? [
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
  return sendPersonalEmail({
    to, displayName,
    subject: variant === '7d' ? 'Quick check-in on Attendance Tracker' : 'Should I delete your Attendance Tracker account?',
    lines,
    tags: [{ name: 'type', value: 'reactivation' }, { name: 'variant', value: variant }],
    logLabel: 'reactivation', logMeta: { variant, daysSinceLogin },
  });
}

// Activation nudge for people who signed up but never tracked a meeting — a
// short how-to-start, not a win-back.
async function sendActivationNudgeEmail({ to, displayName, daysSinceLogin }) {
  return sendPersonalEmail({
    to, displayName,
    subject: 'Getting started with Attendance Tracker',
    lines: [
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
    ],
    tags: [{ name: 'type', value: 'activation_nudge' }],
    logLabel: 'activation nudge', logMeta: { daysSinceLogin },
  });
}

// For users who tried the tool but only on a solo test — move them from "tested
// it on myself" to "used it in a real meeting".
async function sendSoloNudgeEmail({ to, displayName, daysSinceLogin }) {
  return sendPersonalEmail({
    to, displayName,
    subject: 'You tried Attendance Tracker solo — try it with a real meeting',
    lines: [
      "I noticed you gave Attendance Tracker a spin, but it looks like the meeting was just you. That's the perfect way to kick the tires — but it really earns its keep when other people are in the call.",
      '',
      "Next time you're in a real one — a class, a standup, a client call — open the panel and hit Start. It'll show you exactly who joined, who left, who was late, and drop the whole roll-call into a Google Sheet when the meeting ends.",
      '',
      "If something's getting in the way of using it for real, hit reply and tell me — that feedback is gold.",
      '',
      '— Derek',
      'attendancetracker.dev',
    ],
    tags: [{ name: 'type', value: 'solo_nudge' }],
    logLabel: 'solo nudge', logMeta: { daysSinceLogin },
  });
}

async function sendForgottenMeetingEmail({ to, displayName, seriesTitle, recurringEventId, trackedInWindow, daysSinceLast }) {
  const seriesLink = recurringEventId
    ? `https://attendancetracker.dev/history.html#series=${encodeURIComponent(recurringEventId)}`
    : 'https://attendancetracker.dev/history.html';
  return sendPersonalEmail({
    to, displayName,
    subject: `Forgot to track "${seriesTitle}"?`,
    lines: [
      `You tracked "${seriesTitle}" ${trackedInWindow} times in the past month, but it's been ${daysSinceLast} days since the last one. If you want to keep the streak going, just open the Attendance Tracker side panel next time you're in that meeting — it picks up from where you left off.`,
      '',
      `Your series so far: ${seriesLink}`,
      '',
      '— Derek',
    ],
    // Render the series line as a link instead of a bare URL.
    htmlLineTransform: (l) => l.startsWith('Your series so far:')
      ? `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.55;color:#111">Your series so far: <a href="${escape(seriesLink)}" style="color:#1f6feb">view the trend →</a></p>`
      : null,
    tags: [{ name: 'type', value: 'forgotten_meeting' }],
    logLabel: 'forgotten-meeting', logMeta: { recurringEventId, daysSinceLast },
  });
}

// Meeting-specific win-back for an activated user who tracked a one-off meeting
// and went quiet — the "come back and track your next one" nudge that a
// non-recurring tracker (e.g. a single class) previously never got (only the
// generic reactivation email). Fires once via the comeback_7d dedup slot.
async function sendComebackEmail({ to, displayName, meetingTitle, daysSinceLogin }) {
  const historyLink = 'https://attendancetracker.dev/history.html';
  const title = meetingTitle || 'your last meeting';
  return sendPersonalEmail({
    to, displayName,
    subject: 'Track your next meeting?',
    lines: [
      `It's been about ${daysSinceLogin} days since you tracked "${title}". Next time you're in a meeting, just open the Attendance Tracker side panel — it captures who joined, who left, and how long they stayed, then exports to Sheets in one click.`,
      '',
      'One tip: if it\'s a class or meeting that repeats, put it on a recurring Google Calendar invite — then you get per-person attendance trends across every session, not just a single day.',
      '',
      `Your history: ${historyLink}`,
      '',
      '— Derek',
    ],
    htmlLineTransform: (l) => l.startsWith('Your history:')
      ? `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.55;color:#111">Your history: <a href="${escape(historyLink)}" style="color:#1f6feb">open your dashboard →</a></p>`
      : null,
    tags: [{ name: 'type', value: 'comeback_7d' }],
    logLabel: 'comeback', logMeta: { daysSinceLogin },
  });
}

// Export-gap win-back: the user tracked a real (multi-person) meeting but never
// saved the report — the Google Sheet is the payoff they missed. Point them
// straight at exporting (and auto-export) rather than a generic come-back.
// Fires once via the export_gap dedup slot.
async function sendExportGapEmail({ to, displayName, meetingTitle, daysSinceLogin }) {
  const historyLink = 'https://attendancetracker.dev/history.html';
  const title = meetingTitle || 'your class';
  return sendPersonalEmail({
    to, displayName,
    subject: 'Your attendance report is one click away',
    lines: [
      `You tracked "${title}" about ${daysSinceLogin} days ago, but never saved the report. Next time you're in that meeting, open the Attendance Tracker side panel and hit Export — you'll get a clean Google Sheet with who joined, who left, and how long they stayed. (Turn on auto-export in Settings and it happens automatically when the meeting ends.)`,
      '',
      `Your history: ${historyLink}`,
      '',
      '— Derek',
    ],
    htmlLineTransform: (l) => l.startsWith('Your history:')
      ? `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.55;color:#111">Your history: <a href="${escape(historyLink)}" style="color:#1f6feb">open your dashboard →</a></p>`
      : null,
    tags: [{ name: 'type', value: 'export_gap' }],
    logLabel: 'export-gap', logMeta: { daysSinceLogin },
  });
}

// Pre-meeting reminder for a recurring series the user tracks but has been
// slipping on — fired shortly before the next scheduled instance so it's
// actionable ("open the panel when you join"). Self-limiting: the sweep only
// qualifies LAPSING series, so reliable trackers never get these. Once per
// calendar instance; honors the standard unsubscribe footer.
async function sendUpcomingMeetingEmail({ to, displayName, meetingTitle, minutesUntil }) {
  const when = minutesUntil <= 1 ? 'is starting now' : `starts in about ${minutesUntil} minutes`;
  return sendPersonalEmail({
    to, displayName,
    subject: `Reminder: "${meetingTitle}" ${minutesUntil <= 1 ? 'is starting' : 'starts soon'}`,
    lines: [
      `Your recurring meeting "${meetingTitle}" ${when}. When you join, open the Attendance Tracker side panel and it'll capture who's there — then export the report in one click (or let it auto-export when the meeting ends).`,
      '',
      "You're getting this because you've tracked this meeting before but not in the last few days — just a nudge so it doesn't slip.",
      '',
      '— Derek',
    ],
    tags: [{ name: 'type', value: 'upcoming_reminder' }],
    logLabel: 'upcoming-reminder', logMeta: { minutesUntil },
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
async function sendOrgWeeklyDigest({ to, domain, totals, weeklyMeetings }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  const t = totals || {};
  const subject = weeklyMeetings > 0
    ? `${domain}: ${weeklyMeetings} meetings tracked this week`
    : `${domain}: your weekly attendance digest`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#111;font-size:14px;line-height:1.5">
      <p>Hi,</p>
      <p>Your weekly attendance summary for <strong>${escape(domain)}</strong>:</p>
      <table style="border-collapse:collapse;margin:10px 0;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Meetings this week</td><td><strong>${weeklyMeetings || 0}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Teachers using it</td><td>${t.users || 0}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Meetings all-time</td><td>${t.meetings || 0}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">People tracked</td><td>${t.people || 0}</td></tr>
      </table>
      <p style="margin-top:16px"><a href="https://attendancetracker.dev/team.html" style="display:inline-block;background:#1f6feb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Open the org dashboard →</a></p>
      <p style="color:#666;font-size:12px;margin-top:24px">You're getting this weekly summary because you're the team admin for ${escape(domain)} on Attendance Tracker Pro.</p>
      ${unsubscribeFooter(to).html}
    </div>
  `;
  const text = [
    'Hi,',
    '',
    `Weekly attendance summary for ${domain}:`,
    `  Meetings this week: ${weeklyMeetings || 0}`,
    `  Teachers using it:  ${t.users || 0}`,
    `  Meetings all-time:  ${t.meetings || 0}`,
    `  People tracked:     ${t.people || 0}`,
    '',
    'Org dashboard: https://attendancetracker.dev/team.html',
    unsubscribeFooter(to).text,
  ].join('\n');
  return dispatchEmail({
    from: makeFrom('Attendance Tracker'),
    to, subject, text, html,
    tags: [{ name: 'type', value: 'org_weekly_digest' }],
    headers: unsubscribeHeaders(to),
  }, 'org weekly digest', { domain });
}

// ── Requested Upgrade Link (for teachers finishing class) ─────────────────
async function sendUpgradeLinkEmail({ to, displayName, educatorUrl, lifetimeUrl, educatorPrice, lifetimePrice, flag, isPpp }) {
  if (!getResend()) return { skipped: 'Resend not configured' };
  if (!to) throw new Error('to is required');

  const greeting = displayName ? `Hi ${displayName.split(' ')[0]},` : 'Hi there,';
  const pppNote = isPpp ? ` (50% Regional Subsidy applied ${flag || ''})` : '';
  const subject = 'Your Attendance Tracker upgrade link (finish anytime)';

  const html = `
    <div style="font-family:sans-serif;max-width:560px;color:#111;font-size:14px;line-height:1.6;margin:0 auto;padding:20px">
      <h2 style="color:#1f6feb;margin-top:0">Attendance Tracker for Google Meet</h2>
      <p>${escape(greeting)}</p>
      <p>You requested a link to upgrade Attendance Tracker when you're done teaching. No rush at all — whenever your class wraps up and you're back at your desk, you can unlock unlimited classes and exports below:</p>

      <div style="margin:24px 0;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:20px">
        <h3 style="margin-top:0;font-size:16px;color:#24292f">Choose the plan that fits best:</h3>
        
        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e1e4e8">
          <div style="font-weight:600;font-size:15px;color:#0969da">Educator Pass — ${escape(educatorPrice)}/yr${escape(pppNote)}</div>
          <p style="margin:4px 0 10px;color:#57606a;font-size:13px">Unlimited Google Sheets exports & attendance records for 1 full year.</p>
          <a href="${educatorUrl}" style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;font-weight:600;padding:8px 18px;border-radius:6px;font-size:13px">Unlock Educator Pass (${escape(educatorPrice)}/yr) →</a>
        </div>

        <div>
          <div style="font-weight:600;font-size:15px;color:#0969da">Lifetime Pro — ${escape(lifetimePrice)} one-time${escape(pppNote)}</div>
          <p style="margin:4px 0 10px;color:#57606a;font-size:13px">Pay once, keep unlimited attendance tracking forever. No recurring subscription.</p>
          <a href="${lifetimeUrl}" style="display:inline-block;background:#2ea44f;color:#ffffff;text-decoration:none;font-weight:600;padding:8px 18px;border-radius:6px;font-size:13px">Get Lifetime Pro (${escape(lifetimePrice)}) →</a>
        </div>
      </div>

      <p style="color:#57606a;font-size:13px">Or view your previous attendance history anytime in your <a href="https://attendancetracker.dev/history.html" style="color:#0969da">Web Dashboard</a>.</p>
      <p style="color:#57606a;font-size:13px;margin-top:20px">Thank you for teaching with Attendance Tracker!</p>
      ${unsubscribeFooter(to).html}
    </div>
  `;

  const text = [
    greeting,
    '',
    "You requested a link to upgrade Attendance Tracker when you're done teaching. No rush at all — whenever your class wraps up and you're back at your desk, you can unlock unlimited classes and exports below:",
    '',
    `* Educator Pass: ${educatorPrice}/yr${pppNote}`,
    `  ${educatorUrl}`,
    '',
    `* Lifetime Pro: ${lifetimePrice} one-time${pppNote}`,
    `  ${lifetimeUrl}`,
    '',
    'Or view your attendance history anytime at https://attendancetracker.dev/history.html',
    '',
    'Thank you for teaching with Attendance Tracker!',
    unsubscribeFooter(to).text,
  ].join('\n');

  return dispatchEmail({
    from: makeFrom('Derek from Attendance Tracker'),
    to, subject, text, html,
    replyTo: ownerEmail(),
    tags: [{ name: 'type', value: 'upgrade_link_requested' }],
    headers: unsubscribeHeaders(to),
  }, 'upgrade link email', { to });
}

module.exports = {
  sendSignupWebhook, maybeSendSignupNotification, sendWelcomeEmail, sendReferralNotification, maybeSendReferralNotification, flushDeferredNotifications, sendAdminEmail, sendErrorAlertEmail, sendWeeklySelfReport, sendExportNotification, sendOrgWeeklyDigest,
  sendSeriesAlertEmail, sendFeedbackEmail, sendReactivationEmail, sendActivationNudgeEmail, sendSoloNudgeEmail, sendForgottenMeetingEmail, sendComebackEmail, sendExportGapEmail, sendUpcomingMeetingEmail, sendUpgradeLinkEmail,
  sendSlackDigest, sendSlackTestPing, buildSlackDigestBlocks, buildSlackFallbackText, maskSlackWebhook,
  sendChatDigest, sendChatTestPing, buildChatDigestCard, maskGoogleChatWebhook,
  sendDiscordDigest, sendDiscordTestPing, buildDiscordDigestEmbed, maskDiscordWebhook,
  unsubscribeUrl, unsubscribeToken, verifyUnsubscribeToken, unsubscribeFooter,
};
