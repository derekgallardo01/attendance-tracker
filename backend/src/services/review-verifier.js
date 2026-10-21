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

  const reviewRef = db.collection('marketplace_reviews').doc(review.reviewId);
  let userData = {};
  let draft;

  const claimed = await db.runTransaction(async (tx) => {
    const reviewSnap = await tx.get(reviewRef);
    if (reviewSnap.exists && reviewSnap.data()?.redeemed) {
      log.warn('review-verifier: review already redeemed in transaction', { reviewId: review.reviewId });
      return false;
    }

    const existingDoc = await tx.get(userRef);
    if (existingDoc.exists && existingDoc.data()?.reviewStatus === 'verified_reviewed') return false;
    userData = existingDoc.exists ? existingDoc.data() : {};

    draft = notifications.buildReviewRewardEmailContent({
      to: emailLower,
      displayName: userData.displayName || review.authorName,
      domain: domainLower,
      country: userData.signupGeo?.country,
      language: userData.language,
      expiresAt: expiresAt.toISOString(),
      reviewId: review.reviewId,
      rating: review.rating,
    });

    tx.set(userRef, {
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
      reviewRewardEmailSent: false,
      reviewRewardEmailPendingApproval: true,
      reviewRewardDraft: {
        subject: draft.subject,
        text: draft.text,
        lang: draft.lang,
        from: draft.from,
        replyTo: draft.replyTo,
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(reviewRef, {
      redeemed: true,
      redeemedByEmail: emailLower,
      redeemedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return true;
  });

  if (!claimed) {
    return {
      success: false,
      reason: 'already_redeemed',
      message: 'This review has already been claimed.',
    };
  }

  try {
    const { invalidateUserPlanCache } = require('../routes/billing');
    if (typeof invalidateUserPlanCache === 'function') {
      invalidateUserPlanCache(domainLower, emailLower);
    }
  } catch (err) {
    log.warn('review-verifier: failed to invalidate user plan cache', { error: err.message });
  }

  log.info('review-verifier: granted review reward (Pro active, email pending admin review)', {
    email: emailLower,
    reviewId: review.reviewId,
    rating: review.rating,
  });

  // Alert Derek with full review details + draft email to review before sending
  try {
    await notifications.sendReviewRewardDraftAlert({
      to: 'derekgallardo01@gmail.com',
      userEmail: emailLower,
      domain: domainLower,
      displayName: userData.displayName || review.authorName,
      review,
      expiresAt: expiresAt.toISOString(),
      draft,
    });
    log.info('review-verifier: sent review draft alert to Derek', { email: emailLower, reviewId: review.reviewId });
  } catch (err) {
    log.warn('review-verifier: admin draft alert email failed', { error: err.message });
  }

  return {
    success: true,
    email: emailLower,
    reviewId: review.reviewId,
    planExpiresAt: expiresAt.toISOString(),
    emailPendingApproval: true,
    draft,
  };
}

/**
 * Scan all pending review clickers and match them with unredeemed marketplace reviews
 */
async function reconcilePendingReviews(preloadedUsers = null) {
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
  const candidateUsers = [];
  if (Array.isArray(preloadedUsers)) {
    for (const u of preloadedUsers) {
      if (!u || !u.email || !u.domain) continue;
      if (u.reviewStatus === 'clicked' || u.reviewLinkClickedAt) {
        candidateUsers.push({
          email: u.email.toLowerCase(),
          domain: u.domain,
          displayName: u.displayName || '',
          reviewLinkClickedAt: u.reviewLinkClickedAt ? new Date(u.reviewLinkClickedAt) : null,
          individualPlan: u.individualPlan || null,
          reviewStatus: u.reviewStatus || null,
        });
      }
    }
  } else {
    const usersSnap = await db.collectionGroup('users').get();
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
  }

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
async function verifyUserReview(domain, email, declaredName = null, options = {}) {
  const db = getDb();
  const emailLower = email.toLowerCase();
  const domainLower = (domain || emailLower.split('@')[1] || 'gmail.com').toLowerCase();

  // Get user doc
  const userDoc = await db.collection('tenants').doc(domainLower).collection('users').doc(emailLower).get();
  const userData = userDoc.exists ? userDoc.data() : {};

  // Check if this user already had a verified review
  if (userData.reviewStatus === 'verified_reviewed' && userData.individualPlan === 'pro') {
    return {
      success: true,
      alreadyVerified: true,
      email: emailLower,
      planExpiresAt: userData.individualPlanExpiresAt,
    };
  }

  const searchName = declaredName || userData.displayName || emailLower.split('@')[0];

  // Validate reviewLinkClickedAt within the last 72 hours, or require authenticated request
  if (options.checkClickWindow) {
    const isAuthenticated = options.isAuthenticated === true;
    const clickTime = userData.reviewLinkClickedAt ? new Date(userData.reviewLinkClickedAt).getTime() : 0;
    const isRecentClick = clickTime > 0 && (Date.now() - clickTime) <= 72 * 60 * 60 * 1000;
    if (!isAuthenticated && !isRecentClick) {
      log.info('review-verifier: click verification required or expired', {
        email: emailLower,
        hasClick: !!userData.reviewLinkClickedAt,
        clickTime,
      });
      return {
        success: false,
        reason: 'click_required',
        message: 'Please click the "Leave a review" link first before verifying your review.',
      };
    }
  }

  // Sync latest reviews from Marketplace
  await syncMarketplaceReviews();

  // Find unredeemed reviews
  const reviewsSnap = await db.collection('marketplace_reviews').where('redeemed', '==', false).get();
  const unredeemed = [];
  reviewsSnap.forEach(d => unredeemed.push(d.data()));

  // Look for match (review must be within the last 14 days when date/timestamp is present)
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  for (const review of unredeemed) {
    const rawDate = review.timestampMs || review.createdAt || review.date;
    if (rawDate) {
      const reviewMs = typeof rawDate === 'number'
        ? rawDate
        : (typeof rawDate?.toDate === 'function' ? rawDate.toDate().getTime() : new Date(rawDate).getTime());
      if (Number.isFinite(reviewMs) && reviewMs > 0 && (nowMs - reviewMs) > FOURTEEN_DAYS_MS) {
        continue;
      }
    }
    if (isNameMatch(review.authorName, searchName, emailLower)) {
      return await grantReviewReward(domainLower, emailLower, review);
    }
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
