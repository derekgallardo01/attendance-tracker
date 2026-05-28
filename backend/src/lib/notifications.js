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

module.exports = { sendSignupWebhook, sendAdminEmail };
