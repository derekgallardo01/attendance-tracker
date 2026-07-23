// Tests for /api/billing/* — Stripe checkout, portal, status, webhook, and the
// requireProPlan gate. The Stripe SDK is mocked so no network calls happen.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

// Controllable Stripe instance returned by the mocked SDK factory.
const mockStripeInstance = {
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  webhooks: { constructEvent: jest.fn() },
};
jest.mock('stripe', () => jest.fn(() => mockStripeInstance));

jest.mock('../../src/services/firestore', () => ({
  getTenantPlan: jest.fn(),
  setTenantPlan: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free', billingStatus: null, stripeCustomerId: null });
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.STRIPE_WEBHOOK_SECRET;
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

  test('team overview is gated: 402 for a free domain once billing is live', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUser.mockResolvedValue({ email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true });
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(402);
    expect(res.body.upgrade).toBe(true);
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
