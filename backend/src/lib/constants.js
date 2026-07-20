// Cross-route shared constants — one source of truth so allow-lists can't drift
// between the endpoint that WRITES a value and the one that VALIDATES an edit.

// Allow-list for self-reported acquisition source. Anything not on this list is
// dropped so we don't store arbitrary strings from the wire. Written at signup
// (routes/oauth.js) and re-validated on admin edit (routes/admin.js) — they must
// agree, hence a single Set.
const ACQUISITION_SOURCES = new Set([
  'google_search', 'marketplace', 'reddit', 'youtube', 'friend', 'other',
]);

module.exports = { ACQUISITION_SOURCES };
