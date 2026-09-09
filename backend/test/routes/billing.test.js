// Tests for /api/billing/* — Stripe checkout, portal, status, webhook, and the
// requireProPlan gate. The Stripe SDK is mocked so no network calls happen.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

// Controllable Stripe instance returned by the mocked SDK factory.
const mockStripeInstance = {
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  prices: { retrieve: jest.fn().mockResolvedValue({ id: 'p1', type: 'recurring', recurring: { interval: 'year' } }) },
  webhooks: { constructEvent: jest.fn() },
  promotionCodes: { create: jest.fn() },
  paymentIntents: { retrieve: jest.fn() }, // refund/dispute → metadata lookup
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
  getTeamAdminStatus: jest.fn(), // requireTeamAdmin (runs before requireProPlan on /team/overview)
  countUserMonthlyExports: jest.fn().mockResolvedValue(0),
  logEvent: jest.fn(),
  claimWebhookEvent: jest.fn(), // webhook idempotency — default re-armed in beforeEach
  releaseWebhookEvent: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'p1', type: 'recurring', recurring: { interval: 'year' } });
  mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/test' });
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free', billingStatus: null, stripeCustomerId: null });
  firestore.getUserPlan.mockResolvedValue({ plan: 'free', billingStatus: null, stripeCustomerId: null });
  firestore.claimWebhookEvent.mockResolvedValue(true); // clearMocks wipes implementations' calls, not defaults set here
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_INDIVIDUAL_PRICE_ID;
  app = buildApp();
});

describe('billing — not configured (pre-launch defaults)', () => {
  test('POST /billing/checkout 401 without auth', async () => {
    const res = await request(app).post('/api/billing/checkout').send({});
    expect(res.status).toBe(401);
  });

  test('POST /billing/checkout 503 when Stripe env is unset', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .send({});
    expect(res.status).toBe(503);
  });

  test('GET /billing/portal 503 when unconfigured', async () => {
    const res = await request(app)
      .get('/api/billing/portal')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(503);
  });

  test('POST /billing/webhook 503 when unconfigured', async () => {
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .send({ type: 'checkout.session.completed' });
    expect(res.status).toBe(503);
  });

  test('GET /billing/status returns the free plan + billingConfigured:false', async () => {
    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('free');
    expect(res.body.billingConfigured).toBe(false);
  });
});

describe('billing — configured (Stripe env set)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    app = buildApp();
  });

  test('POST /billing/checkout returns the session URL', async () => {
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/abc' });
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('checkout.stripe.com');
    // Per-domain: the session must carry the domain for the webhook to key on.
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference_id: 'acme.com' })
    );
  });

  test('400 on an unknown plan value — no fallthrough to a different product', async () => {
    // The plan cascade once let a misspelled/off-catalog value resolve to a
    // DIFFERENT product's price (the "$9.99 button charged team price" class).
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .send({ plan: 'institution', interval: 'annual' });
    expect(res.status).toBe(400);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('plan value is case/whitespace-normalized ("Lifetime " buys the lifetime pass, not a subscription)', async () => {
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life_999';
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/life' });
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@gmail.com', 'gmail.com'))
      .send({ plan: ' Lifetime ' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: 'price_life_999', quantity: 1 }], mode: 'payment' })
    );
    delete process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID;
  });

  test('authed team checkout from a personal domain is refused (400) — never flips the shared tenant', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@gmail.com', 'gmail.com'))
      .send({ plan: 'team' });
    expect(res.status).toBe(400);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('lifetime checkout fails closed (503) when the lifetime price is unset — no cross-product fallback', async () => {
    delete process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID;
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('u@gmail.com', 'gmail.com'))
      .send({ plan: 'lifetime' });
    expect(res.status).toBe(503);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('webhook 400 on bad signature (does not update the plan)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockImplementation(() => { throw new Error('bad sig'); });
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'nope')
      .send({ type: 'checkout.session.completed' });
    expect(res.status).toBe(400);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('webhook checkout.session.completed upgrades the domain to Pro', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'acme.com', customer: 'cus_1', subscription: 'sub_1' } },
    });
    const res = await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'good')
      .send({});
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_1',
    }));
  });

  test('webhook subscription.deleted downgrades to free', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'canceled', metadata: { domain: 'acme.com' } } },
    });
    await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'good')
      .send({});
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      plan: 'free', billingStatus: 'canceled',
    }));
  });

  test('webhook subscription.updated → past_due KEEPS Pro (dunning grace)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'past_due', metadata: { domain: 'acme.com' } } },
    });
    await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'good')
      .send({});
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      plan: 'pro', billingStatus: 'past_due',
    }));
  });

  test('webhook subscription.updated → unpaid downgrades to free (retries exhausted)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'unpaid', metadata: { domain: 'acme.com' } } },
    });
    await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'good')
      .send({});
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      plan: 'free', billingStatus: 'unpaid',
    }));
  });

  test('team overview is gated: 402 for a free domain once billing is live', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getTeamAdminStatus.mockResolvedValue({ isTeamAdmin: true }); // pass requireTeamAdmin, then hit requireProPlan
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(402);
    expect(res.body.upgrade).toBe(true);
  });
});

describe('billing — individual (per-user) tier for personal-email users', () => {
  const GMAIL = 'teacher@gmail.com';
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_org';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    app = buildApp();
  });
  afterEach(() => { delete process.env.STRIPE_INDIVIDUAL_PRICE_ID; });

  test('checkout uses the INDIVIDUAL price + user:<email> reference for a personal domain', async () => {
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/ind' });
    const res = await request(app).post('/api/billing/checkout').set(authedHeader(GMAIL, 'gmail.com')).send({});
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_individual', quantity: 1 }],
      client_reference_id: `user:${GMAIL}`,
      metadata: expect.objectContaining({ individual: '1', domain: 'gmail.com', email: GMAIL }),
    }));
  });

  test('checkout allows an institutional user to explicitly buy an INDIVIDUAL plan', async () => {
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/ind-school' });
    const res = await request(app).post('/api/billing/checkout').set(authedHeader('teacher@k12.edu', 'k12.edu')).send({ plan: 'individual' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_individual', quantity: 1 }],
      client_reference_id: 'user:teacher@k12.edu',
      metadata: expect.objectContaining({ individual: '1', domain: 'k12.edu', email: 'teacher@k12.edu' }),
    }));
  });

  test('checkout 503 for a personal user when the individual price is not set (tier not launched)', async () => {
    delete process.env.STRIPE_INDIVIDUAL_PRICE_ID;
    app = buildApp();
    const res = await request(app).post('/api/billing/checkout').set(authedHeader(GMAIL, 'gmail.com')).send({});
    expect(res.status).toBe(503);
  });

  test('webhook checkout.completed with individual metadata writes the USER plan, not the tenant', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: `user:${GMAIL}`, customer: 'cus_i', subscription: 'sub_i', metadata: { individual: '1', domain: 'gmail.com', email: GMAIL } } },
    });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
    expect(res.status).toBe(200);
    expect(firestore.setUserPlan).toHaveBeenCalledWith('gmail.com', GMAIL, expect.objectContaining({
      individualPlan: 'pro', individualBillingStatus: 'active', individualStripeCustomerId: 'cus_i',
    }));
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('webhook subscription.deleted for an individual downgrades the USER to free', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_i', status: 'canceled', metadata: { individual: '1', domain: 'gmail.com', email: GMAIL } } },
    });
    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
    expect(firestore.setUserPlan).toHaveBeenCalledWith('gmail.com', GMAIL, expect.objectContaining({ individualPlan: 'free', individualBillingStatus: 'canceled' }));
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('status for a personal user reports individual:true and reads the user plan', async () => {
    firestore.getUserPlan.mockResolvedValue({ plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_i' });
    const res = await request(app).get('/api/billing/status').set(authedHeader(GMAIL, 'gmail.com'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: 'pro', individual: true, billingConfigured: true });
    expect(firestore.getUserPlan).toHaveBeenCalledWith('gmail.com', GMAIL);
    expect(firestore.getTenantPlan).not.toHaveBeenCalled();
  });

  test('portal for a personal user uses the USER stripe customer', async () => {
    firestore.getUserPlan.mockResolvedValue({ plan: 'pro', stripeCustomerId: 'cus_i' });
    mockStripeInstance.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/i' });
    const res = await request(app).get('/api/billing/portal').set(authedHeader(GMAIL, 'gmail.com'));
    expect(res.status).toBe(200);
    expect(mockStripeInstance.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_i' }));
  });
});

describe('billing — annual pricing (monthly + annual per tier)', () => {
  const GMAIL = 'teacher@gmail.com';
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_org_monthly';
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_ind_monthly';
    process.env.STRIPE_ANNUAL_PRICE_ID = 'price_org_annual';
    process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID = 'price_ind_annual';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    app = buildApp();
  });
  afterEach(() => {
    delete process.env.STRIPE_INDIVIDUAL_PRICE_ID;
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
    delete process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID;
  });
  const checkout = (email, domain, body) => request(app).post('/api/billing/checkout')
    .set(authedHeader(email, domain)).set('Content-Type', 'application/json').send(body || {});
  const priceOf = () => mockStripeInstance.checkout.sessions.create.mock.calls[0][0].line_items[0].price;

  test('individual + interval:annual → individual ANNUAL price', async () => {
    await checkout(GMAIL, 'gmail.com', { interval: 'annual' });
    expect(priceOf()).toBe('price_ind_annual');
  });
  test('individual, no interval → individual MONTHLY price', async () => {
    await checkout(GMAIL, 'gmail.com', {});
    expect(priceOf()).toBe('price_ind_monthly');
  });
  test('team (workspace) + interval:annual → team ANNUAL price', async () => {
    await checkout('admin@acme.com', 'acme.com', { interval: 'annual' });
    expect(priceOf()).toBe('price_org_annual');
  });
  test('annual requested but annual price unset → falls back to MONTHLY', async () => {
    delete process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID;
    await checkout(GMAIL, 'gmail.com', { interval: 'annual' });
    expect(priceOf()).toBe('price_ind_monthly');
  });
  test('status reports annualAvailable:true when the annual price is set', async () => {
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).get('/api/billing/status').set(authedHeader(GMAIL, 'gmail.com'));
    expect(res.body.annualAvailable).toBe(true);
  });
  test('status reports annualAvailable:false when the annual price is unset', async () => {
    delete process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID;
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).get('/api/billing/status').set(authedHeader(GMAIL, 'gmail.com'));
    expect(res.body.annualAvailable).toBe(false);
  });
});

describe('planIsPro — per-user gating for personal domains', () => {
  const { planIsPro } = require('../../src/routes/billing');
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_org';
  });
  afterEach(() => { delete process.env.STRIPE_INDIVIDUAL_PRICE_ID; });

  test('personal domain with NO email stays free-tier-allowed (no regression on existing callers)', async () => {
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    expect(await planIsPro('gmail.com')).toBe(true); // no email → not gated
    expect(firestore.getUserPlan).not.toHaveBeenCalled();
  });

  test('personal domain + email but individual tier NOT launched → allowed (no regression)', async () => {
    delete process.env.STRIPE_INDIVIDUAL_PRICE_ID;
    expect(await planIsPro('gmail.com', 'u@gmail.com')).toBe(true);
    expect(firestore.getUserPlan).not.toHaveBeenCalled();
  });

  test('personal domain + email + launched → reads the user plan (pro=true / free=false)', async () => {
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'pro' });
    expect(await planIsPro('gmail.com', 'u@gmail.com')).toBe(true);
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'free' });
    expect(await planIsPro('gmail.com', 'u@gmail.com')).toBe(false);
  });

  test('one gmail user paying does NOT make another gmail user Pro (per-user, not per shared tenant)', async () => {
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    firestore.getUserPlan.mockImplementation(async (_d, email) => ({ plan: email === 'payer@gmail.com' ? 'pro' : 'free' }));
    expect(await planIsPro('gmail.com', 'payer@gmail.com')).toBe(true);
    expect(await planIsPro('gmail.com', 'freeloader@gmail.com')).toBe(false);
  });

  test('workspace domain still gates on the DOMAIN plan (email ignored)', async () => {
    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'pro' });
    expect(await planIsPro('acme.com', 'anyone@acme.com')).toBe(true);
    expect(firestore.getUserPlan).not.toHaveBeenCalled();
  });

  test('per-user gate fails CLOSED on a read error with no cached plan', async () => {
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    firestore.getUserPlan.mockRejectedValue(new Error('firestore down'));
    expect(await planIsPro('gmail.com', 'nocache@gmail.com')).toBe(false);
  });

  test('workspace user with an INDIVIDUAL pass gets Pro when the domain plan is free (G7)', async () => {
    // A teacher whose school never bought the org plan but bought the
    // individual pass themselves — the purchase must be honored.
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'pro' });
    expect(await planIsPro('freeschool-g7.edu', 'teacher@freeschool-g7.edu')).toBe(true);
    expect(firestore.getUserPlan).toHaveBeenCalledWith('freeschool-g7.edu', 'teacher@freeschool-g7.edu');
  });

  test('workspace fallback: free individual stays free; no email or tier-off skips the user read', async () => {
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'free' });
    expect(await planIsPro('freeschool2-g7.edu', 'teacher@freeschool2-g7.edu')).toBe(false);

    firestore.getUserPlan.mockClear();
    expect(await planIsPro('freeschool3-g7.edu')).toBe(false); // no email
    delete process.env.STRIPE_INDIVIDUAL_PRICE_ID;             // tier not launched
    expect(await planIsPro('freeschool4-g7.edu', 't@freeschool4-g7.edu')).toBe(false);
    expect(firestore.getUserPlan).not.toHaveBeenCalled();
  });
});

describe('billing — workspace user holding an individual pass (G7 surfaces)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_org';
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_individual';
  });
  afterEach(() => { delete process.env.STRIPE_INDIVIDUAL_PRICE_ID; });

  test('GET /billing/status reports the individual Pro plan for a workspace user', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'pro', stripeCustomerId: 'cus_teacher' });
    const res = await request(app).get('/api/billing/status').set(authedHeader('t@g7status.edu', 'g7status.edu'));
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe('pro');
    expect(res.body.individual).toBe(true); // manage-billing routes to the individual portal
    expect(res.body.exportQuota).toBeNull();
  });

  test('GET /billing/portal falls back to the USER stripe customer for a workspace individual', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free', stripeCustomerId: null });
    firestore.getUserPlan.mockResolvedValue({ plan: 'pro', stripeCustomerId: 'cus_teacher' });
    mockStripeInstance.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/g7' });
    const res = await request(app).get('/api/billing/portal').set(authedHeader('t@g7portal.edu', 'g7portal.edu'));
    expect(res.status).toBe(200);
    expect(mockStripeInstance.billingPortal.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_teacher' }));
  });
});

describe('billing — additional configured paths', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    app = buildApp();
  });

  test('POST /billing/checkout 502 when Stripe throws', async () => {
    mockStripeInstance.checkout.sessions.create.mockRejectedValue(new Error('stripe down'));
    const res = await request(app).post('/api/billing/checkout').set(authedHeader('a@acme.com', 'acme.com')).send({});
    expect(res.status).toBe(502);
  });

  test('GET /billing/portal 404 when the domain has no Stripe customer', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free', stripeCustomerId: null });
    const res = await request(app).get('/api/billing/portal').set(authedHeader('a@acme.com', 'acme.com'));
    expect(res.status).toBe(404);
  });

  test('GET /billing/portal returns the portal URL when a customer exists', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro', stripeCustomerId: 'cus_1' });
    mockStripeInstance.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.com/p/x' });
    const res = await request(app).get('/api/billing/portal').set(authedHeader('a@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('billing.stripe.com');
  });

  test('GET /billing/portal 502 when Stripe throws', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro', stripeCustomerId: 'cus_1' });
    mockStripeInstance.billingPortal.sessions.create.mockRejectedValue(new Error('stripe down'));
    const res = await request(app).get('/api/billing/portal').set(authedHeader('a@acme.com', 'acme.com'));
    expect(res.status).toBe(502);
  });

  test('webhook subscription.updated (active) upgrades to Pro', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'active', metadata: { domain: 'acme.com' } } },
    });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({ plan: 'pro' }));
  });

  test('webhook checkout.session.completed with no domain is ignored', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed', data: { object: { client_reference_id: null, metadata: {} } },
    });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('webhook subscription.updated with no domain is ignored', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'active', metadata: {} } },
    });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('webhook ignores unknown event types', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({ type: 'invoice.paid', data: { object: {} } });
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  test('webhook 500 when the handler throws while updating', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'checkout.session.completed', data: { object: { client_reference_id: 'acme.com' } },
    });
    firestore.setTenantPlan.mockRejectedValue(new Error('firestore down'));
    const res = await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));
    expect(res.status).toBe(500);
  });
});

describe('requireProPlan (direct)', () => {
  const { requireProPlan } = require('../../src/routes/billing');
  function ctx() {
    const req = { user: { domain: 'acme.com' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return { req, res, next };
  }
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PRICE_ID; });

  test('passes through when billing is not configured', async () => {
    const { req, res, next } = ctx();
    await requireProPlan(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('allows a Pro domain when configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_ID = 'price_x';
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    const { req, res, next } = ctx();
    await requireProPlan(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('fails CLOSED (402) when the plan read throws and there is no cached plan', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_ID = 'price_x';
    firestore.getTenantPlan.mockRejectedValue(new Error('read boom'));
    // Unique domain so no prior test primed the module-level plan cache.
    const req = { user: { domain: `nocache-${Date.now()}.com` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    await requireProPlan(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ upgrade: true, transient: true }));
  });

  test('tolerates a transient read error using the last known Pro plan', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_ID = 'price_x';
    const domain = `paying-${Date.now()}.com`;
    const mk = () => ({
      req: { user: { domain } },
      res: { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() },
      next: jest.fn(),
    });
    // A successful Pro read primes the cache...
    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'pro' });
    let c = mk(); await requireProPlan(c.req, c.res, c.next);
    expect(c.next).toHaveBeenCalled();
    // ...so a subsequent read error still lets the paying domain through.
    firestore.getTenantPlan.mockRejectedValueOnce(new Error('blip'));
    c = mk(); await requireProPlan(c.req, c.res, c.next);
    expect(c.next).toHaveBeenCalled();
  });
});

describe('billing status error', () => {
  test('GET /billing/status 500 when the plan read throws', async () => {
    firestore.getTenantPlan.mockRejectedValue(new Error('read boom'));
    const res = await request(app).get('/api/billing/status').set(authedHeader('a@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });
});

describe('createReferralPromoCode', () => {
  const { createReferralPromoCode } = require('../../src/routes/billing');
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_REFERRAL_COUPON_ID; });

  test('returns null when the coupon is not configured', async () => {
    delete process.env.STRIPE_REFERRAL_COUPON_ID;
    expect(await createReferralPromoCode('inviter@x.com')).toBeNull();
  });

  test('mints a single-use promo code referencing the coupon when configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_REFERRAL_COUPON_ID = 'coup_123';
    mockStripeInstance.promotionCodes.create.mockResolvedValue({ code: 'ABC123' });
    const code = await createReferralPromoCode('inviter@x.com');
    expect(code).toBe('ABC123');
    expect(mockStripeInstance.promotionCodes.create).toHaveBeenCalledWith(expect.objectContaining({
      coupon: 'coup_123', max_redemptions: 1,
      metadata: expect.objectContaining({ referrer: 'inviter@x.com', kind: 'referral_reward' }),
    }));
  });

  test('returns null (does not throw) when Stripe errors', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_REFERRAL_COUPON_ID = 'coup_123';
    mockStripeInstance.promotionCodes.create.mockRejectedValue(new Error('stripe down'));
    expect(await createReferralPromoCode('inviter@x.com')).toBeNull();
  });
});

describe('billing — one-time lifetime payment mode', () => {
  test('uses mode: payment and payment_intent_data when price is one-time', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_lifetime_1999';
    mockStripeInstance.prices.retrieve.mockResolvedValueOnce({ id: 'price_lifetime_1999', type: 'one_time', recurring: null });
    mockStripeInstance.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/pay' });

    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/pay');
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment',
      payment_intent_data: expect.objectContaining({ metadata: expect.objectContaining({ domain: 'acme.com' }) }),
      // Payment mode must create a Stripe customer, or the buyer's billing
      // portal 404s forever (no customer id ever reaches the webhook).
      customer_creation: 'always',
    }));
  });

  test('subscription mode does not send customer_creation', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_sub_999';
    mockStripeInstance.prices.retrieve.mockResolvedValueOnce({ id: 'price_sub_999', type: 'recurring', recurring: { interval: 'month' } });
    mockStripeInstance.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/sub' });

    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .send({});

    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(params.mode).toBe('subscription');
    // Stripe rejects customer_creation in subscription mode — it must be absent.
    expect(params).not.toHaveProperty('customer_creation');
  });
});

describe('billing — public-checkout for marketing pages', () => {
  test('creates a public checkout session without authentication', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_domain_1999';
    process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_indiv_999';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_lifetime_full'; // lifetime no longer falls back cross-product
    mockStripeInstance.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/public_pay' });

    const res = await request(app)
      .post('/api/billing/public-checkout')
      .send({ plan: 'lifetime', email: 'teacher@school.edu' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/public_pay');
    const params = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(params).toEqual(expect.objectContaining({
      client_reference_id: 'user:teacher@school.edu',
      customer_creation: 'always', // lifetime = payment mode → must create a customer
    }));
    // Unauthenticated endpoint must NOT prefill a caller-supplied address —
    // combined with abandoned-checkout recovery that was an email cannon
    // (queue Stripe-branded recovery mail to arbitrary victims).
    expect(params.customer_email).toBeUndefined();
  });

  test('400 on an unknown plan value (public endpoint — same no-fallthrough rule)', async () => {
    const res = await request(app)
      .post('/api/billing/public-checkout')
      .send({ plan: 'institution' });
    expect(res.status).toBe(400);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('returns 503 when Stripe is not configured', async () => {
    const oldKey = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const res = await request(app)
      .post('/api/billing/public-checkout')
      .send({ plan: 'individual' });

    expect(res.status).toBe(503);
    process.env.STRIPE_SECRET_KEY = oldKey;
  });

  test('creates a public checkout session for educator pass', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_educator_499';
    mockStripeInstance.checkout.sessions.create.mockResolvedValueOnce({ url: 'https://checkout.stripe.com/educator_pay' });

    const res = await request(app)
      .post('/api/billing/public-checkout')
      .send({ plan: 'educator', email: 'teacher@deped.gov.ph' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://checkout.stripe.com/educator_pay');
    const params = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(params).toEqual(expect.objectContaining({
      line_items: [{ price: 'price_educator_499', quantity: 1 }],
      client_reference_id: 'user:teacher@deped.gov.ph',
    }));
    expect(params.customer_email).toBeUndefined(); // no caller-supplied prefill on the public endpoint
    // Provisioning still works: the webhook reads metadata.email first.
    expect(params.metadata.email).toBe('teacher@deped.gov.ph');
  });
});

// ═══ Monetization overhaul: team provisioning, promo bypass, webhook hygiene ═══

describe('public-checkout team provisioning guard', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_domain';
    app = buildApp();
  });

  test('400 when a team purchase has no email (webhook could not provision)', async () => {
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'team' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/work email/i);
  });

  test('400 when a team purchase uses a personal-email domain', async () => {
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'team', email: 'someone@gmail.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Workspace domain/i);
  });

  test('team purchase with a work email stamps the domain into metadata', async () => {
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'price_domain', type: 'one_time' });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'team', email: 'Admin@Acme.com' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.metadata.domain).toBe('acme.com');
    expect(params.client_reference_id).toBe('acme.com');
  });

  test('no promo → CLEAN session (no discounts, no promo box) so Adaptive Pricing can present local currency', async () => {
    // LAUNCH50 is retired and prices are the real selling prices. A clean
    // session (neither `discounts` nor `allow_promotion_codes`) is required for
    // Stripe Adaptive Pricing to show local currency + rails to PPP buyers.
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'p', type: 'recurring', recurring: {} });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'educator' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBeUndefined();
  });

  test('checkout sessions enable abandoned-cart recovery', async () => {
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'p', type: 'recurring', recurring: {} });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'educator' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.after_expiration).toEqual({ recovery: { enabled: true } });
  });

  test('a stale LAUNCH50 from an old cached client is ignored (still a clean session)', async () => {
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'p', type: 'recurring', recurring: {} });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'educator', promo: 'LAUNCH50' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBeUndefined(); // LAUNCH50 no longer opens the box
  });

  test('an explicit referral/promo code opens the promo box for that checkout', async () => {
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'p', type: 'recurring', recurring: {} });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'educator', promo: 'REF-ABC123' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBe(true);
  });

  test('a team purchase with NO interval resolves to the one-time domain price, never the $149 annual/Institution price', async () => {
    // Regression: the endpoint used to default interval to 'annual', so a bare
    // {plan:'team'} silently jumped to the Institution price.
    process.env.STRIPE_ANNUAL_PRICE_ID = 'price_institution_149';
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'price_domain', type: 'one_time' });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'team', email: 'admin@acme.com' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items[0].price).toBe('price_domain');
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
  });

  test('Institution (team + annual) is a clean session — no discount ever applied', async () => {
    process.env.STRIPE_ANNUAL_PRICE_ID = 'price_institution_149';
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'price_institution_149', type: 'recurring', recurring: { interval: 'year' } });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .send({ plan: 'team', interval: 'annual', email: 'admin@acme.com' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items[0].price).toBe('price_institution_149');
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBeUndefined();
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
  });
});

describe('webhook hygiene (dedupe + refunds + org-domain fallback)', () => {
  const post = () => request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').send(Buffer.from('{}'));

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    app = buildApp();
  });

  test('duplicate delivery is acknowledged but not reprocessed', async () => {
    firestore.claimWebhookEvent.mockResolvedValue(false);
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_dup', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'acme.com', metadata: {} } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('org checkout with no ref/metadata falls back to the buyer email domain (non-personal only)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_1', type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, metadata: { individual: '0' }, customer_details: { email: 'principal@school.org' }, customer: 'cus_1' } },
    });
    await post();
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('school.org', expect.objectContaining({ plan: 'pro' }));
  });

  test('org checkout from a personal email with no domain provisions NOTHING (never flips gmail.com)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_2', type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, metadata: { individual: '0' }, customer_details: { email: 'buyer@gmail.com' } } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('charge.refunded downgrades an individual pass via payment-intent metadata', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: { individual: '1', plan: 'lifetime', email: 'buyer@acme.com', domain: 'acme.com' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_3', type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_1' } },
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('acme.com', 'buyer@acme.com', expect.objectContaining({ individualPlan: 'free', individualBillingStatus: 'refunded' }));
    expect(firestore.logEvent).toHaveBeenCalledWith('acme.com', expect.objectContaining({ type: 'refunded' }));
  });

  test('charge.dispute.created downgrades a domain plan and marks it disputed', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: { individual: '0', plan: 'team', domain: 'acme.com' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_4', type: 'charge.dispute.created',
      data: { object: { payment_intent: 'pi_2' } },
    });
    await post();
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('acme.com', expect.objectContaining({ plan: 'free', billingStatus: 'disputed' }));
  });

  test('refund with unretrievable payment intent logs for manual review and changes nothing', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockRejectedValue(new Error('no such pi'));
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_5', type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_missing' } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('subscription refund: resolves metadata via charge → invoice → subscription and downgrades the individual', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: {} }); // PI has none
    mockStripeInstance.charges.retrieve.mockResolvedValue({ metadata: {}, invoice: 'in_1' });
    mockStripeInstance.invoices.retrieve.mockResolvedValue({ subscription: 'sub_1' });
    mockStripeInstance.subscriptions.retrieve.mockResolvedValue({ metadata: { individual: '1', email: 'sub@acme.com', domain: 'acme.com' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_sub_refund', type: 'charge.refunded',
      data: { object: { metadata: {}, charge: 'ch_1' } }, // no payment_intent, no top-level metadata
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('acme.com', 'sub@acme.com', expect.objectContaining({ individualPlan: 'free', individualBillingStatus: 'refunded' }));
  });

  test('refunded charge with a direct invoice (no charge indirection) resolves via subscription metadata', async () => {
    mockStripeInstance.invoices.retrieve.mockResolvedValue({ subscription: 'sub_2' });
    mockStripeInstance.subscriptions.retrieve.mockResolvedValue({ metadata: { individual: '0', domain: 'school.edu' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_inv_refund', type: 'charge.refunded',
      data: { object: { metadata: {}, invoice: 'in_2' } }, // no PI, no charge, has invoice
    });
    await post();
    expect(firestore.setTenantPlan).toHaveBeenCalledWith('school.edu', expect.objectContaining({ plan: 'free', billingStatus: 'refunded' }));
  });

  test('PARTIAL refund (refunded:false, amount_refunded < amount) retains the plan', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: { individual: '0', plan: 'team', domain: 'acme.com' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_partial', type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_p', refunded: false, amount: 14900, amount_refunded: 200 } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
  });

  test('charge.dispute.closed with status won RE-GRANTS the plan revoked at dispute.created', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: { individual: '1', plan: 'lifetime', email: 'buyer@acme.com', domain: 'acme.com' } });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_won', type: 'charge.dispute.closed',
      data: { object: { payment_intent: 'pi_w', status: 'won' } },
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('acme.com', 'buyer@acme.com', expect.objectContaining({ individualPlan: 'pro', individualBillingStatus: 'active' }));
  });

  test('charge.dispute.closed with status lost changes nothing (already downgraded at created)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_lost', type: 'charge.dispute.closed',
      data: { object: { payment_intent: 'pi_l', status: 'lost' } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('refund with NO metadata anywhere falls back to charge billing_details.email (signed-out one-time buyer)', async () => {
    mockStripeInstance.paymentIntents.retrieve.mockResolvedValue({ metadata: {} });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_bd', type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_bd', metadata: {}, billing_details: { email: 'Anon.Buyer@school.edu' }, refunded: true } },
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('school.edu', 'anon.buyer@school.edu', expect.objectContaining({ individualPlan: 'free', individualBillingStatus: 'refunded' }));
  });

  test('completed session WITHOUT metadata email backfills the subscription metadata (signed-out educator)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_backfill', type: 'checkout.session.completed',
      data: { object: { client_reference_id: null, metadata: { individual: '1', plan: 'educator' }, customer_details: { email: 'teach@deped.gov.ph' }, subscription: 'sub_bf', customer: 'cus_bf' } },
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('deped.gov.ph', 'teach@deped.gov.ph', expect.objectContaining({ individualPlan: 'pro' }));
    // Without this, cancellation/non-payment of a signed-out pass never
    // downgrades: subscription.updated/deleted route on sub.metadata only.
    expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith('sub_bf', {
      metadata: expect.objectContaining({ individual: '1', email: 'teach@deped.gov.ph', domain: 'deped.gov.ph' }),
    });
  });

  test('checkout.session.completed with payment_status unpaid (delayed method) grants NOTHING yet', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_unpaid', type: 'checkout.session.completed',
      data: { object: { payment_status: 'unpaid', client_reference_id: 'acme.com', metadata: { individual: '0' } } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('async_payment_succeeded provisions the deferred purchase; async_payment_failed provisions nothing', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_async_ok', type: 'checkout.session.async_payment_succeeded',
      data: { object: { metadata: { individual: '1', email: 'late@acme.com', domain: 'acme.com' }, customer: 'cus_l' } },
    });
    await post();
    expect(firestore.setUserPlan).toHaveBeenCalledWith('acme.com', 'late@acme.com', expect.objectContaining({ individualPlan: 'pro' }));

    firestore.setUserPlan.mockClear();
    mockStripeInstance.webhooks.constructEvent.mockReturnValueOnce({
      id: 'evt_async_fail', type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_x' } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
  });

  test('a personal-domain team purchase never flips the shared tenant Pro (webhook guard)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_gmail_team', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'gmail.com', metadata: { individual: '0' } } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
  });

  test('a failed handler RELEASES the dedupe claim so Stripe can retry', async () => {
    firestore.setTenantPlan.mockRejectedValueOnce(new Error('firestore blip'));
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_retry', type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'acme.com', metadata: { individual: '0' } } },
    });
    const res = await post();
    expect(res.status).toBe(500);
    expect(firestore.releaseWebhookEvent).toHaveBeenCalledWith('evt_retry');
  });

  test('invoice.payment_failed is acknowledged log-only (dunning handles the downgrade)', async () => {
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      id: 'evt_6', type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_9' } },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
  });
});

describe('billing/status pricing payload', () => {
  test('status carries the display-price table + quota limit from config/pricing', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
    app = buildApp();
    const res = await request(app).get('/api/billing/status').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.pricing.lifetime.label).toBe('$9.99');
    expect(res.body.pricing.quotaLimit).toBe(3);
  });
});

