const { Router } = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { exchangeCode, revokeToken } = require('../services/googleAuth');
const { upsertUser, getUser, updateUserTokens } = require('../services/firestore');

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
    const { code } = req.body;
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

    // Store user + tokens in tenant-scoped Firestore
    await upsertUser(domain, {
      email,
      displayName,
      refreshToken: tokens.refresh_token || undefined,
    });

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
    res.json({ sessionToken, email, displayName, grantedScopes, missingScopes });
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
