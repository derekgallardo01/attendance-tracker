// Error-path coverage for reengagement.js: the two evaluate* catch blocks, the
// non-ALREADY_EXISTS branches of the claim helpers, and recordAlertsSent (both
// its success write and its best-effort catch). _core is mocked so we control
// exactly what Firestore throws.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  tenantRef: jest.fn(),
  FieldValue: { serverTimestamp: () => 'TS' },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const {
  evaluateSeriesAlerts, evaluateReengagementForUser,
  claimReengagementSlot, claimDailyAlertSlot, recordAlertsSent,
} = require('../../src/services/firestore/reengagement');

afterEach(() => jest.clearAllMocks());

describe('evaluate* catch blocks', () => {
  test('evaluateSeriesAlerts returns [] and logs error on query failure', async () => {
    _core.tenantRef.mockReturnValue({
      collection: () => ({ where: () => ({ where: () => ({ get: () => Promise.reject(new Error('boom')) }) }), get: () => Promise.reject(new Error('boom')) }),
    });
    await expect(evaluateSeriesAlerts('acme.com', 'u@acme.com')).resolves.toEqual([]);
    expect(_core.log.error).toHaveBeenCalledWith('firestore: evaluateSeriesAlerts failed', expect.any(Object));
  });

  test('evaluateReengagementForUser returns [] and logs error on query failure', async () => {
    _core.tenantRef.mockReturnValue({
      collection: () => ({ doc: () => ({ get: () => Promise.reject(new Error('boom')) }), where: () => ({ get: () => Promise.reject(new Error('boom')) }) }),
    });
    await expect(evaluateReengagementForUser('acme.com', 'u@acme.com')).resolves.toEqual([]);
    expect(_core.log.error).toHaveBeenCalledWith('firestore: evaluateReengagementForUser failed', expect.any(Object));
  });
});

describe('claim helpers — non-ALREADY_EXISTS errors', () => {
  function mockCreate(err) {
    _core.tenantRef.mockReturnValue({ collection: () => ({ doc: () => ({ create: jest.fn().mockRejectedValue(err) }) }) });
  }

  test('claimReengagementSlot: ALREADY_EXISTS (code 6) → claimed:false, no warn', async () => {
    mockCreate(Object.assign(new Error('exists'), { code: 6 }));
    await expect(claimReengagementSlot('acme.com', 'u@acme.com', 'k')).resolves.toEqual({ claimed: false });
    expect(_core.log.warn).not.toHaveBeenCalled();
  });

  test('claimReengagementSlot: unexpected error → warns and claimed:false', async () => {
    mockCreate(new Error('firestore down'));
    await expect(claimReengagementSlot('acme.com', 'u@acme.com', 'k')).resolves.toEqual({ claimed: false });
    expect(_core.log.warn).toHaveBeenCalledWith('firestore: claimReengagementSlot failed', expect.any(Object));
  });

  test('claimDailyAlertSlot: unexpected error → warns and claimed:false', async () => {
    mockCreate(new Error('firestore down'));
    await expect(claimDailyAlertSlot('acme.com', 'u@acme.com')).resolves.toEqual({ claimed: false });
    expect(_core.log.warn).toHaveBeenCalledWith('firestore: claimDailyAlertSlot failed', expect.any(Object));
  });
});

describe('recordAlertsSent', () => {
  test('writes the alert payload with merge', async () => {
    const ref = { set: jest.fn().mockResolvedValue({}) };
    await recordAlertsSent(ref, [{ type: 'streak' }]);
    expect(ref.set).toHaveBeenCalledWith(
      expect.objectContaining({ alertCount: 1, alerts: [{ type: 'streak' }] }),
      { merge: true },
    );
  });

  test('swallows a write failure (best-effort)', async () => {
    const ref = { set: jest.fn().mockRejectedValue(new Error('write boom')) };
    await expect(recordAlertsSent(ref, [])).resolves.toBeUndefined();
    expect(_core.log.warn).toHaveBeenCalledWith('firestore: recordAlertsSent failed', expect.any(Object));
  });
});
