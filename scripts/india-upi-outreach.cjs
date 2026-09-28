#!/usr/bin/env node
/**
 * scripts/india-upi-outreach.cjs
 *
 * One-time announcement to high-intent Indian educators who previously hit paywalls
 * or had checkout sessions expire due to lack of UPI / RBI card blocks.
 *
 * Guardrails:
 * 1. STRICT Deduplication: checks `indiaUpiOfferSentAt` on user document.
 * 2. Unsubscribe check: checks both `suppressions` and `suppressed_emails`.
 * 3. Reply-To: derekgallardo01@gmail.com.
 * 4. Dry-run by default: requires --send or --test=<email>.
 *
 * Usage:
 *   node scripts/india-upi-outreach.cjs --status
 *   node scripts/india-upi-outreach.cjs --test=derekgallardo01@gmail.com
 *   node scripts/india-upi-outreach.cjs --send --limit=10
 *   node scripts/india-upi-outreach.cjs --send
 */

const path = require('path');
const crypto = require('crypto');
const { Firestore } = require(path.resolve(__dirname, '../backend/node_modules/@google-cloud/firestore'));
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));
const Stripe = require(path.resolve(__dirname, '../backend/node_modules/stripe'));

const db = new Firestore({ projectId: 'attendance-tracker-490319' });
const RESEND_API_KEY = process.env.RESEND_API_KEY || (process.argv.find(a => a.startsWith('--resend-key=')) || '').split('=')[1];
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || (process.argv.find(a => a.startsWith('--stripe-key=')) || '').split('=')[1];
const INR_LIFETIME_PRICE_ID = process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID || 'price_1UKHrcRPP93YBXrOCFvHs1yV';
const INR_EDUCATOR_PRICE_ID = process.env.STRIPE_EDUCATOR_INR_PRICE_ID || 'price_1UKHrjRPP93YBXrOYKcp9Ft9';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const DEREK_EMAIL = 'derekgallardo01@gmail.com';
const FROM_ADDRESS = 'Derek from Attendance Tracker <noreply@attendancetracker.dev>';
const SESSION_SECRET = process.env.SESSION_SECRET || 'secret';

function unsubscribeUrl(email) {
  const token = crypto.createHmac('sha256', SESSION_SECRET).update(String(email).toLowerCase()).digest('hex').slice(0, 32);
  return `https://attendance-tracker-backend-829771833968.us-central1.run.app/api/public/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

async function getSuppressedEmails() {
  const [s1, s2] = await Promise.all([
    db.collection('suppressions').get(),
    db.collection('suppressed_emails').get(),
  ]);
  const set = new Set();
  for (const doc of s1.docs) set.add(doc.id.toLowerCase());
  for (const doc of s2.docs) set.add(doc.id.toLowerCase());
  return set;
}

async function createInrSession(email, domain, plan = 'lifetime') {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY environment variable or --stripe-key=... is required to create checkout sessions.');
  }
  const priceId = plan === 'educator' ? INR_EDUCATOR_PRICE_ID : INR_LIFETIME_PRICE_ID;
  const isRecurring = plan === 'educator';
  const meta = {
    domain,
    email: email.toLowerCase(),
    individual: '1',
    plan,
    country: 'IN',
    source: 'india_upi_outreach'
  };

  const params = {
    mode: isRecurring ? 'subscription' : 'payment',
    payment_method_types: ['card', 'upi'],
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: `user:${email.toLowerCase()}`,
    customer_email: email.toLowerCase(),
    success_url: 'https://attendancetracker.dev/history.html?upgraded=1',
    cancel_url: 'https://attendancetracker.dev/pricing.html',
    metadata: meta,
    after_expiration: { recovery: { enabled: true } },
  };

  if (!isRecurring) {
    params.payment_intent_data = { metadata: meta };
    params.customer_creation = 'always';
  } else {
    params.subscription_data = { metadata: meta };
  }

  const session = await stripe.checkout.sessions.create(params);
  return session.url;
}

function buildEmailHtml({ name, checkoutUrl, unsubUrl }) {
  const firstName = name ? name.split(' ')[0] : 'there';
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UPI now available on Attendance Tracker</title>
</head>
<body style="margin:0;padding:24px 16px;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3;line-height:1.6;">
  <div style="max-width:540px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px 24px;box-sizing:border-box;">
    
    <div style="margin-bottom:20px;">
      <span style="background:rgba(35,134,54,0.25);border:1px solid rgba(74,222,128,0.4);color:#4ade80;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.04em;">New Payment Option 🇮🇳</span>
    </div>

    <h2 style="margin:0 0 16px;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">
      Google Pay & PhonePe (UPI) is now live
    </h2>

    <p style="margin:0 0 16px;font-size:14.5px;color:#c9d1d9;">
      Hi ${firstName},
    </p>

    <p style="margin:0 0 16px;font-size:14px;color:#c9d1d9;">
      You recently tried exporting attendance or upgrading on <strong>Attendance Tracker for Google Meet</strong>. Several teachers in India told us that international credit cards were failing due to bank restrictions, and asked if they could pay with UPI.
    </p>

    <p style="margin:0 0 20px;font-size:14px;color:#c9d1d9;">
      We just enabled direct <strong>UPI payments (Google Pay, PhonePe, Paytm, BHIM)</strong> and Indian debit cards in Indian Rupees:
    </p>

    <!-- Plan Card -->
    <div style="background:#0d1117;border:1.5px solid rgba(74,222,128,0.45);border-radius:10px;padding:20px;margin-bottom:24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;border-collapse:collapse;">
        <tr>
          <td style="font-weight:700;font-size:16px;color:#ffffff;vertical-align:baseline;text-align:left;">
            Individual Lifetime Pro
          </td>
          <td style="font-weight:800;font-size:20px;color:#4ade80;vertical-align:baseline;text-align:right;white-space:nowrap;padding-left:16px;">
            ₹399 <span style="font-size:12px;font-weight:400;color:#8b949e;">one-time</span>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;font-size:13px;color:#8b949e;line-height:1.4;">
        Pay once, keep forever &bull; No recurring auto-debit &bull; Unlimited Sheets exports & auto-save &bull; Zero bank markup fees
      </p>

      <a href="${checkoutUrl}" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#238636;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;font-size:14px;">
        Pay with UPI or Card (₹399) &rarr;
      </a>
      <p style="margin:10px 0 0;font-size:11.5px;color:#7ee787;text-align:center;">
        ⚡ Instant activation &bull; Scan QR or enter UPI ID
      </p>
    </div>

    <p style="margin:0 0 16px;font-size:13.5px;color:#8b949e;">
      If you have any questions or need an institutional receipt, just hit reply &mdash; it comes straight to my inbox.
    </p>

    <p style="margin:0;font-size:13.5px;color:#8b949e;">
      Best regards,<br>
      <strong style="color:#c9d1d9;">Derek Gallardo</strong><br>
      Creator, Attendance Tracker
    </p>

    <div style="margin-top:28px;padding-top:16px;border-top:1px solid #21262d;text-align:center;font-size:12px;color:#484f58;">
      <a href="${unsubUrl}" style="color:#58a6ff;text-decoration:none;">Unsubscribe</a> &bull; Attendance Tracker for Google Meet
    </div>

  </div>
</body>
</html>
`;
}

function buildEmailText({ name, checkoutUrl, unsubUrl }) {
  const firstName = name ? name.split(' ')[0] : 'there';
  return `Hi ${firstName},

You recently tried exporting attendance or upgrading on Attendance Tracker for Google Meet. Several teachers in India told us that international credit cards were failing due to bank restrictions, and asked if they could pay with UPI.

We just enabled direct UPI payments (Google Pay, PhonePe, Paytm) and Indian debit cards in Indian Rupees:

Lifetime Pro Pass — ₹399 one-time (Pay once, keep forever, no subscription)
Upgrade link: ${checkoutUrl}

Instant activation with zero international bank markup fees. If you have any questions or need an invoice/receipt, feel free to reply directly to this email.

Best regards,
Derek Gallardo
Creator, Attendance Tracker

Unsubscribe: ${unsubUrl}
`;
}

async function main() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isSend = args.includes('--send');
  const testArg = args.find(a => a.startsWith('--test='));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  console.log('=== INDIA UPI RE-ENGAGEMENT TOOL ===');

  if (testArg) {
    const testEmail = testArg.split('=')[1];
    console.log(`Sending single test email to: ${testEmail}...`);
    const checkoutUrl = await createInrSession(testEmail, 'gmail.com', 'lifetime');
    const unsub = unsubscribeUrl(testEmail);
    const html = buildEmailHtml({ name: 'Derek', checkoutUrl, unsubUrl: unsub });
    const text = buildEmailText({ name: 'Derek', checkoutUrl, unsubUrl: unsub });

    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: testEmail,
      replyTo: DEREK_EMAIL,
      subject: 'UPI & Indian Rupee (₹399) now supported on Attendance Tracker',
      html,
      text,
    });
    console.log('Test send result:', result);
    return;
  }

  // Load users & events
  const [usersSnap, eventsSnap, suppressed] = await Promise.all([
    db.collectionGroup('users').get(),
    db.collectionGroup('events').get(),
    getSuppressedEmails(),
  ]);

  const inUsersMap = new Map();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    if (d.signupGeo?.country === 'IN') {
      inUsersMap.set(doc.id.toLowerCase(), {
        ref: doc.ref,
        email: doc.id.toLowerCase(),
        name: d.displayName || '',
        domain: doc.ref.parent.parent?.id || doc.id.split('@')[1],
        plan: d.individualPlan || 'free',
        indiaUpiOfferSentAt: d.indiaUpiOfferSentAt || null,
        events: []
      });
    }
  }

  for (const doc of eventsSnap.docs) {
    const e = doc.data();
    const email = (e.email || '').toLowerCase();
    if (inUsersMap.has(email)) {
      inUsersMap.get(email).events.push(e.type);
    }
  }

  const eligible = [];
  for (const [email, u] of inUsersMap.entries()) {
    if (u.plan === 'pro') continue;
    if (suppressed.has(email)) continue;
    if (u.indiaUpiOfferSentAt) continue;

    const hasGate = u.events.some(t => t.includes('upgrade') || t.includes('quota') || t.includes('paywall'));
    if (hasGate) {
      eligible.push({
        ref: u.ref,
        email: u.email,
        name: u.name,
        domain: u.domain,
        gateCount: u.events.filter(t => t.includes('upgrade') || t.includes('quota')).length,
      });
    }
  }

  eligible.sort((a, b) => b.gateCount - a.gateCount);
  console.log(`Found ${eligible.length} uncontacted, unsuppressed high-intent Indian users.`);

  if (isStatus || (!isSend && !testArg)) {
    console.log('\n--- Top 10 Candidates (Dry Run) ---');
    console.table(eligible.slice(0, 10).map(c => ({ email: c.email, name: c.name, gates: c.gateCount })));
    console.log('\nTo send a test to yourself:');
    console.log('  node scripts/india-upi-outreach.cjs --test=derekgallardo01@gmail.com');
    console.log('To send live:');
    console.log('  node scripts/india-upi-outreach.cjs --send --limit=10');
    return;
  }

  if (isSend) {
    if (!resend) {
      throw new Error('RESEND_API_KEY environment variable or --resend-key=... is required to send emails.');
    }
    const toSend = eligible.slice(0, limit);
    console.log(`Sending to ${toSend.length} educators (limit=${limit})...`);

    let sent = 0;
    let failed = 0;

    for (const user of toSend) {
      try {
        console.log(`[${sent + 1}/${toSend.length}] Creating checkout & sending to ${user.email} (${user.name || 'No name'})...`);
        const checkoutUrl = await createInrSession(user.email, user.domain, 'lifetime');
        const unsub = unsubscribeUrl(user.email);
        const html = buildEmailHtml({ name: user.name, checkoutUrl, unsubUrl: unsub });
        const text = buildEmailText({ name: user.name, checkoutUrl, unsubUrl: unsub });

        await resend.emails.send({
          from: FROM_ADDRESS,
          to: user.email,
          replyTo: DEREK_EMAIL,
          subject: 'UPI & Indian Rupee (₹399) now supported on Attendance Tracker',
          html,
          text,
        });

        // Stamp sent time for deduplication
        await user.ref.update({
          indiaUpiOfferSentAt: new Date().toISOString()
        });

        sent++;
        // Small pause to be gentle on email API rate limits
        await new Promise(r => setTimeout(r, 600));
      } catch (err) {
        console.error(`Failed to send to ${user.email}:`, err.message);
        failed++;
      }
    }

    console.log(`\nComplete! Sent: ${sent}, Failed: ${failed}`);
  }
}

main().catch(console.error);
