const nodemailer = require('nodemailer');
const log = require('./logger');

// Lazily create the SMTP transport so we don't fail boot when env vars aren't
// set yet. Reuse a single transporter — nodemailer pools connections under the
// hood.
let cachedTransporter = null;
function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return cachedTransporter;
}

// Fire-and-forget signup notification email. Sends to NOTIFY_EMAIL (or
// GMAIL_USER if NOTIFY_EMAIL isn't set). Silent no-op if SMTP isn't configured.
async function sendSignupWebhook({ email, displayName, domain, acquisitionSource, totalUsers }) {
  const transporter = getTransporter();
  if (!transporter) return;

  const sender = process.env.GMAIL_USER;
  const to = process.env.NOTIFY_EMAIL || sender;
  const sourceLine = acquisitionSource ? ` (via ${acquisitionSource})` : '';
  const subject = `🎉 New user: ${displayName || email}${sourceLine}`;

  const html = `
    <p>A new user just signed up for Attendance Tracker.</p>
    <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td>${escape(displayName) || '—'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td><a href="mailto:${escape(email)}">${escape(email)}</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Domain</td><td>${escape(domain)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#666">Source</td><td>${escape(acquisitionSource) || 'Unknown'}</td></tr>
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
    `Source: ${acquisitionSource || 'Unknown'}`,
    `Total users now: ${totalUsers ?? '?'}`,
    '',
    'Open admin dashboard: https://attendancetracker.dev/admin.html',
  ].join('\n');

  try {
    await transporter.sendMail({
      from: `"Attendance Tracker" <${sender}>`,
      to,
      subject,
      text,
      html,
    });
    log.info('signup notification sent', { email, domain, to });
  } catch (err) {
    log.warn('signup notification failed', { error: err.message });
  }
}

function escape(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Generic email send used by the admin "email from dashboard" feature.
// Returns { sent: true, messageId } or throws if SMTP isn't configured.
async function sendAdminEmail({ to, subject, body }) {
  const transporter = getTransporter();
  if (!transporter) throw new Error('SMTP not configured — set GMAIL_USER and GMAIL_APP_PASSWORD');
  if (!to || !subject) throw new Error('to and subject are required');
  const sender = process.env.GMAIL_USER;
  const text = body || '';
  const html = text.split('\n').map(l => `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;line-height:1.5">${escape(l) || '&nbsp;'}</p>`).join('');
  const info = await transporter.sendMail({
    from: `"Derek Gallardo" <${sender}>`,
    to,
    subject,
    text,
    html,
    replyTo: sender,
  });
  return { sent: true, messageId: info.messageId };
}

// Weekly self-report email. Formats the report from firestore into something
// you can scan in 30 seconds Monday morning.
async function sendWeeklySelfReport(report) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: 'SMTP not configured' };
  const sender = process.env.GMAIL_USER;
  const to = process.env.NOTIFY_EMAIL || sender;

  const arrow = (s) => s.startsWith('+') ? `<span style="color:#16a34a">▲ ${s}</span>` : s.startsWith('-') ? `<span style="color:#dc2626">▼ ${s}</span>` : `<span style="color:#666">${s}</span>`;
  const escH = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  const newSignupsList = (report.signups.new || []).map(u =>
    `<li>${escH(u.displayName || u.email)} &lt;${escH(u.email)}&gt; — ${escH(u.domain)}${u.source ? ` (${escH(u.source)})` : ''}</li>`
  ).join('') || '<li style="color:#666">No new signups this week.</li>';

  const concernsList = (report.concerns || []).map(u =>
    `<li>${escH(u.displayName || u.email)} &lt;${escH(u.email)}&gt; — ${escH(u.domain)}, signed up 3-7d ago, never tracked</li>`
  ).join('') || '<li style="color:#16a34a">No churn-risk users this week 🎉</li>';

  const sourcesList = Object.entries(report.sources || {}).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<li>${escH(s)} — ${n}</li>`).join('') || '<li style="color:#666">No source data yet.</li>';

  const topUserLine = report.topUser
    ? `${escH(report.topUser.displayName || report.topUser.email)} (${report.topUser.actions} actions)`
    : 'Nobody yet — quiet week.';

  const subject = `📊 Weekly Attendance Tracker report — ${report.signups.thisWeek} new signup${report.signups.thisWeek === 1 ? '' : 's'}, ${report.tracks.thisWeek} track${report.tracks.thisWeek === 1 ? '' : 's'}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;color:#111">
      <h2 style="margin:0 0 6px;color:#4ade80">Week of ${new Date(report.windowStart).toLocaleDateString()} → ${new Date(report.windowEnd).toLocaleDateString()}</h2>
      <p style="color:#666;margin:0 0 16px">Snapshot: ${report.totalUsers} total users, ${report.totalMeetings} total meetings tracked.</p>
      <table style="border-collapse:collapse;width:100%;margin-bottom:18px;font-size:14px">
        <tr style="background:#f5f5f5"><th style="text-align:left;padding:8px">Metric</th><th style="text-align:right;padding:8px">This week</th><th style="text-align:right;padding:8px">Last week</th><th style="text-align:right;padding:8px">Change</th></tr>
        <tr><td style="padding:8px;border-top:1px solid #eee">Signups</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.signups.thisWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.signups.lastWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${arrow(report.signups.delta)}</td></tr>
        <tr><td style="padding:8px;border-top:1px solid #eee">Meetings tracked</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.tracks.thisWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.tracks.lastWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${arrow(report.tracks.delta)}</td></tr>
        <tr><td style="padding:8px;border-top:1px solid #eee">Exports</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.exports.thisWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${report.exports.lastWeek}</td><td style="text-align:right;padding:8px;border-top:1px solid #eee">${arrow(report.exports.delta)}</td></tr>
      </table>

      <h3 style="margin:0 0 6px">⭐ Top user this week</h3>
      <p style="margin:0 0 16px;font-size:14px">${topUserLine}</p>

      <h3 style="margin:0 0 6px">🌱 New signups</h3>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px">${newSignupsList}</ul>

      <h3 style="margin:0 0 6px">⚠ Churn risk — check in this week</h3>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px">${concernsList}</ul>

      <h3 style="margin:0 0 6px">📡 Where they came from</h3>
      <ul style="margin:0 0 16px;padding-left:20px;font-size:14px">${sourcesList}</ul>

      <p style="margin-top:24px;color:#666;font-size:12px"><a href="https://attendancetracker.dev/admin.html">Open admin dashboard →</a></p>
    </div>
  `;

  const text = [
    `Weekly Attendance Tracker report`,
    `Week of ${new Date(report.windowStart).toLocaleDateString()} → ${new Date(report.windowEnd).toLocaleDateString()}`,
    ``,
    `Signups:  ${report.signups.thisWeek} (was ${report.signups.lastWeek}, ${report.signups.delta})`,
    `Tracks:   ${report.tracks.thisWeek} (was ${report.tracks.lastWeek}, ${report.tracks.delta})`,
    `Exports:  ${report.exports.thisWeek} (was ${report.exports.lastWeek}, ${report.exports.delta})`,
    ``,
    `Top user: ${topUserLine.replace(/<[^>]+>/g, '')}`,
    ``,
    `Admin: https://attendancetracker.dev/admin.html`,
  ].join('\n');

  const info = await transporter.sendMail({
    from: `"Attendance Tracker" <${sender}>`,
    to,
    subject,
    text,
    html,
  });
  return { sent: true, messageId: info.messageId };
}

module.exports = { sendSignupWebhook, sendAdminEmail, sendWeeklySelfReport };
