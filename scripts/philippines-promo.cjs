#!/usr/bin/env node
/**
 * scripts/philippines-promo.cjs
 *
 * Dedicated special offer for Philippine educators (₱99 PHP Lifetime Pro Pass)
 * who hit paywalls or requested upgrade links.
 *
 * Guardrails:
 * 1. STRICT Deduplication: checks `philippinesPromoSentAt` on user document.
 * 2. Unsubscribe check: checks both `suppressions` and `suppressed_emails`.
 * 3. Reply-To: derekgallardo01@gmail.com.
 * 4. Dry-run by default: requires --send or --test=<email>.
 *
 * Usage:
 *   node scripts/philippines-promo.cjs --status
 *   node scripts/philippines-promo.cjs --test=derekgallardo01@gmail.com
 *   node scripts/philippines-promo.cjs --send --limit=10
 *   node scripts/philippines-promo.cjs --send
 */

const path = require('path');
const crypto = require('crypto');
const { Firestore } = require(path.resolve(__dirname, '../backend/node_modules/@google-cloud/firestore'));
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));
const Stripe = require(path.resolve(__dirname, '../backend/node_modules/stripe'));

const db = new Firestore({ projectId: 'attendance-tracker-490319' });
const RESEND_API_KEY = process.env.RESEND_API_KEY || (process.argv.find(a => a.startsWith('--resend-key=')) || '').split('=')[1];
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || (process.argv.find(a => a.startsWith('--stripe-key=')) || '').split('=')[1];
const PHP_LIFETIME_PRICE_ID = process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID || 'price_1UKowpRPP93YBXrOVreZdJO3';

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
    db.collection('suppressions').get().catch(() => ({ docs: [] })),
    db.collection('suppressed_emails').get().catch(() => ({ docs: [] })),
  ]);
  const set = new Set();
  for (const doc of s1.docs) set.add(doc.id.toLowerCase());
  for (const doc of s2.docs) set.add(doc.id.toLowerCase());
  return set;
}

async function createPhpSession(email, domain) {
  if (!stripe) {
    throw new Error('STRIPE_SECRET_KEY environment variable or --stripe-key=... is required.');
  }

  const meta = {
    plan: 'lifetime',
    individual: '1',
    email: email.toLowerCase(),
    domain: domain || (email.includes('@') ? email.split('@')[1] : 'gmail.com'),
    source: 'philippines_teacher_promo_99',
    country: 'PH',
  };

  const params = {
    mode: 'payment',
    payment_method_types: ['card', 'link'],
    line_items: [{ price: PHP_LIFETIME_PRICE_ID, quantity: 1 }],
    customer_email: email,
    client_reference_id: `user:${email.toLowerCase()}`,
    metadata: meta,
    success_url: 'https://attendancetracker.dev/history.html?upgraded=1',
    cancel_url: 'https://attendancetracker.dev/pricing.html',
    expires_at: Math.floor(Date.now() / 1000) + (24 * 3600),
    payment_intent_data: { metadata: meta },
    customer_creation: 'always',
    after_expiration: { recovery: { enabled: true } },
  };

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
  <title>Special Teacher Offer: Attendance Tracker Lifetime Pro (₱99)</title>
</head>
<body style="margin:0;padding:24px 16px;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e6edf3;line-height:1.6;">
  <div style="max-width:540px;margin:0 auto;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px 24px;box-sizing:border-box;">
    
    <div style="margin-bottom:20px;">
      <span style="background:rgba(35,134,54,0.25);border:1px solid rgba(74,222,128,0.4);color:#4ade80;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;text-transform:uppercase;letter-spacing:0.04em;">Philippine Teacher Special 🇵🇭</span>
    </div>

    <h2 style="margin:0 0 16px;color:#ffffff;font-size:20px;font-weight:700;line-height:1.3;">
      Lifetime Pro for Philippine Educators — ₱99
    </h2>

    <p style="margin:0 0 16px;font-size:14.5px;color:#c9d1d9;">
      Hi ${firstName},
    </p>

    <p style="margin:0 0 16px;font-size:14px;color:#c9d1d9;">
      You recently tracked attendance on <strong>Attendance Tracker for Google Meet</strong>. We know that standard international software pricing can be prohibitive for classroom teachers and university instructors in the Philippines.
    </p>

    <p style="margin:0 0 20px;font-size:14px;color:#c9d1d9;">
      To make sure every educator in the Philippines can track their classes without limits, we created a dedicated <strong>₱99 PHP Lifetime Pass</strong>:
    </p>

    <!-- Plan Card -->
    <div style="background:#0d1117;border:1.5px solid rgba(74,222,128,0.45);border-radius:10px;padding:20px;margin-bottom:24px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;border-collapse:collapse;">
        <tr>
          <td style="font-weight:700;font-size:16px;color:#ffffff;vertical-align:baseline;text-align:left;">
            Lifetime Pro (Teacher Pass)
          </td>
          <td style="font-weight:800;font-size:20px;color:#4ade80;vertical-align:baseline;text-align:right;white-space:nowrap;padding-left:16px;">
            ₱99 <span style="font-size:12px;font-weight:400;color:#8b949e;">one-time</span>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;font-size:13px;color:#8b949e;line-height:1.4;">
        Pay once, keep forever &bull; Unlimited class sizes (>25 students) &bull; Unlimited Google Sheets & CSV exports &bull; No monthly or yearly auto-debit
      </p>

      <a href="${checkoutUrl}" style="display:block;width:100%;text-align:center;box-sizing:border-box;background:#238636;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;font-size:14px;">
        Claim Lifetime Pro (₱99) &rarr;
      </a>
      <p style="margin:10px 0 0;font-size:11.5px;color:#7ee787;text-align:center;">
        ⚡ Instant activation &bull; Debit / Credit card &bull; Philippine localized checkout
      </p>
    </div>

    <p style="margin:0 0 16px;font-size:13.5px;color:#8b949e;">
      If you need an institutional receipt or certificate for school supply reimbursement, feel free to reply directly to this email.
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

You recently tracked attendance on Attendance Tracker for Google Meet. We know that standard international software pricing can be prohibitive for classroom teachers and university instructors in the Philippines.

To make sure every educator in the Philippines can track their classes without limits, we created a dedicated ₱99 PHP Lifetime Pass:

Lifetime Pro (Teacher Pass) — ₱99 one-time (Pay once, keep forever, no subscription)
Upgrade link: ${checkoutUrl}

Includes unlimited class sizes (>25 attendees), unlimited Google Sheets sync, and instant activation. If you have any questions or need a receipt for school reimbursement, just reply to this email.

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

  console.log('=== PHILIPPINES ₱99 TEACHER PROMO TOOL ===');

  if (testArg) {
    const testEmail = testArg.split('=')[1];
    console.log(`Sending single test email to: ${testEmail}...`);
    const checkoutUrl = await createPhpSession(testEmail, 'gmail.com');
    const unsub = unsubscribeUrl(testEmail);
    const html = buildEmailHtml({ name: 'Derek', checkoutUrl, unsubUrl: unsub });
    const text = buildEmailText({ name: 'Derek', checkoutUrl, unsubUrl: unsub });

    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: testEmail,
      replyTo: DEREK_EMAIL,
      subject: 'Special Teacher Offer: Attendance Tracker Lifetime Pro (₱99 🇵🇭)',
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

  const phUsersMap = new Map();
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    const email = doc.id.toLowerCase();
    const isPh = d.signupGeo?.country === 'PH' || email.endsWith('.ph');
    if (isPh) {
      phUsersMap.set(email, {
        ref: doc.ref,
        email,
        name: d.displayName || '',
        domain: doc.ref.parent.parent?.id || email.split('@')[1],
        plan: d.individualPlan || 'free',
        createdAt: d.createdAt || null,
        philippinesPromoSentAt: d.philippinesPromoSentAt || null,
        events: []
      });
    }
  }

  for (const doc of eventsSnap.docs) {
    const e = doc.data();
    const email = (e.email || '').toLowerCase();
    if (phUsersMap.has(email)) {
      phUsersMap.get(email).events.push(e.type);
    }
  }

  const eligible = [];
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [email, u] of phUsersMap.entries()) {
    if (u.plan === 'pro') continue;
    if (suppressed.has(email)) continue;
    if (u.philippinesPromoSentAt) continue;

    // 48-Hour New-Signup "No-Sales" Grace Period:
    // Allow new users at least 48 hours to explore and test the app in peace
    const createdSec = u.createdAt?._seconds || (u.createdAt ? Math.floor(new Date(u.createdAt).getTime() / 1000) : 0);
    if (createdSec && (nowSec - createdSec) < (48 * 3600)) {
      continue;
    }

    const hasGate = u.events.some(t => t.includes('upgrade') || t.includes('quota') || t.includes('paywall') || t.includes('export_skipped'));
    if (hasGate) {
      eligible.push(u);
    }
  }

  console.log(`Total Philippine Users: ${phUsersMap.size}`);
  console.log(`Eligible Paywall Leads: ${eligible.length}`);

  if (isStatus || (!isSend && !testArg)) {
    console.log('\n--- SAMPLE ELIGIBLE RECIPIENTS ---');
    eligible.slice(0, 15).forEach((u, idx) => {
      console.log(`${idx + 1}. ${u.email} (${u.name || 'No name'}) - ${u.events.length} events`);
    });
    console.log('\nTo send a test: node scripts/philippines-promo.cjs --test=derekgallardo01@gmail.com');
    console.log('To run outreach: node scripts/philippines-promo.cjs --send --limit=10');
    return;
  }

  if (isSend) {
    if (!resend) {
      throw new Error('RESEND_API_KEY environment variable or --resend-key=... is required.');
    }
    const toSend = eligible.slice(0, limit);
    console.log(`Sending to ${toSend.length} educators (limit=${limit})...`);

    let sent = 0;
    let failed = 0;

    for (const user of toSend) {
      try {
        console.log(`[${sent + 1}/${toSend.length}] Creating ₱99 checkout & sending to ${user.email} (${user.name || 'No name'})...`);
        const checkoutUrl = await createPhpSession(user.email, user.domain);
        const unsub = unsubscribeUrl(user.email);
        const html = buildEmailHtml({ name: user.name, checkoutUrl, unsubUrl: unsub });
        const text = buildEmailText({ name: user.name, checkoutUrl, unsubUrl: unsub });

        await resend.emails.send({
          from: FROM_ADDRESS,
          to: user.email,
          replyTo: DEREK_EMAIL,
          subject: 'Special Teacher Offer: Attendance Tracker Lifetime Pro (₱99 🇵🇭)',
          html,
          text,
        });

        // Stamp sent time for deduplication
        await user.ref.update({
          philippinesPromoSentAt: new Date().toISOString()
        });

        sent++;
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
