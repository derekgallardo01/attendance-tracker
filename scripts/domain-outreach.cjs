#!/usr/bin/env node
/**
 * scripts/domain-outreach.cjs
 *
 * Targeted outreach for schools and institutional cluster domains.
 * Offers the $19.99 one-time Domain License (or $9.99 Individual Lifetime Pro).
 *
 * Guardrails:
 * 1. STRICT Deduplication: checks `domainOfferSentAt` on user document. NEVER sends twice.
 * 2. Unsubscribe check: checks `suppressed_emails` collection before sending.
 * 3. Reply-To: derekgallardo01@gmail.com (replies go straight to Derek's inbox).
 * 4. Click Tracking: links to /api/public/offer-click which records clicks in telemetry & user doc.
 * 5. Dry-run by default: requires explicit --send flag to dispatch emails.
 * 6. ZERO EMOJIS: strictly plain text and professional HTML.
 *
 * Usage:
 *   node scripts/domain-outreach.cjs --status
 *   node scripts/domain-outreach.cjs --dry-run --domain=allenhouse.ac.in
 *   node scripts/domain-outreach.cjs --send --domain=allenhouse.ac.in
 *   node scripts/domain-outreach.cjs --send --limit=5
 */

const path = require('path');
const crypto = require('crypto');
const { Firestore } = require(path.resolve(__dirname, '../backend/node_modules/@google-cloud/firestore'));
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));

const db = new Firestore({ projectId: 'attendance-tracker-490319' });
const RESEND_API_KEY = process.env.RESEND_API_KEY || (process.argv.find(a => a.startsWith('--resend-key=')) || '').split('=')[1];
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const SESSION_SECRET = process.env.SESSION_SECRET || 'secret';
const TRACKED_REDIRECT_BASE = 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api/public/offer-click';
const DEREK_EMAIL = 'derekgallardo01@gmail.com';
const FROM_ADDRESS = 'Derek Gallardo <noreply@attendancetracker.dev>';

function unsubscribeUrl(email) {
  const token = crypto.createHmac('sha256', SESSION_SECRET).update(String(email).toLowerCase()).digest('hex').slice(0, 32);
  return `https://attendance-tracker-backend-829771833968.us-central1.run.app/api/public/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

function unsubscribeFooter(email) {
  const url = unsubscribeUrl(email);
  return {
    text: `\n\n---\nDon't want these emails? Unsubscribe: ${url}`,
    html: `<p style="margin:24px 0 0;color:#8a8f98;font-size:12px;font-family:sans-serif">Don't want these emails? <a href="${url}" style="color:#8a8f98">Unsubscribe</a>.</p>`,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getSuppressedEmails() {
  const snap = await db.collection('suppressed_emails').get();
  const set = new Set();
  for (const doc of snap.docs) {
    set.add(doc.id.toLowerCase());
  }
  return set;
}

async function gatherDomainCandidates(targetDomain = null) {
  const suppressed = await getSuppressedEmails();

  // 1. Gather export counts per user
  const exportsSnap = await db.collectionGroup('exports').get();
  const exportCounts = {};
  for (const doc of exportsSnap.docs) {
    const data = doc.data();
    if (!data.email) continue;
    const email = data.email.toLowerCase();
    exportCounts[email] = (exportCounts[email] || 0) + 1;
  }

  // 2. Gather user docs across both domains and tenants collections
  const usersSnap = await db.collectionGroup('users').get();
  const userMap = new Map();

  for (const doc of usersSnap.docs) {
    const email = doc.id.toLowerCase();
    if (!email.includes('@')) continue;
    if (email === DEREK_EMAIL || email.includes('noreply') || email.includes('theyachtgroup.com')) continue;

    const domain = email.split('@')[1];
    if (domain === 'gmail.com') continue; // Focus on institutional domains

    if (targetDomain && domain.toLowerCase() !== targetDomain.toLowerCase()) {
      continue;
    }

    const data = doc.data() || {};
    const exports = exportCounts[email] || 0;

    if (suppressed.has(email)) continue; // Obey CAN-SPAM unsubscriptions

    const existing = userMap.get(email);
    const domainOfferSentAt = data.domainOfferSentAt || (existing ? existing.domainOfferSentAt : null);

    userMap.set(email, {
      email,
      domain,
      displayName: data.displayName || (existing ? existing.displayName : ''),
      exports,
      domainOfferSentAt,
      offerLinkClickedAt: data.offerLinkClickedAt || (existing ? existing.offerLinkClickedAt : null),
      offerStatus: data.offerStatus || (existing ? existing.offerStatus : 'not_contacted'),
      refs: existing ? [...existing.refs, doc.ref] : [doc.ref],
    });
  }

  const candidates = Array.from(userMap.values());
  return candidates.sort((a, b) => b.exports - a.exports);
}

function buildEmail(user) {
  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'there';
  const domain = user.domain;
  const domainOfferUrl = `${TRACKED_REDIRECT_BASE}?email=${encodeURIComponent(user.email)}&campaign=domain_license&plan=team`;
  const individualOfferUrl = `${TRACKED_REDIRECT_BASE}?email=${encodeURIComponent(user.email)}&campaign=domain_license_ind&plan=lifetime`;
  const foot = unsubscribeFooter(user.email);

  const subject = `Attendance Tracker for ${domain} - School Domain License`;

  const text = `Hi ${firstName},

I noticed that teachers and faculty at ${domain} have been using Attendance Tracker to record attendance for Google Meet lectures and classes.

As an independent developer building Attendance Tracker, I want to ensure your classes run smoothly without hitting the monthly free export limits.

Instead of each instructor purchasing individual upgrades, we offer a School & Department Domain License for a one-time payment of $19.99 (no recurring subscription):

What the School Domain License includes:
- Unlimited attendance tracking and Google Sheets exports for every teacher and student with an @${domain} account
- Multi-class attendance rates and automatic cumulative student tracking
- One-time payment ($19.99) with lifetime access for your entire domain

You can activate the Domain License for ${domain} here:
${domainOfferUrl}

If you only need an individual pass for your own classes, an Individual Lifetime Pro license is also available for $9.99:
${individualOfferUrl}

If you need an institutional invoice, tax receipt, or have any questions about classroom setup, simply reply directly to this email -- I read and answer every message personally.

Best regards,
Derek Gallardo
Developer, Attendance Tracker
${DEREK_EMAIL}
${foot.text}`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;max-width:580px;line-height:1.6;font-size:14px">
  <p>Hi ${firstName},</p>
  <p>I noticed that teachers and faculty at <strong>${domain}</strong> have been using Attendance Tracker to record attendance for Google Meet lectures and classes.</p>
  <p>As an independent developer building Attendance Tracker, I want to ensure your classes run smoothly without hitting the monthly free export limits.</p>
  <p>Instead of each instructor purchasing individual upgrades, we offer a <strong>School &amp; Department Domain License</strong> for a one-time payment of <strong>$19.99</strong> (no recurring subscription):</p>
  
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:18px 0">
    <strong style="color:#0f172a">What the School Domain License includes:</strong>
    <ul style="margin:10px 0 0;padding-left:18px;color:#334155">
      <li><strong>Unlimited exports</strong> to Google Sheets for every teacher and host with an @${domain} account</li>
      <li><strong>Cumulative student tracking</strong> and multi-class attendance rates across all lectures</li>
      <li><strong>One-time payment ($19.99)</strong> with lifetime access for your entire school domain</li>
    </ul>
  </div>

  <p style="margin:22px 0 16px">
    <a href="${domainOfferUrl}" style="background:#10b981;color:#ffffff;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Activate School Domain License ($19.99) &rarr;</a>
  </p>

  <p style="color:#64748b;font-size:13px;margin-top:14px">
    If you only need an individual license for your own classes, an <a href="${individualOfferUrl}" style="color:#2563eb;text-decoration:underline">Individual Lifetime Pro license is also available for $9.99</a>.
  </p>

  <p style="color:#64748b;font-size:13px;margin-top:18px">
    If you need an institutional invoice, tax receipt, or have any questions about classroom setup, simply <strong>reply directly to this email</strong> -- I read and answer every message personally.
  </p>

  <p style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;color:#475569;font-size:13px">
    Best regards,<br/>
    <strong>Derek Gallardo</strong><br/>
    Developer, Attendance Tracker<br/>
    <a href="mailto:${DEREK_EMAIL}" style="color:#64748b">${DEREK_EMAIL}</a>
  </p>
  ${foot.html}
</div>`;

  return { subject, text, html };
}

async function run() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isSend = args.includes('--send');
  const domainArg = args.find(a => a.startsWith('--domain='));
  const targetDomain = domainArg ? domainArg.split('=')[1].trim() : null;
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

  const users = await gatherDomainCandidates(targetDomain);

  const total = users.length;
  const sent = users.filter(u => u.domainOfferSentAt).length;
  const clicked = users.filter(u => u.offerLinkClickedAt).length;
  const eligible = users.filter(u => !u.domainOfferSentAt);

  console.log('========================================');
  console.log('Attendance Tracker: School Domain License Campaign');
  console.log('========================================');
  if (targetDomain) {
    console.log(`Target Domain: ${targetDomain}`);
  }
  console.log(`Total Candidates: ${total}`);
  console.log(`Already Sent: ${sent}`);
  console.log(`Offer Link Clicked: ${clicked}`);
  console.log(`Eligible (Not Yet Contacted): ${eligible.length}`);
  console.log('----------------------------------------\n');

  if (isStatus) {
    // Group by domain
    const byDomain = {};
    for (const u of users) {
      if (!byDomain[u.domain]) byDomain[u.domain] = [];
      byDomain[u.domain].push(u);
    }
    console.log('Domains breakdown:');
    for (const [dom, list] of Object.entries(byDomain)) {
      const eligibleCount = list.filter(u => !u.domainOfferSentAt).length;
      console.log(`  ${dom} (${list.length} users, ${eligibleCount} eligible):`);
      for (const u of list) {
        console.log(`    - ${u.email} | Name: ${u.displayName || 'None'} | Exports: ${u.exports} | Status: ${u.domainOfferSentAt ? 'Sent ' + u.domainOfferSentAt : 'Eligible'}`);
      }
    }
    return;
  }

  if (!isSend) {
    console.log('[DRY-RUN MODE] No emails will be sent. Pass --send to dispatch.\n');
    const batch = eligible.slice(0, Math.min(eligible.length, 3));
    if (batch.length === 0) {
      console.log('No eligible users found.');
      return;
    }
    console.log(`Sample email preview for ${batch[0].email} (${batch[0].domain}):\n`);
    const preview = buildEmail(batch[0]);
    console.log(`Subject: ${preview.subject}\n`);
    console.log(preview.text);
    console.log('\n--- End of preview ---\n');
    console.log(`Would send to ${Math.min(eligible.length, limit)} eligible users with --send --limit=${limit}:`);
    eligible.slice(0, limit).forEach((u, i) => {
      console.log(`  ${i + 1}. ${u.email} (${u.domain}) - ${u.exports} exports`);
    });
    return;
  }

  // SEND MODE
  const batch = eligible.slice(0, limit);
  if (batch.length === 0) {
    console.log('No eligible users to send to.');
    return;
  }

  console.log(`Dispatching ${batch.length} emails via Resend...\n`);
  let successCount = 0;
  let failCount = 0;

  for (const user of batch) {
    const { subject, text, html } = buildEmail(user);
    try {
      const res = await resend.emails.send({
        from: FROM_ADDRESS,
        to: user.email,
        reply_to: DEREK_EMAIL,
        subject,
        text,
        html,
        tags: [
          { name: 'campaign', value: 'domain_license' },
          { name: 'domain', value: user.domain.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) },
        ],
      });

      if (res.error) {
        console.error(`FAILED: ${user.email} - ${res.error.message || JSON.stringify(res.error)}`);
        failCount++;
      } else {
        const now = new Date().toISOString();
        // Update user documents across both collections
        for (const ref of user.refs) {
          try {
            await ref.set({
              domainOfferSentAt: now,
              domainOfferStatus: 'sent',
              domainOfferCampaign: 'domain_license',
            }, { merge: true });
          } catch (e) {
            console.warn(`Warning: failed to update ref ${ref.path}: ${e.message}`);
          }
        }
        console.log(`SENT: ${user.email} (${user.domain}) [Resend ID: ${res.data ? res.data.id : 'ok'}]`);
        successCount++;
      }
    } catch (err) {
      console.error(`ERROR: ${user.email} - ${err.message}`);
      failCount++;
    }

    await sleep(1000); // 1-second throttle
  }

  console.log(`\nCampaign batch finished. Successfully sent: ${successCount}, Failed: ${failCount}`);
}

run().catch(err => {
  console.error('Fatal error running domain outreach script:', err);
  process.exit(1);
});
