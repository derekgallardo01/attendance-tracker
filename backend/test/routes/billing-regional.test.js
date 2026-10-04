const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockStripeInstance = {
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  prices: { retrieve: jest.fn().mockResolvedValue({ id: 'p1', type: 'one_time' }) },
  webhooks: { constructEvent: jest.fn() },
  promotionCodes: { create: jest.fn() },
  paymentIntents: { retrieve: jest.fn() },
  charges: { retrieve: jest.fn() },
  invoices: { retrieve: jest.fn() },
  subscriptions: { retrieve: jest.fn(), update: jest.fn() },
};
jest.mock('stripe', () => jest.fn(() => mockStripeInstance));

jest.mock('../../src/services/firestore', () => ({
  getTenantPlan: jest.fn(),
  setTenantPlan: jest.fn(),
  getUserPlan: jest.fn(),
  setUserPlan: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getTeamAdminStatus: jest.fn(),
  countUserMonthlyExports: jest.fn().mockResolvedValue(0),
  countUserAutoExports: jest.fn().mockResolvedValue(0),
  getUserSettings: jest.fn().mockResolvedValue({}),
  logEvent: jest.fn(),
  claimWebhookEvent: jest.fn(),
  releaseWebhookEvent: jest.fn(),
  isEmailSuppressed: jest.fn().mockResolvedValue(false),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/regional_test' });
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free', billingStatus: null, stripeCustomerId: null });
  firestore.getUserPlan.mockResolvedValue({ plan: 'free', billingStatus: null, stripeCustomerId: null });
  process.env.STRIPE_SECRET_KEY = 'sk_test_regional';
  process.env.STRIPE_PRICE_ID = 'price_domain_default';
  process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_usd_lifetime';
  process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_usd_educator';
  app = buildApp();
});

afterEach(() => {
  delete process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID;
  delete process.env.STRIPE_INDIVIDUAL_LIFETIME_MYR_PRICE_ID;
  delete process.env.STRIPE_INDIVIDUAL_LIFETIME_IDR_PRICE_ID;
  delete process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID;
});

describe('Regional payment rails — PHP, MYR, IDR, IN', () => {
  test('PH user checkouts in PHP (₱280) with GCash, Maya, GrabPay, Card rails', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@depedqc.ph', 'depedqc.ph'))
      .set('cf-ipcountry', 'PH')
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/regional_test');
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'php',
            unit_amount: 28000,
            product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
          },
          quantity: 1,
        }],
        automatic_payment_methods: { enabled: true },
        metadata: expect.objectContaining({
          country: 'PH',
          currency: 'php',
          plan: 'lifetime',
        }),
      })
    );
  });

  test('MY user checkouts in MYR (RM 22) with FPX and GrabPay rails', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@moe-dl.edu.my', 'moe-dl.edu.my'))
      .set('cf-ipcountry', 'MY')
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'myr',
            unit_amount: 2200,
            product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
          },
          quantity: 1,
        }],
        automatic_payment_methods: { enabled: true },
        metadata: expect.objectContaining({
          country: 'MY',
          currency: 'myr',
        }),
      })
    );
  });

  test('ID user checkouts in IDR (Rp 78.000) with QRIS rail', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('guru@kemdikbud.go.id', 'kemdikbud.go.id'))
      .set('cf-ipcountry', 'ID')
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'idr',
            unit_amount: 7800000,
            product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
          },
          quantity: 1,
        }],
        automatic_payment_methods: { enabled: true },
        metadata: expect.objectContaining({
          country: 'ID',
          currency: 'idr',
        }),
      })
    );
  });

  test('PH user with dedicated STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID uses the price ID', async () => {
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID = 'price_php_env_123';
    app = buildApp();

    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@deped.gov.ph', 'deped.gov.ph'))
      .set('cf-ipcountry', 'PH')
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_php_env_123', quantity: 1 }],
        automatic_payment_methods: { enabled: true },
      })
    );
  });

  test('GET /billing/status returns localized prices and enables educator for PH, MY, ID', async () => {
    const resPH = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('user@ph.edu', 'ph.edu'))
      .set('cf-ipcountry', 'PH');
    expect(resPH.body.pricing.lifetime.label).toBe('₱280');
    expect(resPH.body.pricing.educator.label).toBe('₱140/yr');
    expect(resPH.body.educatorAvailable).toBe(true);

    const resMY = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('user@my.edu', 'my.edu'))
      .set('cf-ipcountry', 'MY');
    expect(resMY.body.pricing.lifetime.label).toBe('RM 22');
    expect(resMY.body.pricing.educator.label).toBe('RM 12/yr');
    expect(resMY.body.educatorAvailable).toBe(true);

    const resID = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('user@id.edu', 'id.edu'))
      .set('cf-ipcountry', 'ID');
    expect(resID.body.pricing.lifetime.label).toBe('Rp 78.000');
    expect(resID.body.pricing.educator.label).toBe('Rp 39.000/yr');
    expect(resID.body.educatorAvailable).toBe(true);
  });

  test('POST /billing/create-checkout-session alias routes successfully', async () => {
    const res = await request(app)
      .post('/api/billing/create-checkout-session')
      .set(authedHeader('teacher@depedqc.ph', 'depedqc.ph'))
      .set('cf-ipcountry', 'PH')
      .send({ plan: 'lifetime' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/regional_test');
  });

  test('public-checkout also supports regional payment rails for ID', async () => {
    const res = await request(app)
      .post('/api/billing/public-checkout')
      .set('cf-ipcountry', 'ID')
      .send({ plan: 'lifetime', email: 'buyer@kemdikbud.go.id' });

    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'idr',
            unit_amount: 7800000,
            product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
          },
          quantity: 1,
        }],
        automatic_payment_methods: { enabled: true },
      })
    );
  });
});
