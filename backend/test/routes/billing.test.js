// Tests for /api/billing/* — Stripe checkout, portal, status, webhook, and the
// requireProPlan gate. The Stripe SDK is mocked so no network calls happen.

const request = require('supertest');
const { authedHeader, makeJwt, buildApp } = require('../helpers/testApp');

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

jest.mock('../../src/lib/notifications', () => ({
  sendUpgradeLinkEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendSubscriptionCancelledEmail: jest.fn().mockResolvedValue({ sent: true }),
  sendAdminEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

jest.mock('../../src/services/firestore', () => ({
  getTenantPlan: jest.fn(),
  setTenantPlan: jest.fn(),
  getUserPlan: jest.fn(),
  setUserPlan: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getTeamAdminStatus: jest.fn(), // requireTeamAdmin (runs before requireProPlan on /team/overview)
  countUserMonthlyExports: jest.fn().mockResolvedValue(0),
  countUserAutoExports: jest.fn().mockResolvedValue(0),
  getUserSettings: jest.fn().mockResolvedValue({}),
  logEvent: jest.fn(),
  claimWebhookEvent: jest.fn(), // webhook idempotency — default re-armed in beforeEach
  releaseWebhookEvent: jest.fn(),
  isEmailSuppressed: jest.fn().mockResolvedValue(false),
  persistExport: jest.fn().mockResolvedValue({ id: 'exp_123' }),
  isMeetingUnlocked: jest.fn().mockResolvedValue(false),
  markUserLargeClassGraceUsed: jest.fn().mockResolvedValue(true),
  isUserDeleted: jest.fn().mockResolvedValue(false),
}));

const firestore = require('../../src/services/firestore');
const notifications = require('../../src/lib/notifications');

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

  test('webhook subscription.deleted does not downgrade tenant when subscription is superseded', async () => {
    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'pro', billingStatus: 'active', stripeSubscriptionId: 'sub_active' });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_old', status: 'canceled', metadata: { domain: 'acme.com' } } },
    });
    await request(app)
      .post('/api/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'good')
      .send({});
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();
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

  test('webhook subscription.deleted does not downgrade user when subscription is superseded', async () => {
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'pro', billingStatus: 'active', stripeSubscriptionId: 'sub_user_active' });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_user_old', status: 'canceled', metadata: { individual: '1', domain: 'gmail.com', email: GMAIL } } },
    });
    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
  });

  test('webhook subscription.deleted does not downgrade user holding lifetime pass', async () => {
    firestore.getUserPlan.mockResolvedValueOnce({ plan: 'pro', individualPlanType: 'lifetime', billingStatus: 'active' });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_user_old', status: 'canceled', metadata: { individual: '1', domain: 'gmail.com', email: GMAIL } } },
    });
    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
    expect(firestore.setUserPlan).not.toHaveBeenCalled();
  });

  test('webhook subscription.deleted does not downgrade tenant when subscription is superseded or holding lifetime pass', async () => {
    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'pro', billingStatus: 'active', stripeSubscriptionId: 'sub_tenant_active' });
    mockStripeInstance.webhooks.constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_tenant_old', status: 'canceled', metadata: { domain: 'acme.com' } } },
    });
    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
    expect(firestore.setTenantPlan).not.toHaveBeenCalled();

    firestore.getTenantPlan.mockResolvedValueOnce({ plan: 'pro', planType: 'lifetime', billingStatus: 'active' });
    await request(app).post('/api/billing/webhook').set('Content-Type', 'application/json').set('stripe-signature', 'good').send({});
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

describe('billing — Department tier (mid-tier recurring DOMAIN plan, $59/yr)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_org_monthly';       // team price — Department must NEVER resolve to this
    process.env.STRIPE_ANNUAL_PRICE_ID = 'price_org_annual'; // institution price — nor this
    process.env.STRIPE_DEPARTMENT_PRICE_ID = 'price_dept_59';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
    mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/dept' });
    app = buildApp();
  });
  afterEach(() => {
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
    delete process.env.STRIPE_DEPARTMENT_PRICE_ID;
  });
  const params = () => mockStripeInstance.checkout.sessions.create.mock.calls[0][0];

  test('authed department checkout on a workspace domain → the DEPARTMENT price, subscription, domain-keyed', async () => {
    const res = await request(app).post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com')).send({ plan: 'department' });
    expect(res.status).toBe(200);
    const p = params();
    expect(p.line_items[0].price).toBe('price_dept_59'); // never the team/institution price
    expect(p.mode).toBe('subscription');
    expect(p.client_reference_id).toBe('acme.com');       // domain-keyed like team
    expect(p.metadata.individual).toBe('0');
    expect(p.metadata.plan).toBe('department');
  });

  test('a personal-email buyer cannot buy the Department (domain) plan → 400, no session', async () => {
    const res = await request(app).post('/api/billing/checkout')
      .set(authedHeader('teacher@gmail.com', 'gmail.com')).send({ plan: 'department' });
    expect(res.status).toBe(400);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('department price unset → 503, never a silent fallthrough to the team price', async () => {
    delete process.env.STRIPE_DEPARTMENT_PRICE_ID;
    app = buildApp();
    const res = await request(app).post('/api/billing/checkout')
      .set(authedHeader('admin@acme.com', 'acme.com')).send({ plan: 'department' });
    expect(res.status).toBe(503);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test('public department checkout with a work email → department price, domain-keyed', async () => {
    const res = await request(app).post('/api/billing/public-checkout')
      .send({ plan: 'department', email: 'head@acme.com' });
    expect(res.status).toBe(200);
    const p = params();
    expect(p.line_items[0].price).toBe('price_dept_59');
    expect(p.client_reference_id).toBe('acme.com');
    expect(p.metadata.individual).toBe('0');
  });

  test('public department checkout with NO email → 400 (webhook could not provision the domain)', async () => {
    const res = await request(app).post('/api/billing/public-checkout').send({ plan: 'department' });
    expect(res.status).toBe(400);
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalled();
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
      coupon: 'coup_123',
      max_redemptions: 1,
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

  test('Institution (team + annual) is a clean session — no discount ever applied even in PPP countries', async () => {
    process.env.STRIPE_ANNUAL_PRICE_ID = 'price_institution_149';
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'price_institution_149', type: 'recurring', recurring: { interval: 'year' } });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'team', interval: 'annual', email: 'admin@acme.edu.co' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items[0].price).toBe('price_institution_149');
    expect(params.discounts).toBeUndefined();
    expect(params.allow_promotion_codes).toBeUndefined();
    delete process.env.STRIPE_ANNUAL_PRICE_ID;
  });

  test('Department ($59/yr) is a clean session — no PPP discount ever applied', async () => {
    process.env.STRIPE_DEPARTMENT_PRICE_ID = 'price_dept_59';
    mockStripeInstance.prices.retrieve.mockResolvedValue({ id: 'price_dept_59', type: 'recurring', recurring: { interval: 'year' } });
    const res = await request(app).post('/api/billing/public-checkout')
      .set('Content-Type', 'application/json')
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'department', email: 'chair@physics.edu.co' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.line_items[0].price).toBe('price_dept_59');
    expect(params.discounts).toBeUndefined();
    delete process.env.STRIPE_DEPARTMENT_PRICE_ID;
  });

  test('Authed Team checkout does not apply PPP discount to domain license', async () => {
    process.env.STRIPE_PRICE_ID = 'price_team_1999';
    const res = await request(app).post('/api/billing/checkout')
      .set(authedHeader('admin@school.edu.co', 'school.edu.co'))
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'team' });
    expect(res.status).toBe(200);
    const params = mockStripeInstance.checkout.sessions.create.mock.calls[0][0];
    expect(params.discounts).toBeUndefined();
    delete process.env.STRIPE_PRICE_ID;
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
    expect(res.body.pricing.quotaLimit).toBe(2);
  });

  test('status detects PPP eligibility and returns domain teacher count', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
    if (firestore.getDomainTeacherCount) {
      firestore.getDomainTeacherCount.mockResolvedValueOnce(5);
    }
    app = buildApp();
    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('teacher@depedqc.ph', 'depedqc.ph'))
      .set('cf-ipcountry', 'PH');
    expect(res.status).toBe(200);
    expect(res.body.pppDiscount).toEqual({ eligible: true, country: 'PH', percentOff: 50 });
    expect(res.body.domain).toBe('depedqc.ph');
  });

  test('status detects PPP eligibility for expanded countries (MX, CL, TN, SO, PE, ZM, KZ)', async () => {
    app = buildApp();
    for (const country of ['MX', 'CL', 'TN', 'SO', 'PE', 'ZM', 'KZ']) {
      const res = await request(app)
        .get('/api/billing/status')
        .set(authedHeader(`user@school.${country.toLowerCase()}`, `school.${country.toLowerCase()}`))
        .set('cf-ipcountry', country);
      expect(res.status).toBe(200);
      expect(res.body.pppDiscount).toEqual({ eligible: true, country, percentOff: 50 });
    }
  });

  test('status detects PPP eligibility from x-forwarded-for IP GeoIP fallback when cf-ipcountry is absent', async () => {
    app = buildApp();
    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('teacher@depedqc.ph', 'depedqc.ph'))
      .set('x-forwarded-for', '120.28.221.70, 169.254.1.1');
    expect(res.status).toBe(200);
    expect(res.body.pppDiscount).toEqual({ eligible: true, country: 'PH', percentOff: 50 });
  });

  test('checkout auto-applies PPP50 coupon for emerging market user', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@colegio.edu.co', 'colegio.edu.co'))
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'lifetime' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        discounts: [{ coupon: 'PPP50' }],
        metadata: expect.objectContaining({ pppDiscount: '1', country: 'CO' }),
      })
    );
  });

  test('checkout honors custom promo code over PPP discount', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@colegio.edu.co', 'colegio.edu.co'))
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'lifetime', promo: 'SPECIALVIP' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        allow_promotion_codes: true,
      })
    );
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        discounts: [{ coupon: 'PPP50' }],
      })
    );
  });

  test('checkout for user in India (IN) routes to INR lifetime price and enables UPI + card', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID = 'price_inr_life_399';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@gmail.com', 'gmail.com'))
      .set('cf-ipcountry', 'IN')
      .send({ plan: 'lifetime' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_inr_life_399', quantity: 1 }],
      })
    );
    expect(mockStripeInstance.checkout.sessions.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        discounts: [{ coupon: 'PPP50' }],
      })
    );
    delete process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID;
  });

  test('checkout for user in India (IN) requesting educator plan routes to annual one-time payment in INR', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu_usd';
    process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID = 'price_inr_life_299';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@mituniversity.edu.in', 'mituniversity.edu.in'))
      .set('cf-ipcountry', 'IN')
      .send({ plan: 'educator' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'inr',
            product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
            unit_amount: 19900,
          },
          quantity: 1,
        }],
        metadata: expect.objectContaining({
          plan: 'educator',
          isAnnualOneTime: '1',
          individual: '1',
        }),
      })
    );
    delete process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID;
  });

  test('checkout for PPP eligible user (e.g. Nigeria NG) requesting educator uses dynamic $2.49 USD rate even when STRIPE_EDUCATOR_ANNUAL_PRICE_ID is set', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID = 'price_edu_annual_global';
    process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu_usd';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@uni.edu.ng', 'uni.edu.ng'))
      .set('cf-ipcountry', 'NG')
      .send({ plan: 'educator' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
            unit_amount: 249,
          },
          quantity: 1,
        }],
      })
    );
    delete process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID;
  });

  test('public-checkout for PPP eligible user (e.g. Colombia CO) requesting educator uses dynamic $2.49 USD rate even when STRIPE_EDUCATOR_ANNUAL_PRICE_ID is set', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID = 'price_edu_annual_global';
    process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu_usd';
    app = buildApp();
    const res = await request(app)
      .post('/api/billing/public-checkout')
      .set('cf-ipcountry', 'CO')
      .send({ plan: 'educator', email: 'teacher@colegio.edu.co' });
    expect(res.status).toBe(200);
    expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
            unit_amount: 249,
          },
          quantity: 1,
        }],
      })
    );
    delete process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID;
  });

  test('GET /billing/status for Indian user returns clean INR prices in pricing table', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('teacher@gmail.com', 'gmail.com'))
      .set('cf-ipcountry', 'IN');
    expect(res.status).toBe(200);
    expect(res.body.pricing.lifetime.label).toBe('₹299');
    expect(res.body.pricing.educator.label).toBe('₹199/yr');
    expect(res.body.educatorAvailable).toBe(true);
  });

  test('GET /billing/status includes trialInfo when user has autoExport trial started', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserSettings.mockResolvedValue({
      autoExportTrialStartedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
    });
    firestore.countUserAutoExports.mockResolvedValue(7);

    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('prof@neu.edu.ph', 'neu.edu.ph'))
      .set('cf-ipcountry', 'PH');

    expect(res.status).toBe(200);
    expect(res.body.trialInfo).toEqual({
      active: true,
      daysRemaining: 2,
      autoSavedClasses: 7,
      pppDiscount: true,
    });
  });

  test('POST /billing/school-license-request records lead and returns 200', async () => {
    const res = await request(app)
      .post('/api/billing/school-license-request')
      .set(authedHeader('dean@college.edu', 'college.edu'))
      .send({
        domain: 'college.edu',
        teacherName: 'Dean Smith',
        organizationName: 'College of Engineering',
        tier: 'department',
        adminEmail: 'it-admin@college.edu',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'School license request recorded' });
    expect(firestore.logEvent).toHaveBeenCalledWith(
      'college.edu',
      expect.objectContaining({
        type: 'school_license_requested',
        email: 'dean@college.edu',
        meta: expect.objectContaining({
          domain: 'college.edu',
          isEdu: true,
          teacherName: 'Dean Smith',
          organizationName: 'College of Engineering',
          tier: 'department',
          adminEmail: 'it-admin@college.edu',
        }),
      })
    );
    expect(notifications.sendAdminEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.any(String),
        subject: expect.stringContaining('College of Engineering'),
        body: expect.stringContaining('Dean Smith'),
      })
    );
  });

  test('POST /billing/school-license-request still succeeds when sendAdminEmail throws', async () => {
    notifications.sendAdminEmail.mockRejectedValueOnce(new Error('Resend down'));

    const res = await request(app)
      .post('/api/billing/school-license-request')
      .set(authedHeader('dean@college.edu', 'college.edu'))
      .send({ domain: 'college.edu' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /billing/school-license-request recognizes international edu domains (.edu.ph, .edu.my, .sch.id, .k12.org, .ac.uk, .education)', async () => {
    const testCases = [
      { email: 'prof@up.edu.ph', domain: 'up.edu.ph' },
      { email: 'dr@um.edu.my', domain: 'um.edu.my' },
      { email: 'guru@smp1.sch.id', domain: 'smp1.sch.id' },
      { email: 'admin@district.k12.org', domain: 'district.k12.org' },
      { email: 'fellow@oxford.ac.uk', domain: 'oxford.ac.uk' },
      { email: 'teacher@learn.education', domain: 'learn.education' },
    ];

    for (const { email, domain } of testCases) {
      firestore.logEvent.mockClear();
      const res = await request(app)
        .post('/api/billing/school-license-request')
        .set(authedHeader(email, domain))
        .send({
          domain,
          teacherName: 'Educator',
          organizationName: 'School Org',
          tier: 'institution',
        });

      expect(res.status).toBe(200);
      expect(firestore.logEvent).toHaveBeenCalledWith(
        domain,
        expect.objectContaining({
          type: 'school_license_requested',
          email,
          meta: expect.objectContaining({
            domain,
            isEdu: true,
            tier: 'institution',
          }),
        })
      );
    }
  });

  test('POST /billing/checkout rejects single_meeting without conferenceId', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .send({ plan: 'single_meeting' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Conference ID is required');
  });

  test('POST /billing/checkout creates single_meeting payment session without PPP50 coupon', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set(authedHeader('teacher@school.edu.ph', 'school.edu.ph'))
      .set('cf-ipcountry', 'PH')
      .send({ plan: 'single_meeting', conferenceId: 'xyz-abcd-efg' });

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();

    const p = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)[0];
    expect(p.mode).toBe('payment');
    expect(p.metadata.plan).toBe('single_meeting');
    expect(p.metadata.conferenceId).toBe('xyz-abcd-efg');
    expect(p.metadata.meetingPass).toBe('1');
    expect(p.discounts).toBeUndefined(); // single_meeting does not get PPP50
  });

  test('GET /billing/status recognizes .education and UA for PPP discount', async () => {
    app = buildApp();
    const res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('o.paiuk@kig.kiev.ukr.education', 'kig.kiev.ukr.education'))
      .set('cf-ipcountry', 'UA');

    expect(res.status).toBe(200);
    expect(res.body.isEdu).toBe(true);
    expect(res.body.pppDiscount).toEqual({ eligible: true, country: 'UA', percentOff: 50 });
  });

  test('POST /billing/school-license-request returns 500 when logEvent fails', async () => {
    firestore.logEvent.mockRejectedValue(new Error('firestore failure'));

    const res = await request(app)
      .post('/api/billing/school-license-request')
      .set(authedHeader('dean@college.edu', 'college.edu'))
      .send({ domain: 'college.edu' });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to record school license request' });
  });

  test('GET /billing/status skips trialInfo if user is Pro or date is invalid or settings throws', async () => {
    // 1. Pro user
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'pro' });
    firestore.getUserSettings.mockResolvedValue({
      autoExportTrialStartedAt: new Date().toISOString(),
    });

    let res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('pro@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.trialInfo).toBeNull();

    // 2. Invalid date string
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserSettings.mockResolvedValue({
      autoExportTrialStartedAt: 'not-a-valid-date-string',
    });

    res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('free@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.trialInfo).toBeNull();

    // 3. Settings error
    firestore.getUserSettings.mockRejectedValue(new Error('settings read error'));
    res = await request(app)
      .get('/api/billing/status')
      .set(authedHeader('free@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.trialInfo).toBeNull();
  });

  describe('POST /billing/send-upgrade-link', () => {
    const { sendUpgradeLinkEmail } = require('../../src/lib/notifications');

    test('401 without auth', async () => {
      const res = await request(app).post('/api/billing/send-upgrade-link').send({});
      expect(res.status).toBe(401);
    });

    test('sends upgrade link email with Stripe checkout sessions and rate limits', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu';
      process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
      app = buildApp();

      const uniqueEmail = `teacher_${Date.now()}@school.edu`;
      const res = await request(app)
        .post('/api/billing/send-upgrade-link')
        .set(authedHeader(uniqueEmail, 'school.edu'))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(sendUpgradeLinkEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: uniqueEmail,
        educatorPrice: '$3.99',
        lifetimePrice: '$7.99',
      }));
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
        discounts: [{ coupon: 'SAVE20' }],
      }));

      // Immediate second call triggers cooldown / alreadySent: true without re-sending email
      sendUpgradeLinkEmail.mockClear();
      const res2 = await request(app)
        .post('/api/billing/send-upgrade-link')
        .set(authedHeader(uniqueEmail, 'school.edu'))
        .send({});
      expect(res2.status).toBe(200);
      expect(res2.body.alreadySent).toBe(true);
      expect(sendUpgradeLinkEmail).not.toHaveBeenCalled();
    });

    test('sends upgrade link email with PPP 50% discount for emerging market user', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu';
      process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
      app = buildApp();

      const uniqueEmail = `teacher_co_${Date.now()}@colegio.edu.co`;
      const res = await request(app)
        .post('/api/billing/send-upgrade-link')
        .set(authedHeader(uniqueEmail, 'colegio.edu.co'))
        .set('cf-ipcountry', 'CO')
        .send({});

      expect(res.status).toBe(200);
      expect(sendUpgradeLinkEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: uniqueEmail,
        educatorPrice: '$2.49',
        lifetimePrice: '$4.99',
        isPpp: true,
      }));
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
        discounts: [{ coupon: 'PPP50' }],
      }));
    });

    test('falls back without discount when coupon fails during checkout session creation', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu';
      process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_life';
      app = buildApp();

      let callCount = 0;
      mockStripeInstance.checkout.sessions.create.mockImplementation(async (params) => {
        if (params.discounts) {
          throw new Error("No such coupon: 'SAVE20'");
        }
        return { id: 'cs_fallback', url: 'https://checkout.stripe.com/pay/cs_fallback' };
      });

      const uniqueEmail = `teacher_fallback_${Date.now()}@school.edu`;
      const res = await request(app)
        .post('/api/billing/send-upgrade-link')
        .set(authedHeader(uniqueEmail, 'school.edu'))
        .send({});

      expect(res.status).toBe(200);
      expect(sendUpgradeLinkEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: uniqueEmail,
        educatorUrl: 'https://checkout.stripe.com/pay/cs_fallback',
        lifetimeUrl: 'https://checkout.stripe.com/pay/cs_fallback',
      }));
    });

    test('sendUpgradeLinkForUser skips if user is already pro or suppressed', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu';
      const { sendUpgradeLinkForUser } = require('../../src/routes/billing');

      firestore.getUserPlan.mockResolvedValue({ plan: 'pro' });
      const resPro = await sendUpgradeLinkForUser({
        email: 'pro_user@school.edu',
        domain: 'school.edu',
        reason: 'large_class',
      });
      expect(resPro.skipped).toBe('already_pro');

      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.isEmailSuppressed.mockResolvedValue(true);
      const resSupp = await sendUpgradeLinkForUser({
        email: 'suppressed_user@school.edu',
        domain: 'school.edu',
        reason: 'large_class',
      });
      expect(resSupp.skipped).toBe('suppressed');
    });
  });

  describe('POST /billing/cancel-subscription and /billing/resume-subscription', () => {
    const { sendSubscriptionCancelledEmail } = require('../../src/lib/notifications');

    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      app = buildApp();
    });

    test('cancel-subscription 401 without auth', async () => {
      const res = await request(app).post('/api/billing/cancel-subscription').send({});
      expect(res.status).toBe(401);
    });

    test('cancel-subscription 404 when user has no active subscription', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free', stripeSubscriptionId: null });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free', stripeSubscriptionId: null });

      const res = await request(app)
        .post('/api/billing/cancel-subscription')
        .set(authedHeader('user@school.edu', 'school.edu'))
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No active recurring subscription');
    });

    test('cancel-subscription successfully updates Stripe and sends email confirmation', async () => {
      const periodEndTs = Math.floor(Date.now() / 1000) + 30 * 86400;
      firestore.getUserPlan.mockResolvedValue({
        plan: 'pro',
        stripeSubscriptionId: 'sub_12345',
        stripeCustomerId: 'cus_123',
        billingStatus: 'active',
      });
      mockStripeInstance.subscriptions.update.mockResolvedValue({
        id: 'sub_12345',
        cancel_at_period_end: true,
        cancel_at: periodEndTs,
        current_period_end: periodEndTs,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/billing/cancel-subscription')
        .set(authedHeader('user@school.edu', 'school.edu'))
        .send({ language: 'es', country: 'ES' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cancelAtPeriodEnd).toBe(true);
      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        'sub_12345',
        { cancel_at_period_end: true }
      );
      expect(firestore.setUserPlan).toHaveBeenCalledWith(
        'school.edu',
        'user@school.edu',
        expect.objectContaining({
          cancelAtPeriodEnd: true,
          cancelAt: expect.any(String),
          currentPeriodEnd: expect.any(String),
        })
      );
      expect(sendSubscriptionCancelledEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'user@school.edu',
        language: 'es',
        country: 'ES',
      }));
    });

    test('resume-subscription 404 when no subscription exists', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free', stripeSubscriptionId: null });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free', stripeSubscriptionId: null });

      const res = await request(app)
        .post('/api/billing/resume-subscription')
        .set(authedHeader('user@school.edu', 'school.edu'))
        .send({});

      expect(res.status).toBe(404);
    });

    test('resume-subscription successfully reactivates renewal in Stripe and Firestore', async () => {
      firestore.getUserPlan.mockResolvedValue({
        plan: 'pro',
        stripeSubscriptionId: 'sub_12345',
        cancelAtPeriodEnd: true,
      });
      mockStripeInstance.subscriptions.update.mockResolvedValue({
        id: 'sub_12345',
        cancel_at_period_end: false,
        status: 'active',
      });

      const res = await request(app)
        .post('/api/billing/resume-subscription')
        .set(authedHeader('user@school.edu', 'school.edu'))
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cancelAtPeriodEnd).toBe(false);
      expect(mockStripeInstance.subscriptions.update).toHaveBeenCalledWith(
        'sub_12345',
        { cancel_at_period_end: false }
      );
      expect(firestore.setUserPlan).toHaveBeenCalledWith(
        'school.edu',
        'user@school.edu',
        expect.objectContaining({
          cancelAtPeriodEnd: false,
          cancelAt: null,
        })
      );
    });
  });

  describe('super-admin automatic Pro access and quota bypass', () => {
    const { planIsPro } = require('../../src/routes/billing');

    test('planIsPro returns true for super-admin emails', async () => {
      expect(await planIsPro('gmail.com', 'derekgallardo01@gmail.com')).toBe(true);
      expect(await planIsPro('gmail.com', 'kinetichelix.dev@gmail.com')).toBe(true);
    });

    test('GET /billing/status grants Pro plan and null exportQuota to super-admin', async () => {
      app = buildApp();
      const res = await request(app)
        .get('/api/billing/status')
        .set(authedHeader('kinetichelix.dev@gmail.com', 'gmail.com'));

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('pro');
      expect(res.body.exportQuota).toBeNull();
      expect(res.body.isSuperAdmin).toBe(true);
    });
  });

  describe('malformed price env var resilience', () => {
    test('authed checkout sanitizes priceId if env var has concatenated space-separated tokens', async () => {
      const orig = process.env.STRIPE_SINGLE_MEETING_PRICE_ID;
      process.env.STRIPE_SINGLE_MEETING_PRICE_ID = 'price_1UKowpRPP93YBXrOjjKjUUlz STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID=price_1UKowpRPP93YBXrOVreZdJO3';
      app = buildApp();
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .send({ plan: 'single_meeting', conferenceId: 'abc-defg-hij' });
      expect(res.status).toBe(200);
      const p = mockStripeInstance.checkout.sessions.create.mock.calls.at(-1)[0];
      expect(p.line_items[0].price).toBe('price_1UKowpRPP93YBXrOjjKjUUlz');
      process.env.STRIPE_SINGLE_MEETING_PRICE_ID = orig;
    });
  });

  describe('createSafeCheckoutSession resilience & sanitization', () => {
    const { createSafeCheckoutSession } = require('../../src/routes/billing');

    test('strips automatic_payment_methods and sanitizes metadata', async () => {
      const mockStripe = {
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: 'cs_safe', url: 'https://checkout.stripe.com/pay/cs_safe' }),
          },
        },
      };

      const params = {
        mode: 'payment',
        automatic_payment_methods: { enabled: true },
        metadata: {
          shortKey: 'hello',
          nullVal: null,
          undefVal: undefined,
          veryLongVal: 'a'.repeat(600),
        },
        payment_intent_data: {
          metadata: {
            shortKey: 'hello_pi',
          },
        },
      };

      const res = await createSafeCheckoutSession(mockStripe, params, { test: true });
      expect(res.id).toBe('cs_safe');
      const calledWith = mockStripe.checkout.sessions.create.mock.calls[0][0];
      expect(calledWith.automatic_payment_methods).toBeUndefined();
      expect(calledWith.metadata.shortKey).toBe('hello');
      expect(calledWith.metadata.nullVal).toBeUndefined();
      expect(calledWith.metadata.veryLongVal.length).toBe(500);
      expect(calledWith.payment_intent_data.metadata.shortKey).toBe('hello_pi');
    });

    test('retries without discounts when Stripe rejects coupon', async () => {
      const mockStripe = {
        checkout: {
          sessions: {
            create: jest.fn()
              .mockRejectedValueOnce(new Error("No such coupon: 'PPP50'"))
              .mockResolvedValueOnce({ id: 'cs_retry_success', url: 'https://checkout.stripe.com/pay/cs_retry_success' }),
          },
        },
      };

      const params = {
        mode: 'subscription',
        discounts: [{ coupon: 'PPP50' }],
        line_items: [{ price: 'price_edu', quantity: 1 }],
      };

      const res = await createSafeCheckoutSession(mockStripe, params, { plan: 'educator' });
      expect(res.id).toBe('cs_retry_success');
      expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
      expect(mockStripe.checkout.sessions.create.mock.calls[0][0].discounts).toBeDefined();
      expect(mockStripe.checkout.sessions.create.mock.calls[1][0].discounts).toBeUndefined();
    });

    test('rethrows non-discount Stripe errors', async () => {
      const mockStripe = {
        checkout: {
          sessions: {
            create: jest.fn().mockRejectedValue(new Error('Stripe API network timeout')),
          },
        },
      };

      await expect(createSafeCheckoutSession(mockStripe, { mode: 'payment' })).rejects.toThrow('Stripe API network timeout');
    });

    test('/api/billing/checkout recovers seamlessly when PPP50 coupon fails in Stripe', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_indiv';
      app = buildApp();

      mockStripeInstance.checkout.sessions.create
        .mockRejectedValueOnce(new Error("No such coupon: 'PPP50'"))
        .mockResolvedValueOnce({ id: 'cs_recovered', url: 'https://checkout.stripe.com/pay/cs_recovered' });

      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@babcock.edu.ng', 'babcock.edu.ng'))
        .set('cf-ipcountry', 'NG')
        .send({ plan: 'individual' });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_recovered');
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledTimes(2);
    });

    test('/api/billing/public-checkout recovers seamlessly when coupon fails in Stripe', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_indiv';
      app = buildApp();

      mockStripeInstance.checkout.sessions.create
        .mockRejectedValueOnce(new Error("No such coupon: 'PPP50'"))
        .mockResolvedValueOnce({ id: 'cs_public_recovered', url: 'https://checkout.stripe.com/pay/cs_public_recovered' });

      const res = await request(app)
        .post('/api/billing/public-checkout')
        .set('cf-ipcountry', 'NG')
        .send({ plan: 'individual', email: 'teacher@babcock.edu.ng' });

      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/pay/cs_public_recovered');
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('POST /api/billing/record-export', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_INDIVIDUAL_PRICE_ID = 'price_indiv';
      app = buildApp();
    });

    test('401 without auth', async () => {
      const res = await request(app).post('/api/billing/record-export').send({});
      expect(res.status).toBe(401);
    });

    test('returns { success: true, isPro: true } without counting for Pro users', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'pro' });
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('pro@gmail.com', 'gmail.com'))
        .send({ exportType: 'csv', participantCount: 50 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isPro).toBe(true);
      expect(firestore.persistExport).not.toHaveBeenCalled();
    });

    test('returns 402 largeClass if participantCount exceeds 25 on free tier when grace already used', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getUser.mockResolvedValue({ hasUsedLargeClassGrace: true });
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('free@gmail.com', 'gmail.com'))
        .send({ exportType: 'csv', participantCount: 26 });
      expect(res.status).toBe(402);
      expect(res.body.feature).toBe('largeClass');
      expect(firestore.persistExport).not.toHaveBeenCalled();
    });

    test('grants grace on first large class (>25 attendees) on free tier', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getUser.mockResolvedValue({ hasUsedLargeClassGrace: false });
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('free@gmail.com', 'gmail.com'))
        .send({ exportType: 'csv', participantCount: 26 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.graceUsed).toBe(true);
      expect(res.body.participantCount).toBe(26);
      expect(firestore.markUserLargeClassGraceUsed).toHaveBeenCalledWith('gmail.com', 'free@gmail.com');
      expect(firestore.persistExport).toHaveBeenCalled();
    });

    test('returns 402 exportQuota if free user has reached monthly export limit', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.countUserMonthlyExports.mockResolvedValue(2);
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('free@gmail.com', 'gmail.com'))
        .send({ exportType: 'excel', participantCount: 15 });
      expect(res.status).toBe(402);
      expect(res.body.feature).toBe('exportQuota');
      expect(res.body.used).toBe(2);
      expect(res.body.limit).toBe(2);
      expect(firestore.persistExport).not.toHaveBeenCalled();
    });

    test('records export and returns updated quota for free user', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.countUserMonthlyExports.mockResolvedValue(1);
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('free@gmail.com', 'gmail.com'))
        .send({
          exportType: 'csv',
          participantCount: 20,
          conferenceId: 'conf-123',
          meetingTitle: 'Math 101',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.quota).toEqual({ used: 2, limit: 2 });
      expect(firestore.persistExport).toHaveBeenCalledWith('gmail.com', expect.objectContaining({
        domain: 'gmail.com',
        email: 'free@gmail.com',
        conferenceId: 'conf-123',
        meetingTitle: 'Math 101',
        participantCount: 20,
        exportType: 'csv',
      }));
    });

    test('allows unlocked meeting through even if participantCount > 25 and used >= limit', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.isMeetingUnlocked.mockResolvedValue(true);
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('free@gmail.com', 'gmail.com'))
        .send({
          exportType: 'csv',
          participantCount: 150,
          conferenceId: 'conf-unlocked-1',
          meetingTitle: 'Mega Assembly',
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.meetingUnlocked).toBe(true);
      expect(firestore.persistExport).not.toHaveBeenCalled();
    });
  });

  describe('Regional & PPP educator annual one-time checkout', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_default';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu_usd';
      app = buildApp();
    });

    test('Philippines (PH) educator checkout creates mode: payment session with PHP price_data', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@deped.gov.ph', 'deped.gov.ph'))
        .set('cf-ipcountry', 'PH')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'php',
              product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              unit_amount: 14000,
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            plan: 'educator',
            isAnnualOneTime: '1',
            individual: '1',
            country: 'PH',
            currency: 'php',
          }),
        })
      );
    });

    test('Philippines (PH) educator checkout with configured price ID uses configured price', async () => {
      process.env.STRIPE_EDUCATOR_PHP_PRICE_ID = 'price_edu_php_env';
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@deped.gov.ph', 'deped.gov.ph'))
        .set('cf-ipcountry', 'PH')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{ price: 'price_edu_php_env', quantity: 1 }],
        })
      );
      delete process.env.STRIPE_EDUCATOR_PHP_PRICE_ID;
    });

    test('Malaysia (MY) educator checkout creates mode: payment session with MYR price_data', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@moe.edu.my', 'moe.edu.my'))
        .set('cf-ipcountry', 'MY')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'myr',
              product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              unit_amount: 1200,
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            plan: 'educator',
            isAnnualOneTime: '1',
            individual: '1',
            country: 'MY',
            currency: 'myr',
          }),
        })
      );
    });

    test('Indonesia (ID) educator checkout creates mode: payment session with IDR price_data', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@kemdikbud.go.id', 'kemdikbud.go.id'))
        .set('cf-ipcountry', 'ID')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'idr',
              product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              unit_amount: 3900000,
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            plan: 'educator',
            isAnnualOneTime: '1',
            individual: '1',
            country: 'ID',
            currency: 'idr',
          }),
        })
      );
    });

    test('PPP-eligible country (e.g. Nigeria NG) educator checkout creates mode: payment session with $2.49 USD price_data', async () => {
      const res = await request(app)
        .post('/api/billing/checkout')
        .set(authedHeader('teacher@babcock.edu.ng', 'babcock.edu.ng'))
        .set('cf-ipcountry', 'NG')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              unit_amount: 249,
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            plan: 'educator',
            isAnnualOneTime: '1',
            individual: '1',
            country: 'NG',
            currency: 'usd',
          }),
        })
      );
    });

    test('public-checkout creates mode: payment session for regional educator even when STRIPE_EDUCATOR_PRICE_ID is unset', async () => {
      delete process.env.STRIPE_EDUCATOR_PRICE_ID;
      const res = await request(app)
        .post('/api/billing/public-checkout')
        .set('cf-ipcountry', 'PH')
        .send({ plan: 'educator' });
      expect(res.status).toBe(200);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'php',
              product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              unit_amount: 14000,
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            plan: 'educator',
            isAnnualOneTime: '1',
            individual: '1',
            country: 'PH',
          }),
        })
      );
    });
  });

  describe('Webhook: checkout.session.completed for educator annual one-time pass', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_x';
      process.env.STRIPE_PRICE_ID = 'price_x';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_x';
      app = buildApp();
    });

    test('provisions individualPlanType educator_annual with 1 year expiration when non-subscription', async () => {
      mockStripeInstance.webhooks.constructEvent.mockReturnValue({
        id: 'evt_edu_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_edu_annual_123',
            client_reference_id: 'user:teacher@deped.gov.ph',
            customer: 'cus_edu_1',
            subscription: null,
            metadata: {
              individual: '1',
              plan: 'educator',
              isAnnualOneTime: '1',
              domain: 'deped.gov.ph',
              email: 'teacher@deped.gov.ph',
            },
            amount_total: 14000,
            currency: 'php',
          },
        },
      });

      const res = await request(app)
        .post('/api/billing/webhook')
        .set('Content-Type', 'application/json')
        .send(Buffer.from('{}'));

      expect(res.status).toBe(200);
      expect(firestore.setUserPlan).toHaveBeenCalledWith(
        'deped.gov.ph',
        'teacher@deped.gov.ph',
        expect.objectContaining({
          individualPlan: 'pro',
          individualBillingStatus: 'active',
          individualPlanType: 'educator_annual',
          individualPlanExpiresAt: expect.any(String),
          individualStripeCustomerId: 'cus_edu_1',
          individualStripeSubscriptionId: null,
        })
      );

      const callArgs = firestore.setUserPlan.mock.calls[0][2];
      const expiry = new Date(callArgs.individualPlanExpiresAt).getTime();
      const now = Date.now();
      const diffDays = Math.round((expiry - now) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(364);
      expect(diffDays).toBeLessThanOrEqual(366);
    });
  });

  describe('GET /api/billing/checkout-redirect', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_x';
      process.env.STRIPE_PRICE_ID = 'price_domain';
      process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID = 'price_lifetime';
      process.env.STRIPE_EDUCATOR_PRICE_ID = 'price_edu';
      process.env.STRIPE_SINGLE_MEETING_PRICE_ID = 'price_sm';
      app = buildApp();
      firestore.getUser.mockResolvedValue({ email: 'teacher@deped.gov.ph', domain: 'deped.gov.ph' });
      firestore.isUserDeleted.mockResolvedValue(false);
      mockStripeInstance.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' });
    });

    test('302 redirects to Stripe Checkout URL when authed via header', async () => {
      const res = await request(app)
        .get('/api/billing/checkout-redirect?plan=educator')
        .set(authedHeader('teacher@deped.gov.ph', 'deped.gov.ph'));

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    });

    test('302 redirects to Stripe Checkout URL when authed via ?token query param', async () => {
      const token = makeJwt({ email: 'teacher@deped.gov.ph', domain: 'deped.gov.ph' });
      const res = await request(app)
        .get(`/api/billing/checkout-redirect?plan=lifetime&token=${encodeURIComponent(token)}`);

      expect(res.status).toBe(302);
      expect(res.header.location).toBe('https://checkout.stripe.com/c/pay/cs_test_123');
    });

    test('redirects to index.html with checkout_error when token is invalid or missing', async () => {
      const res = await request(app)
        .get('/api/billing/checkout-redirect?plan=lifetime');

      expect(res.status).toBe(302);
      expect(res.header.location).toContain('/index.html?checkout_error=');
      expect(res.header.location).toContain('Please%20sign%20in');
    });

    test('redirects to index.html with checkout_error when user is deleted', async () => {
      firestore.isUserDeleted.mockResolvedValue(true);
      const token = makeJwt({ email: 'deleted@school.edu', domain: 'school.edu' });
      const res = await request(app)
        .get(`/api/billing/checkout-redirect?plan=lifetime&token=${encodeURIComponent(token)}`);

      expect(res.status).toBe(302);
      expect(res.header.location).toContain('This%20account%20has%20been%20deleted');
    });

    test('supports single_meeting pass with conferenceId and regional pricing in PH', async () => {
      const token = makeJwt({ email: 'teacher@deped.gov.ph', domain: 'deped.gov.ph' });
      const res = await request(app)
        .get(`/api/billing/checkout-redirect?plan=single_meeting&conferenceId=conf-123&country=ph&token=${encodeURIComponent(token)}`);

      expect(res.status).toBe(302);
      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'payment',
          payment_method_types: ['card', 'gcash', 'grabpay'],
          line_items: [{
            price_data: {
              currency: 'php',
              unit_amount: 9900,
              product_data: { name: 'Attendance Tracker Pro (Single Meeting Pass)' },
            },
            quantity: 1,
          }],
          metadata: expect.objectContaining({
            conferenceId: 'conf-123',
            meetingPass: '1',
          }),
        })
      );
    });

    test('redirects to index.html with checkout_error if Stripe checkout session creation fails', async () => {
      mockStripeInstance.checkout.sessions.create.mockRejectedValue(new Error('Stripe card rails error'));
      const token = makeJwt({ email: 'teacher@deped.gov.ph', domain: 'deped.gov.ph' });
      const res = await request(app)
        .get(`/api/billing/checkout-redirect?plan=lifetime&token=${encodeURIComponent(token)}`);

      expect(res.status).toBe(302);
      expect(res.header.location).toContain('Stripe%20card%20rails%20error');
    });
  });

  describe('POST /api/billing/record-export quota & grace interaction', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_x';
      process.env.STRIPE_PRICE_ID = 'price_domain';
      app = buildApp();
      firestore.getUser.mockResolvedValue({ email: 'user@school.edu', domain: 'school.edu', hasUsedLargeClassGrace: false });
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    });

    afterEach(() => {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_ID;
    });

    test('does not consume large class grace if monthly export quota is exhausted', async () => {
      firestore.countUserMonthlyExports.mockResolvedValue(2);
      const res = await request(app)
        .post('/api/billing/record-export')
        .set(authedHeader('user@school.edu', 'school.edu'))
        .send({
          exportType: 'csv',
          participantCount: 30,
        });

      expect(res.status).toBe(402);
      expect(res.body.feature).toBe('exportQuota');
      expect(firestore.markUserLargeClassGraceUsed).not.toHaveBeenCalled();
    });
  });
});



