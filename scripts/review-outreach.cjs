#!/usr/bin/env node
/**
 * scripts/review-outreach.cjs
 * 
 * Safe, tracked review outreach to power users (>= 2 exports).
 * 
 * Features & Guardrails:
 * 1. STRICT Deduplication: checks `reviewEmailSentAt` on user document. NEVER sends twice.
 * 2. Unsubscribe check: checks `suppressed_emails` collection before sending.
 * 3. Reply-To: derekgallardo01@gmail.com (replies go straight to Derek's personal inbox).
 * 4. Click Tracking: links to /api/public/review-click which records the timestamp in Firestore.
 * 5. Dry-run by default: requires --send flag to actually dispatch emails.
 * 
 * Usage:
 *   node scripts/review-outreach.cjs --status
 *   node scripts/review-outreach.cjs --dry-run
 *   node scripts/review-outreach.cjs --send --limit=10
 */

const path = require('path');
const { Firestore } = require(path.resolve(__dirname, '../backend/node_modules/@google-cloud/firestore'));
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));

const db = new Firestore({ projectId: 'attendance-tracker-490319' });
const RESEND_API_KEY = process.env.RESEND_API_KEY || (process.argv.find(a => a.startsWith('--resend-key=')) || '').split('=')[1];
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

const TRACKED_REDIRECT_BASE = 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api/public/review-click';
const DEREK_EMAIL = 'derekgallardo01@gmail.com';

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

async function gatherPowerUsers() {
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

  // 2. Gather user docs to check review status and metadata
  const usersSnap = await db.collectionGroup('users').get();
  const candidates = [];

  for (const doc of usersSnap.docs) {
    const email = doc.id.toLowerCase();
    const data = doc.data();
    const exports = exportCounts[email] || 0;

    if (email === DEREK_EMAIL || email.includes('noreply')) continue;
    if (exports < 2) continue; // Only power users with at least 2 exports
    if (suppressed.has(email)) continue; // Obey CAN-SPAM unsubscriptions

    const domain = doc.ref.parent.parent.id;
    candidates.push({
      email,
      domain,
      displayName: data.displayName || '',
      exports,
      reviewEmailSentAt: data.reviewEmailSentAt || null,
      reviewLinkClickedAt: data.reviewLinkClickedAt || null,
      reviewStatus: data.reviewStatus || 'not_contacted',
      ref: doc.ref,
    });
  }

  return candidates.sort((a, b) => b.exports - a.exports);
}

function buildEmail(user) {
  const firstName = user.displayName ? user.displayName.split(' ')[0] : 'there';
  const trackedUrl = `${TRACKED_REDIRECT_BASE}?email=${encodeURIComponent(user.email)}&source=power_user_email`;

  const subject = `Quick question from Derek (Attendance Tracker)`;

  const text = `Hi ${firstName},

I noticed you've tracked and exported several meetings with Attendance Tracker — I really hope it's saving you time!

I'm an independent developer building this tool, and honest reviews on the Google Workspace Marketplace are the single biggest way other teachers and meeting hosts discover it.

Would you be open to leaving a quick 5-star rating? It takes about 10 seconds:
👉 ${trackedUrl}

If there is anything you'd like improved, just hit Reply — I read and answer every message personally.

Thanks so much for using Attendance Tracker!

Best,
Derek Gallardo
Developer, Attendance Tracker
${DEREK_EMAIL}
`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;max-width:560px;line-height:1.6;font-size:14px">
  <p>Hi ${firstName},</p>
  <p>I noticed you've tracked and exported several meetings with Attendance Tracker — I really hope it's saving you time!</p>
  <p>I'm an independent developer building this tool, and honest reviews on the Google Workspace Marketplace are the single biggest way other teachers and meeting hosts discover it.</p>
  <p>Would you be open to leaving a quick 5-star rating? It takes about 10 seconds:</p>
  
  <p style="margin:20px 0">
    <a href="${trackedUrl}" style="background:#f59e0b;color:#111;font-weight:700;font-size:14px;padding:11px 22px;border-radius:8px;text-decoration:none;display:inline-block">⭐ Leave a 5-Star Review on Google Marketplace →</a>
  </p>

  <p style="color:#64748b;font-size:13px">
    If there is anything you'd like improved or any feature you're missing, simply <strong>reply to this email</strong> — I read and answer every message personally.
  </p>

  <p style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:14px;color:#475569;font-size:13px">
    Thanks so much for being an active user,<br/>
    <strong>Derek Gallardo</strong><br/>
    Developer, Attendance Tracker
  </p>
</div>
`;

  return { subject, text, html };
}

async function run() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isSend = args.includes('--send');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;

  const users = await gatherPowerUsers();

  const total = users.length;
  const sent = users.filter(u => u.reviewEmailSentAt).length;
  const clicked = users.filter(u => u.reviewLinkClickedAt).length;
  const eligible = users.filter(u => !u.reviewEmailSentAt);

  console.log('========================================');
  console.log('⭐ Attendance Tracker: Power User Review Campaign');
  console.log('========================================');
  console.log(`Total Qualified Power Users (>=2 exports): ${total}`);
  console.log(`Already Sent: ${sent}`);
  console.log(`Review Link Clicked: ${clicked}`);
  console.log(`Eligible (Not Yet Contacted): ${eligible.length}`);
  console.log('----------------------------------------\n');

  if (isStatus) {
    console.log('Top Power Users Status:');
    for (const u of users.slice(0, 15)) {
      const statusStr = u.reviewLinkClickedAt ? '⭐ CLICKED' : (u.reviewEmailSentAt ? '✉️ SENT' : '⏳ ELIGIBLE');
      console.log(`[${statusStr}] ${u.email.padEnd(42)} (${u.exports} exports) ${u.reviewEmailSentAt ? 'Sent: ' + u.reviewEmailSentAt.slice(0, 10) : ''}`);
    }
    return;
  }

  const toProcess = eligible.slice(0, limit);

  if (!isSend) {
    console.log(`🔍 DRY-RUN MODE: Showing next ${toProcess.length} eligible recipients (use --send to dispatch):\n`);
    for (const u of toProcess) {
      console.log(`- ${u.email} (${u.exports} exports, Name: "${u.displayName || 'none'}")`);
    }
    console.log(`\nSample Email Subject: "${buildEmail(toProcess[0] || { displayName: 'Alex', email: 'user@school.org' }).subject}"`);
    console.log('\nTo send to the top recipients, run:\nnode scripts/review-outreach.cjs --send --limit=10\n');
    return;
  }

  if (!resend) {
    console.error('❌ Error: RESEND_API_KEY environment variable or --resend-key=... is required to send.');
    return;
  }

  console.log(`🚀 SENDING to ${toProcess.length} eligible power users...\n`);

  for (let i = 0; i < toProcess.length; i++) {
    const u = toProcess[i];
    const { subject, text, html } = buildEmail(u);

    try {
      console.log(`[${i + 1}/${toProcess.length}] Sending to ${u.email} (${u.exports} exports)...`);
      
      const { data, error } = await resend.emails.send({
        from: 'Derek from Attendance Tracker <noreply@attendancetracker.dev>',
        reply_to: DEREK_EMAIL,
        to: u.email,
        subject,
        text,
        html,
        tags: [{ name: 'type', value: 'review_request' }],
      });

      if (error) {
        console.error(`  ❌ Failed to send to ${u.email}:`, error);
        continue;
      }

      // Record in Firestore immediately to ensure deduplication
      const nowIso = new Date().toISOString();
      await u.ref.set({
        reviewEmailSentAt: nowIso,
        reviewStatus: 'sent',
      }, { merge: true });

      console.log(`  ✅ Sent! (ID: ${data?.id})`);
    } catch (err) {
      console.error(`  ❌ Exception sending to ${u.email}:`, err.message);
    }

    if (i < toProcess.length - 1) {
      await sleep(1000); // 1s throttle between sends
    }
  }

  console.log('\n🎉 Finished review outreach batch!');
}

run().catch(console.error);
