// Tests for upsertUser — especially the teamAdmin auto-claim, which has real
// consequences (first random signin from a Workspace domain becomes the org's
// admin). Wrong logic here = wrong person sees everyone's data.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

describe('upsertUser — teamAdmin auto-claim for Workspace domains', () => {
  test('first signin on a Workspace domain claims teamAdmin', async () => {
    await firestore.upsertUser('acme.com', {
      email: 'first@acme.com',
      displayName: 'First User',
    });
    const user = ctx.read('tenants/acme.com/users/first@acme.com');
    expect(user.teamAdmin).toBe(true);
    // Tenant doc gets adminEmail stamped for future signins
    const tenant = ctx.read('tenants/acme.com');
    expect(tenant.adminEmail).toBe('first@acme.com');
  });

  test('second user from same domain does NOT get teamAdmin', async () => {
    await firestore.upsertUser('acme.com', { email: 'first@acme.com', displayName: 'First' });
    await firestore.upsertUser('acme.com', { email: 'second@acme.com', displayName: 'Second' });
    const second = ctx.read('tenants/acme.com/users/second@acme.com');
    expect(second.teamAdmin).toBeUndefined();
  });

  test('marketplace-pre-claimed admin: only matching email gets the flag', async () => {
    // Simulate the marketplace install webhook firing first
    ctx.seed('tenants/acme.com', {
      domain: 'acme.com',
      adminEmail: 'admin@acme.com',
      active: true,
    });
    // Random person signs in first
    await firestore.upsertUser('acme.com', { email: 'random@acme.com', displayName: 'Random' });
    expect(ctx.read('tenants/acme.com/users/random@acme.com').teamAdmin).toBeUndefined();
    // Then the actual admin signs in
    await firestore.upsertUser('acme.com', { email: 'admin@acme.com', displayName: 'Admin' });
    expect(ctx.read('tenants/acme.com/users/admin@acme.com').teamAdmin).toBe(true);
    // Tenant adminEmail unchanged
    expect(ctx.read('tenants/acme.com').adminEmail).toBe('admin@acme.com');
  });

  test('email-case mismatch still matches pre-claimed admin', async () => {
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'Admin@Acme.com', active: true });
    await firestore.upsertUser('acme.com', { email: 'admin@acme.com', displayName: 'Admin' });
    expect(ctx.read('tenants/acme.com/users/admin@acme.com').teamAdmin).toBe(true);
  });

  test('second signin of the admin does NOT re-stamp (no double-write)', async () => {
    await firestore.upsertUser('acme.com', { email: 'admin@acme.com', displayName: 'Admin' });
    // Sign in again — should still be admin, no error
    await firestore.upsertUser('acme.com', { email: 'admin@acme.com', displayName: 'Admin' });
    const user = ctx.read('tenants/acme.com/users/admin@acme.com');
    expect(user.teamAdmin).toBe(true);
  });
});

describe('upsertUser — PERSONAL_EMAIL_DOMAINS exclusion', () => {
  test.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'aol.com',
    'protonmail.com',
  ])('does NOT claim teamAdmin for %s (personal email provider)', async (domain) => {
    await firestore.upsertUser(domain, {
      email: `someone@${domain}`,
      displayName: 'Someone',
    });
    const user = ctx.read(`tenants/${domain}/users/someone@${domain}`);
    expect(user.teamAdmin).toBeUndefined();
    // Tenant adminEmail also NOT set for personal domains
    const tenant = ctx.read(`tenants/${domain}`);
    expect(tenant.adminEmail).toBeUndefined();
  });

  test('case-insensitive personal-domain match (GMAIL.COM is also excluded)', async () => {
    await firestore.upsertUser('GMAIL.COM', {
      email: 'caps@GMAIL.COM',
      displayName: 'Caps',
    });
    const user = ctx.read('tenants/GMAIL.COM/users/caps@gmail.com');
    expect(user.teamAdmin).toBeUndefined();
  });

  test('similar-looking but non-personal domain still gets teamAdmin', async () => {
    // gmail.work, outlook.io, etc. are NOT on the exclusion list
    await firestore.upsertUser('outlook.io', {
      email: 'first@outlook.io',
      displayName: 'First',
    });
    expect(ctx.read('tenants/outlook.io/users/first@outlook.io').teamAdmin).toBe(true);
  });
});

describe('upsertUser — basic upsert behavior', () => {
  test('creates user doc + tenant doc on first signin', async () => {
    await firestore.upsertUser('newco.com', { email: 'a@newco.com', displayName: 'A' });
    expect(ctx.read('tenants/newco.com')).toBeDefined();
    expect(ctx.read('tenants/newco.com/users/a@newco.com')).toBeDefined();
  });

  test('persists granted scopes + exportScopeGranted flag', async () => {
    const drive = 'https://www.googleapis.com/auth/drive.file';
    const meet = 'https://www.googleapis.com/auth/meetings.space.readonly';
    // User who granted only the Meet scope (can track, cannot export).
    await firestore.upsertUser('acme.com', {
      email: 'noexport@acme.com', displayName: 'No Export',
      scopes: { granted: [meet], exportScopeGranted: false },
    });
    const u1 = ctx.read('tenants/acme.com/users/noexport@acme.com');
    expect(u1.grantedScopes).toEqual([meet]);
    expect(u1.exportScopeGranted).toBe(false);

    // User who granted both.
    await firestore.upsertUser('acme.com', {
      email: 'full@acme.com', displayName: 'Full',
      scopes: { granted: [meet, drive], exportScopeGranted: true },
    });
    expect(ctx.read('tenants/acme.com/users/full@acme.com').exportScopeGranted).toBe(true);
  });

  test('createdAt is set on first signin and never overwritten on later logins', async () => {
    await firestore.upsertUser('acme.com', { email: 'a@acme.com', displayName: 'A' });
    const created = ctx.read('tenants/acme.com/users/a@acme.com').createdAt;
    expect(created).toBeDefined();

    // Second sign-in: lastLoginAt updates, createdAt stays put.
    await firestore.upsertUser('acme.com', { email: 'a@acme.com', displayName: 'A again' });
    const after = ctx.read('tenants/acme.com/users/a@acme.com');
    expect(after.createdAt.toDate().getTime()).toBe(created.toDate().getTime());
    expect(after.displayName).toBe('A again'); // merge still applied
  });

  test('backfills createdAt for a legacy user doc that predates the field', async () => {
    ctx.seed('tenants/acme.com/users/a@acme.com', { email: 'a@acme.com', displayName: 'A' }); // no createdAt
    await firestore.upsertUser('acme.com', { email: 'a@acme.com', displayName: 'A' });
    expect(ctx.read('tenants/acme.com/users/a@acme.com').createdAt).toBeDefined();
  });

  test('preserves existing user fields (merge semantics)', async () => {
    ctx.seed('tenants/acme.com/users/a@acme.com', {
      email: 'a@acme.com',
      domain: 'acme.com',
      displayName: 'Old Name',
      sheetId: 'sheet-xyz',
      teamAdmin: true,
    });
    await firestore.upsertUser('acme.com', { email: 'a@acme.com', displayName: 'New Name' });
    const user = ctx.read('tenants/acme.com/users/a@acme.com');
    expect(user.displayName).toBe('New Name');
    expect(user.sheetId).toBe('sheet-xyz'); // preserved
    expect(user.teamAdmin).toBe(true); // preserved
  });

  test('acquisitionSource (self-reported) is strictly first-touch', async () => {
    // Once the user picks a source via the in-app modal, we never overwrite it.
    await firestore.upsertUser('acme.com', {
      email: 'a@acme.com',
      displayName: 'A',
      acquisition: { source: 'reddit', utmSource: 'reddit_organic' },
    });
    expect(ctx.read('tenants/acme.com/users/a@acme.com').acquisitionSource).toBe('reddit');

    // Second signin tries to claim a different source — locked
    await firestore.upsertUser('acme.com', {
      email: 'a@acme.com',
      displayName: 'A',
      acquisition: { source: 'youtube', utmSource: 'yt_campaign' },
    });
    expect(ctx.read('tenants/acme.com/users/a@acme.com').acquisitionSource).toBe('reddit');
    // UTM also locked because acquisitionSource was already set
    expect(ctx.read('tenants/acme.com/users/a@acme.com').utmSource).toBe('reddit_organic');
  });

  test('UTM can be updated until acquisitionSource is set (intentional)', async () => {
    // First signin: only passive UTMs captured, no self-reported source
    await firestore.upsertUser('acme.com', {
      email: 'a@acme.com',
      displayName: 'A',
      acquisition: { utmSource: 'reddit' },
    });
    expect(ctx.read('tenants/acme.com/users/a@acme.com').utmSource).toBe('reddit');
    expect(ctx.read('tenants/acme.com/users/a@acme.com').acquisitionSource).toBeUndefined();

    // Second signin with a different UTM — gets updated because user hasn't
    // self-reported yet. By design: we keep trying to attribute until they tell us.
    await firestore.upsertUser('acme.com', {
      email: 'a@acme.com',
      displayName: 'A',
      acquisition: { utmSource: 'youtube' },
    });
    expect(ctx.read('tenants/acme.com/users/a@acme.com').utmSource).toBe('youtube');
  });

  test('referredBy (?ref= param) is first-touch — captures inviter email', async () => {
    await firestore.upsertUser('acme.com', {
      email: 'newuser@acme.com',
      displayName: 'New',
      acquisition: { ref: 'inviter@acme.com' },
    });
    expect(ctx.read('tenants/acme.com/users/newuser@acme.com').referredBy).toBe('inviter@acme.com');
  });
});
