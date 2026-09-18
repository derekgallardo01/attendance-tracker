const log = require('../lib/logger');
const { getDb } = require('./firestore');
const { FieldValue } = require('@google-cloud/firestore');
const { syncMarketplaceReviews } = require('./marketplace-reviews');
const notifications = require('../lib/notifications');

const REWARD_DURATION_DAYS = 35; // Generous 1 month (gives buffer for billing cycles)

/**
 * Normalize string for fuzzy matching (lowercase, alphanumeric, collapsed spaces)
 */
function normalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Compute initials from a name (e.g. "Jacob Swag" -> "js", "John" -> "j")
 */
function getInitials(str) {
  if (!str || typeof str !== 'string') return '';
  const parts = str.trim().split(/\s+/).filter(Boolean);
  return parts.map(p => p[0].toLowerCase()).join('');
}

/**
 * Check if a review author name plausibly matches a user identity
 */
function isNameMatch(authorName, userDisplayName, userEmail) {
  if (!authorName) return false;
  const normAuthor = normalize(authorName);
  const normDisplay = normalize(userDisplayName);
  const emailUsername = normalize((userEmail || '').split('@')[0]);

  if (!normAuthor) return false;

  // 1. Exact or normalized full match
  if (normDisplay && (normAuthor === normDisplay || normAuthor.includes(normDisplay) || normDisplay.includes(normAuthor))) {
    return true;
  }

  // 2. Email username match (e.g. author "jacobswag" matches user "jacobswag93@gmail.com")
  if (emailUsername && (emailUsername.includes(normAuthor) || normAuthor.includes(emailUsername))) {
    return true;
  }

  // 3. Initials match (e.g. author "J S" matches displayName "Jacob Smith" or email username initials)
  const authorInitials = normAuthor.replace(/\s+/g, '');
  if (authorInitials.length >= 2 && normDisplay) {
    const userInitials = getInitials(userDisplayName);
    if (authorInitials === userInitials) return true;
  }

  return false;
}

/**
 * Grant Pro reward to a verified reviewer
 */
async function grantReviewReward(domain, email, review) {
  const db = getDb();
  const emailLower = email.toLowerCase();
  const domainLower = (domain || emailLower.split('@')[1] || 'gmail.com').toLowerCase();
  const userRef = db.collection('tenants').doc(domainLower).collection('users').doc(emailLower);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + REWARD_DURATION_DAYS * 24 * 60 * 60 * 1000);

  // Fetch existing user doc for personalization & localization metadata
  const existingDoc = await userRef.get();
  const userData = existingDoc.exists ? existingDoc.data() : {};

  // Update user document
  await userRef.set({
    individualPlan: 'pro',
    individualBillingStatus: 'active',
    individualPlanType: 'review_reward',
    individualPlanGrantedAt: now.toISOString(),
    individualPlanExpiresAt: expiresAt.toISOString(),
    reviewStatus: 'verified_reviewed',
    reviewVerifiedAt: now.toISOString(),
    reviewId: review.reviewId,
    reviewRating: review.rating,
    reviewText: review.comment || '',
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Mark review as redeemed in marketplace_reviews
  const reviewRef = db.collection('marketplace_reviews').doc(review.reviewId);
  await reviewRef.set({
    redeemed: true,
    redeemedByEmail: emailLower,
    redeemedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  log.info('review-verifier: granted review reward', { email: emailLower, reviewId: review.reviewId, rating: review.rating });

  // Send localized celebration & confirmation email to user
  let userEmailInfo = null;
  try {
    userEmailInfo = await notifications.sendReviewRewardEmail({
      to: emailLower,
      displayName: userData.displayName || review.authorName,
      domain: domainLower,
      country: userData.signupGeo?.country,
      language: userData.language,
      expiresAt: expiresAt.toISOString(),
      reviewId: review.reviewId,
      rating: review.rating,
    });
    log.info('review-verifier: sent user review reward email', {
      email: emailLower,
      sent: userEmailInfo?.sent,
      lang: userEmailInfo?.lang,
    });
  } catch (err) {
    log.warn('review-verifier: user reward email failed', { email: emailLower, error: err.message });
  }

  // Notify Derek via admin email
  try {
    const userEmailStatus = userEmailInfo && userEmailInfo.sent
      ? `YES (Language: ${userEmailInfo.lang || 'en'}, ID: ${userEmailInfo.id || 'ok'})`
      : 'NO / SKIPPED';

    await notifications.sendAdminEmail({
      to: 'derekgallardo01@gmail.com',
      subject: `⭐ Verified Marketplace Review: 1 Month Pro Granted to ${emailLower}`,
      body: `A Google Workspace Marketplace review has been verified and rewarded!

User Email: ${emailLower}
Review Author: ${review.authorName}
Rating: ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)} (${review.rating}/5)
Date: ${review.date || new Date(review.timestampMs).toISOString()}
Review Comment:
"${review.comment}"

Reward Granted:
- Tier: Pro (Individual)
- Duration: ${REWARD_DURATION_DAYS} days (Expires ${expiresAt.toISOString()})
- Review ID: ${review.reviewId}

User Confirmation Email:
- Sent to User: ${userEmailStatus}
`,
    });
  } catch (err) {
    log.warn('review-verifier: admin alert email failed', { error: err.message });
  }

  return {
    success: true,
    email: emailLower,
    reviewId: review.reviewId,
    planExpiresAt: expiresAt.toISOString(),
  };
}

/**
 * Scan all pending review clickers and match them with unredeemed marketplace reviews
 */
async function reconcilePendingReviews() {
  const db = getDb();

  // 1. Sync latest reviews
  await syncMarketplaceReviews();

  // 2. Fetch unredeemed reviews from Firestore
  const reviewsSnap = await db.collection('marketplace_reviews').where('redeemed', '==', false).get();
  const unredeemed = [];
  reviewsSnap.forEach(d => unredeemed.push(d.data()));

  if (unredeemed.length === 0) {
    log.info('review-verifier: no unredeemed reviews pending');
    return { reconciled: 0, candidatesChecked: 0 };
  }

  // 3. Find candidate users who clicked the review link
  const usersSnap = await db.collectionGroup('users').get();

  const candidateUsers = [];
  usersSnap.forEach(doc => {
    if (!doc.ref.parent || !doc.ref.parent.parent) return;
    const data = doc.data();
    if (data.reviewStatus === 'clicked' || data.reviewLinkClickedAt) {
      candidateUsers.push({
        email: doc.id.toLowerCase(),
        domain: doc.ref.parent.parent.id,
        displayName: data.displayName || '',
        reviewLinkClickedAt: data.reviewLinkClickedAt ? new Date(data.reviewLinkClickedAt) : null,
        individualPlan: data.individualPlan || null,
        reviewStatus: data.reviewStatus || null,
        ref: doc.ref,
      });
    }
  });

  log.info('review-verifier: checking candidates', {
    unredeemedReviews: unredeemed.length,
    candidateUsers: candidateUsers.length,
  });

  let reconciledCount = 0;

  for (const review of unredeemed) {
    const reviewTime = review.timestampMs ? new Date(review.timestampMs) : (review.date ? new Date(review.date) : null);

    // Look for matching candidate
    for (const user of candidateUsers) {
      if (user.individualPlan === 'pro' && user.reviewStatus === 'verified_reviewed') continue;

      const nameMatched = isNameMatch(review.authorName, user.displayName, user.email);
      let timeClose = true;

      // If we have click timestamp and review timestamp, check that click was within 48h before or after
      if (user.reviewLinkClickedAt && reviewTime) {
        const diffMs = Math.abs(reviewTime.getTime() - user.reviewLinkClickedAt.getTime());
        const maxDiffMs = 72 * 60 * 60 * 1000; // 72 hours window
        timeClose = diffMs <= maxDiffMs;
      }

      if (nameMatched && timeClose) {
        log.info('review-verifier: matched review to user', {
          email: user.email,
          authorName: review.authorName,
          reviewId: review.reviewId,
        });

        await grantReviewReward(user.domain, user.email, review);
        reconciledCount++;
        break; // Review is now redeemed, move to next review
      }
    }
  }

  return { reconciled: reconciledCount, totalPendingReviews: unredeemed.length, candidatesChecked: candidateUsers.length };
}

/**
 * Immediate verification for user clicking "I left a review" in-app
 */
async function verifyUserReview(domain, email, declaredName = null) {
  const db = getDb();
  const emailLower = email.toLowerCase();
  const domainLower = (domain || emailLower.split('@')[1] || 'gmail.com').toLowerCase();

  // Get user doc
  const userDoc = await db.collection('tenants').doc(domainLower).collection('users').doc(emailLower).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const searchName = declaredName || userData.displayName || emailLower.split('@')[0];

  // Sync latest reviews from Marketplace
  await syncMarketplaceReviews();

  // Find unredeemed reviews
  const reviewsSnap = await db.collection('marketplace_reviews').where('redeemed', '==', false).get();
  const unredeemed = [];
  reviewsSnap.forEach(d => unredeemed.push(d.data()));

  // Look for match
  for (const review of unredeemed) {
    if (isNameMatch(review.authorName, searchName, emailLower)) {
      return await grantReviewReward(domainLower, emailLower, review);
    }
  }

  // Also check if this user already had a verified review
  if (userData.reviewStatus === 'verified_reviewed' && userData.individualPlan === 'pro') {
    return {
      success: true,
      alreadyVerified: true,
      email: emailLower,
      planExpiresAt: userData.individualPlanExpiresAt,
    };
  }

  return {
    success: false,
    reason: 'no_matching_review_found',
    message: 'We could not find a new review under that name yet. It may take a couple of minutes for Google to publish it on the listing. Please check back shortly!',
  };
}

module.exports = {
  isNameMatch,
  grantReviewReward,
  reconcilePendingReviews,
  verifyUserReview,
  REWARD_DURATION_DAYS,
};
