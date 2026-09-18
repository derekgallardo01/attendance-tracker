#!/usr/bin/env node
/**
 * scripts/sync-marketplace-reviews.cjs
 *
 * Scrapes Google Workspace Marketplace reviews for Attendance Tracker,
 * syncs them to Firestore, and automatically reconciles + rewards users
 * who left honest reviews with 1 month of Pro access.
 *
 * Usage:
 *   node scripts/sync-marketplace-reviews.cjs              # Fetch & reconcile automatically
 *   node scripts/sync-marketplace-reviews.cjs --dry-run    # Inspect reviews without changing Firestore
 */

// Safe fallbacks for CLI execution without full server env
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'cli-dummy';
process.env.OAUTH_CLIENT_SECRET_NAME = process.env.OAUTH_CLIENT_SECRET_NAME || 'cli-dummy';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'cli-dummy-session-secret-32-chars-ok';
process.env.SECRET_NAME = process.env.SECRET_NAME || 'cli-dummy';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'attendance-tracker-490319';

const path = require('path');
const { fetchLiveMarketplaceReviews, syncMarketplaceReviews } = require(path.resolve(__dirname, '../backend/src/services/marketplace-reviews'));
const { reconcilePendingReviews } = require(path.resolve(__dirname, '../backend/src/services/review-verifier'));

const isDryRun = process.argv.includes('--dry-run');

async function run() {
  console.log('=== GOOGLE WORKSPACE MARKETPLACE REVIEW SYNC ===');
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (read-only)' : 'LIVE (sync & reconcile)'}`);
  console.log('Fetching live reviews from Google Workspace Marketplace...');

  const reviews = await fetchLiveMarketplaceReviews();
  console.log(`\nFound ${reviews.length} total reviews on listing:`);

  reviews.forEach((r, idx) => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    console.log(`\n[${idx + 1}] ${r.authorName} (${stars}) - ${r.date}`);
    console.log(`    Review ID: ${r.reviewId}`);
    console.log(`    Comment: "${r.comment.replace(/\n/g, ' ')}"`);
  });

  if (isDryRun) {
    console.log('\n[Dry-Run] Skipping Firestore sync and reward reconciliation.');
    return;
  }

  console.log('\n--- Syncing to Firestore collection "marketplace_reviews" ---');
  const syncResult = await syncMarketplaceReviews(reviews);
  console.log(`Synced ${syncResult.total} reviews (${syncResult.newlyDiscovered} newly discovered).`);

  console.log('\n--- Reconciling reviews with users who clicked the review link ---');
  const reconResult = await reconcilePendingReviews();
  console.log(`Reconciliation complete!`);
  console.log(`- Pending reviews evaluated: ${reconResult.totalPendingReviews}`);
  console.log(`- Candidates checked: ${reconResult.candidatesChecked}`);
  console.log(`- Users newly matched & rewarded with 1 Month Pro: ${reconResult.reconciled}`);
}

run().catch((err) => {
  console.error('Fatal error running review sync:', err);
  process.exit(1);
});
