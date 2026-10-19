const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, reviewVerifier, origFetch;

beforeEach(() => {
  ctx = installFirestoreMock();
  origFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
  reviewVerifier = require('../../src/services/review-verifier');
});

afterEach(() => {
  global.fetch = origFetch;
  ctx.uninstall();
});

describe('isNameMatch', () => {
  test('matches exact and normalized names', () => {
    expect(reviewVerifier.isNameMatch('Jacob Swag', 'Jacob Swag', 'jacob@gmail.com')).toBe(true);
    expect(reviewVerifier.isNameMatch('jacob swag', 'Jacob Swag', 'jacob@gmail.com')).toBe(true);
    expect(reviewVerifier.isNameMatch('J S', 'Jacob Swag', 'jacob@gmail.com')).toBe(true);
    expect(reviewVerifier.isNameMatch('jacobswag', 'J', 'jacobswag93@gmail.com')).toBe(true);
  });

  test('does not match completely unrelated names', () => {
    expect(reviewVerifier.isNameMatch('Alice Wonder', 'Bob Builder', 'bob@gmail.com')).toBe(false);
    expect(reviewVerifier.isNameMatch('Mario Delgado', 'Jacob Swag', 'jacob@gmail.com')).toBe(false);
  });
});

describe('grantReviewReward & verifyUserReview', () => {
  test('grants 35 days of Pro to user doc and marks review redeemed', async () => {
    const userEmail = 'teacher@school.edu';
    ctx.seed('tenants/school.edu/users/teacher@school.edu', {
      email: userEmail,
      displayName: 'Jane Doe',
      reviewStatus: 'clicked',
    });

    const mockReview = {
      reviewId: 'rev-999',
      rating: 5,
      comment: 'Super useful!',
      authorName: 'Jane Doe',
      timestampMs: Date.now(),
    };

    ctx.seed('marketplace_reviews/rev-999', {
      ...mockReview,
      redeemed: false,
    });

    const res = await reviewVerifier.grantReviewReward('school.edu', userEmail, mockReview);
    expect(res.success).toBe(true);
    expect(res.email).toBe(userEmail);
    expect(res.reviewId).toBe('rev-999');

    // Check user doc in mock
    const userDoc = ctx.read('tenants/school.edu/users/teacher@school.edu');
    expect(userDoc.individualPlan).toBe('pro');
    expect(userDoc.individualBillingStatus).toBe('active');
    expect(userDoc.reviewStatus).toBe('verified_reviewed');
    expect(userDoc.reviewId).toBe('rev-999');

    // Check review doc
    const reviewDoc = ctx.read('marketplace_reviews/rev-999');
    expect(reviewDoc.redeemed).toBe(true);
    expect(reviewDoc.redeemedByEmail).toBe(userEmail);
  });

  test('activates Pro, creates localized draft, and alerts Derek without auto-sending to user', async () => {
    const notifications = require('../../src/lib/notifications');
    const spyUserEmail = jest.spyOn(notifications, 'sendReviewRewardEmail').mockResolvedValue({ sent: true, lang: 'es', id: 'resend-123' });
    const spyDraftAlert = jest.spyOn(notifications, 'sendReviewRewardDraftAlert').mockResolvedValue({ sent: true });

    const userEmail = 'profesor@escuela.mx';
    ctx.seed('tenants/escuela.mx/users/profesor@escuela.mx', {
      email: userEmail,
      displayName: 'Carlos Sanchez',
      signupGeo: { country: 'MX' },
      reviewStatus: 'clicked',
    });

    const mockReview = {
      reviewId: 'rev-mx-1',
      rating: 5,
      comment: 'Excelente herramienta para mis clases',
      authorName: 'Carlos Sanchez',
      timestampMs: Date.now(),
    };

    ctx.seed('marketplace_reviews/rev-mx-1', {
      ...mockReview,
      redeemed: false,
    });

    const res = await reviewVerifier.grantReviewReward('escuela.mx', userEmail, mockReview);
    expect(res.success).toBe(true);
    expect(res.emailPendingApproval).toBe(true);
    expect(res.draft).toBeDefined();
    expect(res.draft.lang).toBe('es');
    expect(res.draft.subject).toContain('Tu mes de Pro gratuito');

    // Email to user must NOT have been sent automatically
    expect(spyUserEmail).not.toHaveBeenCalled();

    // Admin alert to Derek must have been called with draft details
    expect(spyDraftAlert).toHaveBeenCalledWith(expect.objectContaining({
      to: 'derekgallardo01@gmail.com',
      userEmail,
      displayName: 'Carlos Sanchez',
      domain: 'escuela.mx',
      review: mockReview,
      draft: expect.objectContaining({
        lang: 'es',
        subject: expect.stringContaining('Tu mes de Pro gratuito'),
      }),
    }));

    // Verify user doc state
    const userDoc = ctx.read('tenants/escuela.mx/users/profesor@escuela.mx');
    expect(userDoc.individualPlan).toBe('pro');
    expect(userDoc.reviewRewardEmailSent).toBe(false);
    expect(userDoc.reviewRewardEmailPendingApproval).toBe(true);
    expect(userDoc.reviewRewardDraft.subject).toContain('Tu mes de Pro gratuito');

    spyUserEmail.mockRestore();
    spyDraftAlert.mockRestore();
  });

  test('grantReviewReward handles non-existent user doc, missing domain, and alert email error gracefully', async () => {
    const notifications = require('../../src/lib/notifications');
    const spyDraftAlert = jest.spyOn(notifications, 'sendReviewRewardDraftAlert').mockRejectedValue(new Error('smtp down'));

    const res = await reviewVerifier.grantReviewReward('', 'newreviewer@gmail.com', {
      reviewId: 'rev-err-1',
      rating: 5,
      authorName: 'New Reviewer',
    });
    expect(res.success).toBe(true);
    expect(ctx.read('tenants/gmail.com/users/newreviewer@gmail.com').individualPlan).toBe('pro');
    spyDraftAlert.mockRestore();
  });

  test('reconcilePendingReviews returns 0 when no unredeemed reviews exist', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 0, newlyDiscovered: 0, reviews: [] });

    const res = await reviewVerifier.reconcilePendingReviews();
    expect(res).toEqual({ reconciled: 0, candidatesChecked: 0 });
    syncSpy.mockRestore();
  });

  test('reconcilePendingReviews matches candidate users within 72h window and skips already-verified or out-of-window users', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 2, newlyDiscovered: 2, reviews: [] });
    const now = Date.now();

    ctx.seed('marketplace_reviews/rev-match-1', {
      reviewId: 'rev-match-1',
      rating: 5,
      comment: 'Awesome',
      authorName: 'Maria Lopez',
      timestampMs: now,
      redeemed: false,
    });
    ctx.seed('marketplace_reviews/rev-date-only', {
      reviewId: 'rev-date-only',
      rating: 5,
      comment: 'Great',
      authorName: 'Out OfWindow',
      date: new Date(now).toISOString(),
      redeemed: false,
    });

    // Already verified user (should enter candidateUsers via reviewLinkClickedAt and be skipped)
    ctx.seed('tenants/school.edu/users/already@school.edu', {
      displayName: 'Maria Lopez',
      individualPlan: 'pro',
      reviewStatus: 'verified_reviewed',
      reviewLinkClickedAt: new Date(now).toISOString(),
    });
    // Out-of-window user (>72h ago)
    ctx.seed('tenants/school.edu/users/out@school.edu', {
      displayName: 'Out OfWindow',
      reviewStatus: 'clicked',
      reviewLinkClickedAt: new Date(now - 100 * 3600 * 1000).toISOString(),
    });
    // Matching user within 72h window
    ctx.seed('tenants/school.edu/users/maria@school.edu', {
      displayName: 'Maria Lopez',
      reviewLinkClickedAt: new Date(now - 2 * 3600 * 1000).toISOString(),
    });

    const res = await reviewVerifier.reconcilePendingReviews();
    expect(res.reconciled).toBe(1);
    expect(res.totalPendingReviews).toBe(2);
    expect(res.candidatesChecked).toBe(3);
    expect(ctx.read('tenants/school.edu/users/maria@school.edu').individualPlan).toBe('pro');
    syncSpy.mockRestore();
  });

  test('verifyUserReview grants reward on match, returns alreadyVerified when already active, or no_matching_review_found', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 1, newlyDiscovered: 1, reviews: [] });

    ctx.seed('marketplace_reviews/rev-v-1', {
      reviewId: 'rev-v-1',
      rating: 5,
      comment: 'Nice!',
      authorName: 'Prof Kim',
      redeemed: false,
    });
    ctx.seed('tenants/uni.edu/users/kim@uni.edu', {
      displayName: 'Prof Kim',
    });

    // 1. Matches and grants
    const granted = await reviewVerifier.verifyUserReview('uni.edu', 'kim@uni.edu', 'Prof Kim');
    expect(granted.success).toBe(true);
    expect(granted.reviewId).toBe('rev-v-1');

    // 2. Subsequent call sees alreadyVerified
    const already = await reviewVerifier.verifyUserReview('uni.edu', 'kim@uni.edu');
    expect(already.success).toBe(true);
    expect(already.alreadyVerified).toBe(true);

    // 3. Unknown user with no matching review
    const miss = await reviewVerifier.verifyUserReview('', 'nobody@gmail.com');
    expect(miss.success).toBe(false);
    expect(miss.reason).toBe('no_matching_review_found');

    syncSpy.mockRestore();
  });

  test('grantReviewReward returns already_redeemed when review was claimed in concurrent transaction', async () => {
    ctx.seed('marketplace_reviews/rev-concurrent', {
      reviewId: 'rev-concurrent',
      redeemed: true,
      redeemedByEmail: 'prior@school.edu',
    });
    ctx.seed('tenants/school.edu/users/racer@school.edu', {
      displayName: 'Racer Student',
    });

    const res = await reviewVerifier.grantReviewReward('school.edu', 'racer@school.edu', {
      reviewId: 'rev-concurrent',
      authorName: 'Racer Student',
      rating: 5,
    });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('already_redeemed');
  });

  test('verifyUserReview with checkClickWindow enforces 72h window or authentication', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 1, newlyDiscovered: 0, reviews: [] });
    const now = Date.now();

    ctx.seed('marketplace_reviews/rev-window-1', {
      reviewId: 'rev-window-1',
      rating: 5,
      comment: 'Super!',
      authorName: 'Window User',
      redeemed: false,
    });

    // Case 1: No click and unauthenticated -> click_required
    ctx.seed('tenants/school.edu/users/noclick@school.edu', {
      displayName: 'Window User',
    });
    const resNoClick = await reviewVerifier.verifyUserReview('school.edu', 'noclick@school.edu', 'Window User', {
      checkClickWindow: true,
      isAuthenticated: false,
    });
    expect(resNoClick.success).toBe(false);
    expect(resNoClick.reason).toBe('click_required');

    // Case 2: Click older than 72 hours -> click_required
    ctx.seed('tenants/school.edu/users/oldclick@school.edu', {
      displayName: 'Window User',
      reviewLinkClickedAt: new Date(now - 80 * 3600 * 1000).toISOString(),
    });
    const resOldClick = await reviewVerifier.verifyUserReview('school.edu', 'oldclick@school.edu', 'Window User', {
      checkClickWindow: true,
      isAuthenticated: false,
    });
    expect(resOldClick.success).toBe(false);
    expect(resOldClick.reason).toBe('click_required');

    // Case 3: Click within 72 hours -> succeeds
    ctx.seed('tenants/school.edu/users/recentclick@school.edu', {
      displayName: 'Window User',
      reviewLinkClickedAt: new Date(now - 12 * 3600 * 1000).toISOString(),
    });
    const resRecent = await reviewVerifier.verifyUserReview('school.edu', 'recentclick@school.edu', 'Window User', {
      checkClickWindow: true,
      isAuthenticated: false,
    });
    expect(resRecent.success).toBe(true);
    expect(resRecent.reviewId).toBe('rev-window-1');

    // Case 4: Authenticated user without click -> succeeds
    ctx.seed('marketplace_reviews/rev-window-2', {
      reviewId: 'rev-window-2',
      rating: 5,
      authorName: 'Authed User',
      redeemed: false,
    });
    ctx.seed('tenants/school.edu/users/authed@school.edu', {
      displayName: 'Authed User',
    });
    const resAuthed = await reviewVerifier.verifyUserReview('school.edu', 'authed@school.edu', 'Authed User', {
      checkClickWindow: true,
      isAuthenticated: true,
    });
    expect(resAuthed.success).toBe(true);
    expect(resAuthed.reviewId).toBe('rev-window-2');

    syncSpy.mockRestore();
  });

  test('isNameMatch handles empty/non-string inputs', () => {
    expect(reviewVerifier.isNameMatch(null, 'Test', 'a@b.com')).toBe(false);
    expect(reviewVerifier.isNameMatch('!!!', 'Test', 'a@b.com')).toBe(false);
  });

  test('verifyUserReview for already verified user returns alreadyVerified without claiming pending matching reviews', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 1, newlyDiscovered: 0, reviews: [] });

    ctx.seed('marketplace_reviews/rev-unclaimed', {
      reviewId: 'rev-unclaimed',
      rating: 5,
      comment: 'Awesome tool!',
      authorName: 'Alex Reviewer',
      redeemed: false,
    });
    ctx.seed('tenants/school.edu/users/alex@school.edu', {
      displayName: 'Alex Reviewer',
      individualPlan: 'pro',
      reviewStatus: 'verified_reviewed',
      individualPlanExpiresAt: '2026-11-01T00:00:00.000Z',
    });

    const res = await reviewVerifier.verifyUserReview('school.edu', 'alex@school.edu', 'Alex Reviewer');
    expect(res.success).toBe(true);
    expect(res.alreadyVerified).toBe(true);
    expect(res.planExpiresAt).toBe('2026-11-01T00:00:00.000Z');

    // Ensure the review was NOT redeemed
    const revDoc = ctx.read('marketplace_reviews/rev-unclaimed');
    expect(revDoc.redeemed).toBe(false);

    syncSpy.mockRestore();
  });

  test('grantReviewReward transaction aborts when user already has verified_reviewed status', async () => {
    ctx.seed('marketplace_reviews/rev-second', {
      reviewId: 'rev-second',
      rating: 5,
      authorName: 'Jane Smith',
      redeemed: false,
    });
    ctx.seed('tenants/school.edu/users/jane@school.edu', {
      displayName: 'Jane Smith',
      individualPlan: 'pro',
      reviewStatus: 'verified_reviewed',
    });

    const res = await reviewVerifier.grantReviewReward('school.edu', 'jane@school.edu', {
      reviewId: 'rev-second',
      authorName: 'Jane Smith',
      rating: 5,
    });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('already_redeemed');

    const revDoc = ctx.read('marketplace_reviews/rev-second');
    expect(revDoc.redeemed).toBe(false);
  });

  test('concurrent verifyUserReview for the same review grants to first user and rejects second with already_redeemed', async () => {
    const marketplace = require('../../src/services/marketplace-reviews');
    const syncSpy = jest.spyOn(marketplace, 'syncMarketplaceReviews').mockResolvedValue({ total: 1, newlyDiscovered: 0, reviews: [] });

    ctx.seed('marketplace_reviews/rev-shared-race', {
      reviewId: 'rev-shared-race',
      rating: 5,
      comment: 'Excellent!',
      authorName: 'Chris Taylor',
      redeemed: false,
    });
    ctx.seed('tenants/school.edu/users/chris1@school.edu', {
      displayName: 'Chris Taylor',
      reviewStatus: 'clicked',
    });
    ctx.seed('tenants/school.edu/users/chris2@school.edu', {
      displayName: 'Chris Taylor',
      reviewStatus: 'clicked',
    });

    const [res1, res2] = await Promise.all([
      reviewVerifier.verifyUserReview('school.edu', 'chris1@school.edu', 'Chris Taylor'),
      reviewVerifier.verifyUserReview('school.edu', 'chris2@school.edu', 'Chris Taylor'),
    ]);

    const successful = [res1, res2].filter(r => r.success);
    const failed = [res1, res2].filter(r => !r.success);

    expect(successful).toHaveLength(1);
    expect(successful[0].reviewId).toBe('rev-shared-race');
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBe('already_redeemed');

    const revDoc = ctx.read('marketplace_reviews/rev-shared-race');
    expect(revDoc.redeemed).toBe(true);
    expect(['chris1@school.edu', 'chris2@school.edu']).toContain(revDoc.redeemedByEmail);

    syncSpy.mockRestore();
  });
});

