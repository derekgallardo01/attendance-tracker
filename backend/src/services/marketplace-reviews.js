const log = require('../lib/logger');
const { getDb } = require('./firestore');
const { FieldValue } = require('@google-cloud/firestore');

const DEFAULT_APP_ID = '829771833968';
const MARKETPLACE_URL = `https://workspace.google.com/marketplace/app/attendance_tracker/${DEFAULT_APP_ID}`;

/**
 * Parse structured reviews out of Google Workspace Marketplace HTML.
 * Google embeds review payloads as nested arrays inside script tags or data attributes:
 * [[["829771833968","<reviewId>"],<rating>,"<comment>",<timestampMs>,1,null,["<authorName>","<avatarUrl>"]]]
 *
 * @param {string} html
 * @param {string} appId
 * @returns {Array<{reviewId: string, rating: number, comment: string, timestampMs: number, date: string, authorName: string, avatarUrl: string}>}
 */
function parseMarketplaceReviews(html, appId = DEFAULT_APP_ID) {
  if (!html || typeof html !== 'string') return [];

  // Match review tuples: [[["appId", "reviewId"], rating, "comment", timestampMs, ... ["author", "avatar"]]]
  const escapedAppId = appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reviewPattern = new RegExp(
    `\\[\\["${escapedAppId}",\\s*"(\\d+)"\\],\\s*(\\d+),\\s*"([^"]*)",\\s*(\\d+),\\s*\\d+,\\s*null,\\s*\\["([^"]+)",\\s*"([^"]+)"\\]`,
    'g'
  );

  const reviews = [];
  let match;
  while ((match = reviewPattern.exec(html)) !== null) {
    const timestampMs = parseInt(match[4], 10);
    // Unescape common JSON/HTML escapes in comment and authorName
    const cleanComment = match[3]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&');
    const cleanAuthor = match[5]
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, '&');
    const cleanAvatar = match[6]
      .replace(/\\u003d/g, '=')
      .replace(/\\u0026/g, '&');

    reviews.push({
      reviewId: match[1],
      rating: parseInt(match[2], 10),
      comment: cleanComment,
      timestampMs,
      date: isNaN(timestampMs) ? null : new Date(timestampMs).toISOString(),
      authorName: cleanAuthor,
      avatarUrl: cleanAvatar,
    });
  }

  // Deduplicate by reviewId just in case
  const seen = new Set();
  const deduped = [];
  for (const r of reviews) {
    if (!seen.has(r.reviewId)) {
      seen.add(r.reviewId);
      deduped.push(r);
    }
  }

  return deduped.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
}

const REVIEW_LOCALES = ['en', 'es', 'pt'];

/**
 * Fetch the public Marketplace page and extract live reviews across supported locales.
 *
 * @param {string} [baseUrl]
 * @returns {Promise<Array>}
 */
async function fetchLiveMarketplaceReviews(baseUrl = MARKETPLACE_URL) {
  const allReviews = [];
  const seen = new Set();

  for (const loc of REVIEW_LOCALES) {
    try {
      const locUrl = baseUrl.includes('?') ? `${baseUrl}&hl=${loc}` : `${baseUrl}?hl=${loc}`;
      const res = await fetch(locUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept-Language': `${loc},en;q=0.8`,
        },
      });

      if (!res.ok) {
        log.warn('marketplace-reviews: fetch failed with status', { status: res.status, loc });
        continue;
      }

      const html = await res.text();
      const reviews = parseMarketplaceReviews(html);
      for (const r of reviews) {
        if (!seen.has(r.reviewId)) {
          seen.add(r.reviewId);
          allReviews.push(r);
        }
      }
    } catch (err) {
      log.error('marketplace-reviews: error fetching reviews', { error: err.message, loc });
    }
  }

  log.info('marketplace-reviews: fetched live reviews', { count: allReviews.length });
  return allReviews.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
}

/**
 * Sync fetched reviews to the `marketplace_reviews` collection in Firestore.
 * Preserves existing redemption states.
 *
 * @param {Array} [optionalReviews]
 * @returns {Promise<{total: number, newlyDiscovered: number, reviews: Array}>}
 */
async function syncMarketplaceReviews(optionalReviews = null) {
  const reviews = optionalReviews || (await fetchLiveMarketplaceReviews());
  if (!reviews || reviews.length === 0) {
    return { total: 0, newlyDiscovered: 0, reviews: [] };
  }

  const db = getDb();
  let newlyDiscovered = 0;

  for (const rev of reviews) {
    const ref = db.collection('marketplace_reviews').doc(rev.reviewId);
    const existing = await ref.get();
    if (!existing.exists) {
      newlyDiscovered++;
      await ref.set({
        ...rev,
        firstSeenAt: FieldValue.serverTimestamp(),
        redeemed: false,
        redeemedByEmail: null,
        redeemedAt: null,
      });
    } else {
      // Update metadata (like updated comment/rating if modified) without touching redemption fields
      const data = existing.data();
      await ref.update({
        rating: rev.rating,
        comment: rev.comment,
        authorName: rev.authorName,
        avatarUrl: rev.avatarUrl,
        lastSyncedAt: FieldValue.serverTimestamp(),
      });
    }
  }

  return { total: reviews.length, newlyDiscovered, reviews };
}

module.exports = {
  parseMarketplaceReviews,
  fetchLiveMarketplaceReviews,
  syncMarketplaceReviews,
  DEFAULT_APP_ID,
  MARKETPLACE_URL,
};
