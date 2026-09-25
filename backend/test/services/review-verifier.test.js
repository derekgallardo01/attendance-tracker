const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, reviewVerifier;

beforeEach(() => {
  ctx = installFirestoreMock();
  reviewVerifier = require('../../src/services/review-verifier');
});

afterEach(() => {
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
});
