// Error-path coverage for the share-link surface: both resolveShareLink and
// getSharedSeriesView swallow Firestore failures and return null rather than
// surfacing a 500 to a public recipient. Mock _core to force the throw.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  tenantRef: jest.fn(),
  FieldValue: { increment: () => 1, serverTimestamp: () => 'TS' },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const { resolveShareLink, getSharedSeriesView } = require('../../src/services/firestore/shareLinks');

afterEach(() => jest.clearAllMocks());

test('resolveShareLink returns null and warns when the read throws', async () => {
  _core.getDb.mockReturnValue({
    collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('read boom')) }) }),
  });
  await expect(resolveShareLink('tok')).resolves.toBeNull();
  expect(_core.log.warn).toHaveBeenCalled();
});

test('getSharedSeriesView returns null and logs error when the query throws', async () => {
  _core.tenantRef.mockReturnValue({
    collection: () => ({ where: () => ({ get: () => Promise.reject(new Error('query boom')) }) }),
  });
  await expect(getSharedSeriesView('acme.com', 'series-1')).resolves.toBeNull();
  expect(_core.log.error).toHaveBeenCalled();
});

test('resolveShareLink swallows a failed viewCount bump (fire-and-forget catch)', async () => {
  const snap = {
    exists: true,
    data: () => ({ type: 'series', domain: 'acme.com', ownerEmail: 'o@acme.com', recurringEventId: 'r', revoked: false, expiresAt: null }),
    ref: { update: jest.fn().mockRejectedValue(new Error('bump fail')) },
  };
  _core.getDb.mockReturnValue({ collection: () => ({ doc: () => ({ get: async () => snap }) }) });
  const res = await resolveShareLink('tok-ok');
  expect(res).toMatchObject({ token: 'tok-ok', recurringEventId: 'r' });
  await new Promise((r) => setImmediate(r)); // let the rejected update settle into .catch
  expect(snap.ref.update).toHaveBeenCalled();
});
