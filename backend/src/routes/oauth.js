const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { exchangeCode, revokeToken } = require('../services/googleAuth');
const { upsertUser, getUser, updateUserTokens, logEvent, getUserActivationStatus, getUserTrackingStreak, getTenantConfig, deleteUser } = require('../services/firestore');
const { domainOf } = require('../services/firestore/_core'); // pure util; imported directly so test firestore-mocks needn't stub it
const { flushDeferredNotifications } = require('../lib/notifications');

const { ACQUISITION_SOURCES } = require('../lib/constants');

const router = Router();

// Scopes the app needs to deliver each feature. If any of these are missing
// after consent, the frontend disables the affected feature and prompts the
// user to re-authorize.
const REQUIRED_SCOPES_BY_FEATURE = {
  meet: 'https://www.googleapis.com/auth/meetings.space.readonly',
  sheets: 'https://www.googleapis.com/auth/drive.file',
  calendar: 'https://www.googleapis.com/auth/calendar.events.readonly',
};

// The account routes below (/me, /revoke, /delete-account) live on this
// pre-auth router so /exchange can stay open — they can't use the global auth
// middleware. They share this verifier for the happy path: pull the Bearer
// session JWT and return its decoded payload (with domain filled in), or null
// when there's no Bearer header. A malformed/expired token throws out of
// jwt.verify and is handled by each route's own catch (which intentionally
// differ — /revoke maps token errors to 500, the others to 401).
function decodeSession(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const decoded = jwt.verify(authHeader.slice(7), CONFIG.sessionSecret);
  decoded.domain = decoded.domain || domainOf(decoded.email);
  return decoded;
}

function computeMissingScopes(granted) {
  const grantedSet = new Set((granted || '').split(/\s+/).filter(Boolean));
  const missing = [];
  for (const [feature, scope] of Object.entries(REQUIRED_SCOPES_BY_FEATURE)) {
    if (!grantedSet.has(scope)) missing.push({ feature, scope });
  }
  return missing;
}

// POST /api/oauth/exchange — swap authorization code for session token
router.post('/exchange', async (req, res) => {
  try {
    const { code, acquisition } = req.body;
    if (!code) return res.status(400).json({ error: 'Authorization code required' });

    // Exchange code for Google tokens
    const tokens = await exchangeCode(code);

    // Verify ID token to get user info
    const ticket = await new google.auth.OAuth2(CONFIG.googleClientId)
      .verifyIdToken({ idToken: tokens.id_token, audience: CONFIG.googleClientId });
    const payload = ticket.getPayload();

    const email = payload.email;
    const domain = payload.hd || domainOf(email);
    const displayName = payload.name || email;

    // Check which of the scopes we asked for were actually granted.
    // Google's consent screen lets users selectively uncheck non-sensitive
    // scopes, which silently breaks features later if we don't detect it.
    const grantedScopes = (tokens.scope || '').split(/\s+/).filter(Boolean);
    const missingScopes = computeMissingScopes(tokens.scope);
    if (missingScopes.length > 0) {
      log.warn('oauth: user granted partial scopes', { email, missing: missingScopes.map(m => m.feature) });
    }

    // Sanitize acquisition payload from the client. Only known sources pass;
    // UTM fields are length-capped to keep arbitrary blobs out of Firestore.
    const trim = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
    const trimLong = (v) => (typeof v === 'string' ? v.slice(0, 500) : undefined);
    // Only accept ref values that look like an email — that's all the
    // celebrate-modal mints. Drops arbitrary strings on the floor.
    const trimRef = (v) => {
      if (typeof v !== 'string') return undefined;
      const s = v.slice(0, 200);
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : undefined;
    };
    const sanitizedAcq = acquisition ? {
      source: ACQUISITION_SOURCES.has(acquisition.source) ? acquisition.source : undefined,
      utmSource:   trim(acquisition.utmSource),
      utmMedium:   trim(acquisition.utmMedium),
      utmCampaign: trim(acquisition.utmCampaign),
      ref:         trimRef(acquisition.ref),
      referrer:    trim(acquisition.referrer),
      landingUrl:  trimLong(acquisition.landingUrl),
      userAgent:   trimLong(acquisition.userAgent),
    } : undefined;

    // Decide whether the client needs to show the "how did you find us?" modal.
    // It does if (a) the user is brand new, or (b) an existing user still has
    // no acquisitionSource on their doc (we can't auto-derive one from UTMs).
    const existingUser = await getUser(domain, email);
    const isBrandNewUser = !existingUser;
    const alreadyHasSource = !!(existingUser?.acquisitionSource);
    const willCaptureFromUTM = !alreadyHasSource && !!sanitizedAcq?.utmSource;
    const needsAcquisitionSource = !alreadyHasSource && !willCaptureFromUTM;

    // Auto-detect an acquisition source from the entry point. Priority: explicit
    // user-reported source > ?ref= invite > UTM > referrer hostname > "direct"
    // (fallback when only userAgent is known — e.g. entering via the in-Meet
    // add-on, which carries no web referrer). Computed here (before the upsert)
    // so it can be both stamped on a brand-new user's doc for the deferred
    // signup notification AND returned to the frontend for a source-aware
    // welcome ("saw you came from Reddit").
    let refHost = null;
    if (sanitizedAcq?.referrer) {
      // A successfully-parsed http(s) referrer always has a non-empty hostname,
      // so the `|| null` fallback is defensive-only.
      /* istanbul ignore next */
      try { refHost = new URL(sanitizedAcq.referrer).hostname || null; } catch { /* ignore */ }
    }
    const detectedSource = sanitizedAcq?.source
      || (sanitizedAcq?.ref ? `invite:${sanitizedAcq.ref}` : null)
      || (sanitizedAcq?.utmSource ? `utm:${sanitizedAcq.utmSource}` : null)
      || (refHost ? `ref:${refHost}` : null)
      || (sanitizedAcq?.userAgent ? 'direct' : null);

    // Store user + tokens in tenant-scoped Firestore
    await upsertUser(domain, {
      email,
      displayName,
      refreshToken: tokens.refresh_token || undefined,
      acquisition: sanitizedAcq,
      // Persist scopes so we can see who lacks the Drive (export) scope.
      scopes: {
        granted: grantedScopes,
        exportScopeGranted: grantedScopes.includes(REQUIRED_SCOPES_BY_FEATURE.sheets),
      },
      // Only meaningful for a brand-new user: seeds the deferred signup ping.
      signupDetectedSource: isBrandNewUser ? detectedSource : undefined,
    });

    // Per-user signin event — feeds the activity log and "most active this
    // month" view. Fire-and-forget; failure here must not break sign-in.
    logEvent(domain, { email, type: 'signin' });

    // Always store the fresh access token from the exchange
    if (tokens.access_token) {
      await updateUserTokens(domain, email, {
        accessToken: tokens.access_token,
        tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3600 * 1000),
      });
    }

    // Issue backend session JWT (8 hour expiry — covers full-day meetings)
    const sessionToken = jwt.sign(
      { email, domain, displayName },
      CONFIG.sessionSecret,
      { expiresIn: '8h' }
    );

    log.info('oauth: user authenticated', { email, domain });

    res.json({
      sessionToken, email, displayName, grantedScopes, missingScopes,
      needsAcquisitionSource,
      detectedSource,
      isNewUser: isBrandNewUser,
    });

    // Signup notification is deferred (see upsertUser): we'd rather the email
    // carry the user's self-reported source than the auto-detected fallback.
    // The "how did you find us?" modal POSTs to /api/admin/source within seconds
    // and flushes it. This grace timer is the fallback for users who dismiss the
    // modal — after a short window we send with the detected source only. The
    // flush is claimed transactionally, so whichever trigger fires first wins
    // and the rest no-op. Unref'd so it never holds the process open.
    if (isBrandNewUser) {
      const graceMs = Number(process.env.SIGNUP_NOTIFY_GRACE_MS) || 120000;
      const timer = setTimeout(() => {
        flushDeferredNotifications(domain, email);
      }, graceMs);
      timer.unref?.();
    }
  } catch (err) {
    log.error('oauth: exchange failed', { error: err.message });
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// GET /api/oauth/me — current user's activation status for in-product nudges.
// Also returns the teamAdmin flag so the frontend can conditionally show
// the Team admin link in the nav (only visible to org admins).
router.get('/me', async (req, res) => {
  try {
    const decoded = decodeSession(req);
    if (!decoded) return res.status(401).json({ error: 'Not authenticated' });
    const domain = decoded.domain;
    const [status, user, weeklyStreak] = await Promise.all([
      getUserActivationStatus(domain, decoded.email),
      getUser(domain, decoded.email),
      getUserTrackingStreak(domain, decoded.email),
    ]);
    res.json({
      email: decoded.email,
      domain,
      teamAdmin: !!user?.teamAdmin,
      weeklyStreak,
      ...status,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired' });
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    log.error('oauth: me failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch user status' });
  }
});

// POST /api/oauth/revoke — sign out and revoke refresh token
router.post('/revoke', async (req, res) => {
  try {
    const decoded = decodeSession(req);
    if (!decoded) return res.status(401).json({ error: 'Not authenticated' });
    const domain = decoded.domain;
    const user = await getUser(domain, decoded.email);

    if (user?.refreshToken) {
      await revokeToken(user.refreshToken);
    }

    log.info('oauth: user signed out', { email: decoded.email });
    res.json({ success: true });
  } catch (err) {
    log.error('oauth: revoke failed', { error: err.message });
    res.status(500).json({ error: 'Sign out failed' });
  }
});

// POST /api/oauth/delete-account — self-serve account + data deletion.
// Revokes the Google refresh token, then cascades a full PII delete (user doc,
// settings, events, notes, outreach, reminders, idempotency slots, and the
// user's participant records across meetings). Marketplace / GDPR compliance:
// the user controls their own data without emailing us. The caller must present
// a valid session; the request always acts on the authenticated identity, never
// an arbitrary email in the body.
router.post('/delete-account', async (req, res) => {
  try {
    const decoded = decodeSession(req);
    if (!decoded) return res.status(401).json({ error: 'Not authenticated' });
    const email = decoded.email;
    const domain = decoded.domain;

    // Best-effort token revoke first so we stop being able to act as them.
    try {
      const user = await getUser(domain, email);
      if (user?.refreshToken) await revokeToken(user.refreshToken);
    } catch (e) {
      log.warn('oauth: delete-account revoke failed (continuing)', { email, error: e.message });
    }

    const result = await deleteUser(domain, email); // cascades all PII
    if (!result?.ok) {
      // Partial failure: some PII may remain. Don't falsely report a complete
      // deletion — surface an error so the client (and the user) can retry.
      log.error('oauth: account deletion incomplete', { email });
      return res.status(500).json({ error: 'Account deletion did not fully complete. Please try again.' });
    }
    log.info('oauth: account deleted by user', { email });
    res.json({ success: true });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired' });
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    log.error('oauth: delete-account failed', { error: err.message });
    res.status(500).json({ error: 'Account deletion failed' });
  }
});

module.exports = router;
