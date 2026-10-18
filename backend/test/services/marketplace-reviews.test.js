const { parseMarketplaceReviews } = require('../../src/services/marketplace-reviews');

describe('parseMarketplaceReviews', () => {
  test('returns empty array for invalid or empty HTML', () => {
    expect(parseMarketplaceReviews('')).toEqual([]);
    expect(parseMarketplaceReviews(null)).toEqual([]);
    expect(parseMarketplaceReviews('<html><body>No reviews here</body></html>')).toEqual([]);
  });

  test('parses single and multiple reviews with escaping', () => {
    const sampleHtml = `
      <div>Random markup</div>
      [[["829771833968","14544567541958962376"],5,"works great. i like it",1789616505461,1,null,["J S","//lh3.googleusercontent.com/avatar1"]]]
      more content
      [[["829771833968","09041231362912933019"],4,"Very helpful &amp; clean!\\nRecommended.",1786372871452,1,null,["Mario D","//lh3.googleusercontent.com/avatar2"]]]
    `;

    const reviews = parseMarketplaceReviews(sampleHtml, '829771833968');
    expect(reviews).toHaveLength(2);

    expect(reviews[0].reviewId).toBe('14544567541958962376');
    expect(reviews[0].rating).toBe(5);
    expect(reviews[0].comment).toBe('works great. i like it');
    expect(reviews[0].authorName).toBe('J S');
    expect(reviews[0].timestampMs).toBe(1789616505461);

    expect(reviews[1].reviewId).toBe('09041231362912933019');
    expect(reviews[1].rating).toBe(4);
    expect(reviews[1].comment).toContain('Very helpful');
    expect(reviews[1].comment).toContain('\nRecommended.');
    expect(reviews[1].authorName).toBe('Mario D');
  });

  test('deduplicates duplicate review entries in HTML', () => {
    const duplicateHtml = `
      [[["829771833968","111111"],5,"Great",1789616505461,1,null,["Alice","//lh3/a"]]]
      [[["829771833968","111111"],5,"Great",1789616505461,1,null,["Alice","//lh3/a"]]]
    `;
    const reviews = parseMarketplaceReviews(duplicateHtml, '829771833968');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewId).toBe('111111');
  });
});

describe('fetchLiveMarketplaceReviews & syncMarketplaceReviews', () => {
  const { installFirestoreMock } = require('../helpers/firestoreMock');
  let ctx, mp;
  let origFetch;

  beforeEach(() => {
    ctx = installFirestoreMock();
    origFetch = global.fetch;
    mp = require('../../src/services/marketplace-reviews');
  });

  afterEach(() => {
    global.fetch = origFetch;
    ctx.uninstall();
  });

  test('fetchLiveMarketplaceReviews deduplicates across locales and handles non-ok and thrown fetch errors', async () => {
    let callCount = 0;
    global.fetch = jest.fn(async (url) => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          text: async () => '[[["829771833968","999111"],5,"Great add-on",1789616505461,1,null,["Alice","//lh3/a"]]]',
        };
      }
      if (callCount === 2) {
        return { ok: false, status: 503 };
      }
      if (callCount === 3) {
        throw new Error('network timeout');
      }
      return {
        ok: true,
        text: async () => '[[["829771833968","999111"],5,"Great add-on",1789616505461,1,null,["Alice","//lh3/a"]]]',
      };
    });

    const reviews = await mp.fetchLiveMarketplaceReviews('https://example.com/app?foo=1');
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reviewId).toBe('999111');
  });

  test('syncMarketplaceReviews returns empty when no reviews and inserts/updates when reviews exist', async () => {
    const emptyRes = await mp.syncMarketplaceReviews([]);
    expect(emptyRes).toEqual({ total: 0, newlyDiscovered: 0, reviews: [] });

    const sample = [
      { reviewId: 'r1', rating: 5, comment: 'Initial', authorName: 'Bob', avatarUrl: '//a', timestampMs: 1000 },
    ];
    const firstSync = await mp.syncMarketplaceReviews(sample);
    expect(firstSync.total).toBe(1);
    expect(firstSync.newlyDiscovered).toBe(1);
    expect(ctx.read('marketplace_reviews/r1').redeemed).toBe(false);

    // Update existing review without touching redeemed status
    ctx.seed('marketplace_reviews/r1', { ...ctx.read('marketplace_reviews/r1'), redeemed: true });
    const updatedSample = [
      { reviewId: 'r1', rating: 4, comment: 'Updated comment', authorName: 'Bob B', avatarUrl: '//b', timestampMs: 1000 },
    ];
    const secondSync = await mp.syncMarketplaceReviews(updatedSample);
    expect(secondSync.total).toBe(1);
    expect(secondSync.newlyDiscovered).toBe(0);
    expect(ctx.read('marketplace_reviews/r1').comment).toBe('Updated comment');
    expect(ctx.read('marketplace_reviews/r1').redeemed).toBe(true);
  });
});

