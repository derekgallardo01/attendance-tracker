const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { exchangeCode, revokeToken } = require('../services/googleAuth');
const { upsertUser, getUser, updateUserTokens, logEvent } = require('../services/firestore');

// Allow-list for self-reported acquisition source. Anything not on this list
// is dropped so we don't end up storing arbitrary strings from the wire.
const ACQUISITION_SOURCES = new Set([
  'google_search', 'marketplace', 'reddit', 'youtube', 'friend', 'other',
]);

const router = Router();

// Scopes the app needs to deliver each feature. If any of these are missing
// after consent, the frontend disables the affected feature and prompts the
// user to re-authorize.
const REQUIRED_SCOPES_BY_FEATURE = {
  meet: 'https://www.googleapis.com/auth/meetings.space.readonly',
  sheets: 'https://www.googleapis.com/auth/drive.file',
  calendar: 'https://www.googleapis.com/auth/calendar.events.readonly',
};

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
    const domain = payload.hd || email.split('@')[1];
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
    const sanitizedAcq = acquisition ? {
      source: ACQUISITION_SOURCES.has(acquisition.source) ? acquisition.source : undefined,
      utmSource:   trim(acquisition.utmSource),
      utmMedium:   trim(acquisition.utmMedium),
      utmCampaign: trim(acquisition.utmCampaign),
      referrer:    trim(acquisition.referrer),
    } : undefined;

    // Decide whether the client needs to show the "how did you find us?" modal.
    // It does if (a) the user is brand new, or (b) an existing user still has
    // no acquisitionSource on their doc (we can't auto-derive one from UTMs).
    const existingUser = await getUser(domain, email);
    const alreadyHasSource = !!(existingUser?.acquisitionSource);
    const willCaptureFromUTM = !alreadyHasSource && !!sanitizedAcq?.utmSource;
    const needsAcquisitionSource = !alreadyHasSource && !willCaptureFromUTM;

    // Store user + tokens in tenant-scoped Firestore
    await upsertUser(domain, {
      email,
      displayName,
      refreshToken: tokens.refresh_token || undefined,
      acquisition: sanitizedAcq,
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
    res.json({ sessionToken, email, displayName, grantedScopes, missingScopes, needsAcquisitionSource });
  } catch (err) {
    log.error('oauth: exchange failed', { error: err.message });
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// POST /api/oauth/revoke — sign out and revoke refresh token
router.post('/revoke', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(authHeader.slice(7), CONFIG.sessionSecret);
    const domain = decoded.domain || decoded.email.split('@')[1];
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

module.exports = router;
