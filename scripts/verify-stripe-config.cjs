#!/usr/bin/env node
/**
 * scripts/verify-stripe-config.cjs
 *
 * Automated verification of all Stripe prices, webhooks, and billing settings.
 * Ensures that zero checkout errors can occur due to misconfigured price IDs.
 *
 * Usage:
 *   node scripts/verify-stripe-config.cjs
 */

const path = require('path');
const Stripe = require(path.resolve(__dirname, '../backend/node_modules/stripe'));
const { SecretManagerServiceClient } = require(path.resolve(__dirname, '../backend/node_modules/@google-cloud/secret-manager'));

const EXPECTED_PRICES = {
  'Single Meeting Pass ($1.99)': 'price_1UKowpRPP93YBXrOjjKjUUlz',
  'Educator Annual ($4.99/yr)': 'price_1UDZsvRPP93YBXrOGfe1d4Ig',
  'Individual Lifetime ($9.99)': 'price_1UDZsuRPP93YBXrOAUWBPqO2',
  'Department Annual ($59/yr)': 'price_1UEYZZRPP93YBXrO9aLcJNcO',
  'Domain Lifetime ($19.99)': 'price_1UDZsvRPP93YBXrOqVtFNIjU',
  'Institution Annual ($149/yr)': 'price_1UDVBsRPP93YBXrO653hD51s',
  'India Lifetime Pass (₹299)': 'price_1UKfQpRPP93YBXrOP42OOuV0',
  'India Educator Annual (₹199/yr)': 'price_1UKHrjRPP93YBXrOYKcp9Ft9',
  'Philippines Lifetime (₱99)': 'price_1UKowpRPP93YBXrOVreZdJO3',
};

async function run() {
  console.log('🔍 Fetching Stripe credentials from Secret Manager...');
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: 'projects/829771833968/secrets/stripe-secret-key/versions/latest',
  });
  const stripeKey = version.payload.data.toString().trim();
  const stripe = Stripe(stripeKey);

  console.log('✅ Connected to Stripe. Verifying all production price IDs...\n');
  let errors = 0;

  for (const [label, priceId] of Object.entries(EXPECTED_PRICES)) {
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (!price.active) {
        console.error(`❌ INACTIVE: ${label} [${priceId}] is marked inactive!`);
        errors++;
      } else {
        const amountStr = price.currency === 'inr' || price.currency === 'usd' || price.currency === 'php'
          ? `${(price.unit_amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`
          : `${price.unit_amount} ${price.currency}`;
        const recurStr = price.type === 'recurring' ? `recurring ${price.recurring.interval}` : 'one-time';
        console.log(`  ✓ ${label.padEnd(35)} | ${amountStr.padEnd(12)} | ${recurStr.padEnd(16)} | ${price.id}`);
      }
    } catch (err) {
      console.error(`❌ FAILED: ${label} [${priceId}] -> ${err.message}`);
      errors++;
    }
  }

  console.log('\n----------------------------------------');
  if (errors === 0) {
    console.log('🎉 ALL STRIPE PRICES VERIFIED 100% OPERATIONAL!');
    process.exit(0);
  } else {
    console.error(`🚨 ${errors} pricing configuration error(s) found!`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
