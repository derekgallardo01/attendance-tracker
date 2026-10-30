// Every user-reachable API error must carry a translatable code, so the app
// never shows raw English to a user who chose another language.
const fs = require('fs');
const path = require('path');
const { errorCodes, errorCodeFor, RULES } = require('../../src/lib/errorCodes');

const SRC = path.join(__dirname, '..', '..', 'src');
// admin.js is founder-only (English by design); webhooks talk to Stripe/Resend.
const FILES = [
  ...fs.readdirSync(path.join(SRC, 'routes')).filter((f) => f.endsWith('.js') && f !== 'admin.js' && f !== 'webhooks.js').map((f) => path.join(SRC, 'routes', f)),
  path.join(SRC, 'middleware', 'auth.js'),
  path.join(SRC, 'app.js'),
];

describe('errorCodeFor', () => {
  test('every literal { error: "…" } in user-facing routes maps to a code', () => {
    const unmapped = [];
    for (const file of FILES) {
      const src = fs.readFileSync(file, 'utf8');
      const re = /error:\s*'((?:\\.|[^'\\])*)'/g;
      let m;
      while ((m = re.exec(src))) {
        const msg = m[1].replace(/\\'/g, "'");
        if (!errorCodeFor(msg)) unmapped.push(`${path.basename(file)}: ${msg}`);
      }
    }
    expect(unmapped).toEqual([]);
  });

  test('templated messages capture their parameters', () => {
    expect(errorCodeFor('You have reached your limit of 2 free exports this month. Upgrade to Pro for unlimited exports.'))
      .toEqual({ code: 'EXPORT_QUOTA', params: { limit: 2 } });
    expect(errorCodeFor('Tracking attendance for large classes (>25 attendees) is a Pro feature.'))
      .toEqual({ code: 'LARGE_CLASS', params: { limit: 25 } });
    expect(errorCodeFor('Free tier supports exporting up to 25 attendees per meeting.'))
      .toEqual({ code: 'LARGE_CLASS', params: { limit: 25 } });
    expect(errorCodeFor('No Google Chat webhook URL provided or saved.')).toEqual({ code: 'WEBHOOK_MISSING', params: { provider: 'Google Chat' } });
    expect(errorCodeFor('Invalid Slack webhook URL.')).toEqual({ code: 'WEBHOOK_INVALID', params: { provider: 'Slack' } });
    expect(errorCodeFor('Discord webhook URL must look like https://discord.com/api/webhooks/{id}/{token}'))
      .toEqual({ code: 'WEBHOOK_INVALID', params: { provider: 'Discord' } });
    expect(errorCodeFor('Slack rejected the test ping.')).toEqual({ code: 'WEBHOOK_REJECTED', params: { provider: 'Slack' } });
    expect(errorCodeFor('digestExtraEmails must be up to 5 valid email addresses (or null to clear).'))
      .toEqual({ code: 'EXTRA_EMAILS_INVALID', params: { limit: 5 } });
    expect(errorCodeFor('Canvas error: Bad Gateway')).toEqual({ code: 'CANVAS_ERROR' });
    expect(errorCodeFor('Could not connect to Canvas instance at x.edu. Check URL.')).toEqual({ code: 'CANVAS_UNREACHABLE' });
    expect(errorCodeFor('Failed to fetch conference: boom')).toEqual({ code: 'SERVER_ERROR' });
    expect(errorCodeFor("That plan isn't available in your region.")).toEqual({ code: 'PLAN_NOT_AVAILABLE' });
  });

  test('setup-wizard (verify-delegation) errors are coded too', () => {
    expect(errorCodeFor('Domain-wide delegation is not configured correctly. Please check the setup steps and try again.').code).toBe('DELEGATION_NOT_CONFIGURED');
    expect(errorCodeFor('adminEmail must belong to the given domain').code).toBe('DELEGATION_EMAIL_DOMAIN');
    expect(errorCodeFor('domain and adminEmail required').code).toBe('BAD_REQUEST');
    expect(errorCodeFor('Too many delegation verification attempts. Try again in a few minutes.').code).toBe('RATE_LIMITED');
  });

  test('specific rules win over the generic buckets', () => {
    expect(errorCodeFor('A work email is required for the domain license — it tells us which domain to activate.').code).toBe('DOMAIN_EMAIL_REQUIRED');
    expect(errorCodeFor('Canvas instance URL and access token are required.').code).toBe('CANVAS_CREDENTIALS_REQUIRED');
    expect(errorCodeFor('Monthly export quota reached').code).toBe('EXPORT_QUOTA');
    expect(errorCodeFor('Canvas LMS grade sync is a Pro feature.').code).toBe('PRO_REQUIRED');
  });

  test('unknown or non-string messages have no code', () => {
    expect(errorCodeFor('some brand new message')).toBeNull();
    expect(errorCodeFor(undefined)).toBeNull();
    expect(RULES.length).toBeGreaterThan(50);
  });
});

describe('errorCodes middleware', () => {
  const run = (body) => {
    const sent = [];
    const res = { json: (b) => { sent.push(b); return 'sent'; } };
    const next = jest.fn();
    errorCodes({}, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.json(body)).toBe('sent');
    return sent[0];
  };

  test('adds code (and params) to mapped error bodies', () => {
    expect(run({ error: 'Session expired' })).toEqual({ error: 'Session expired', code: 'SESSION_EXPIRED' });
    expect(run({ error: 'You have reached your limit of 2 free exports this month.', upgrade: true }))
      .toEqual({ error: 'You have reached your limit of 2 free exports this month.', upgrade: true, code: 'EXPORT_QUOTA', params: { limit: 2 } });
  });

  test('leaves existing codes, unmapped errors and non-error bodies alone', () => {
    expect(run({ error: 'Token expired', code: 'AUTH_EXPIRED' })).toEqual({ error: 'Token expired', code: 'AUTH_EXPIRED' });
    expect(run({ error: 'brand new' })).toEqual({ error: 'brand new' });
    expect(run({ ok: true })).toEqual({ ok: true });
    expect(run(null)).toBeNull();
    expect(run([1, 2])).toEqual([1, 2]);
  });
});
