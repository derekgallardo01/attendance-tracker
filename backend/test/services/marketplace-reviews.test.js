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
