// Tests for meetApi.js — the thin retry wrapper around meet.googleapis.com/v2.
// Small module, but critical: silent failure here would strand every attendance
// export. The retry loop's exit invariants are the main thing to lock in.

const { meetGet, meetGetAll } = require('../../src/services/meetApi');

describe('meetGet', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  test('returns parsed JSON on first-try success', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ hello: 'world' }),
    });
    const result = await meetGet('conferenceRecords', 'tok-abc');
    expect(result).toEqual({ hello: 'world' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://meet.googleapis.com/v2/conferenceRecords');
    expect(opts.headers.Authorization).toBe('Bearer tok-abc');
  });

  test('retries on transient 5xx and returns on eventual success', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const result = await meetGet('conferenceRecords/x', 'tok', 2);
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  test('throws with body when all retries exhausted on 5xx', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 500, text: async () => 'server exploded',
    });
    await expect(meetGet('x', 'tok', 2)).rejects.toThrow(/Meet API 500: server exploded/);
    // Three attempts total (0, 1, 2)
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  test('does NOT retry on 4xx (no infinite loop on stale token)', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized',
    });
    await expect(meetGet('x', 'tok')).rejects.toThrow(/Meet API 401/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does NOT retry on 404 (meeting record not created yet)', async () => {
    global.fetch.mockResolvedValue({
      ok: false, status: 404, text: async () => 'not found',
    });
    await expect(meetGet('conferenceRecords/xxx', 'tok')).rejects.toThrow(/Meet API 404/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('propagates network error without retrying', async () => {
    global.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(meetGet('x', 'tok')).rejects.toThrow('ENOTFOUND');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('respects a custom retries count', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });
    await expect(meetGet('x', 'tok', 0)).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1); // no retries
  });
});

describe('meetGetAll', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  test('flattens a single page into an array', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ conferenceRecords: [{ id: 'a' }, { id: 'b' }] }),
    });
    const items = await meetGetAll('conferenceRecords', 'tok', 'conferenceRecords');
    expect(items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('follows nextPageToken across multiple pages', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 1 }], nextPageToken: 'page2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 2 }], nextPageToken: 'page3' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: 3 }] }), // no nextPageToken
      });
    const items = await meetGetAll('records/x/participants', 'tok', 'items');
    expect(items).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    // Second call should include the pageToken query string
    expect(global.fetch.mock.calls[1][0]).toContain('pageToken=page2');
    expect(global.fetch.mock.calls[2][0]).toContain('pageToken=page3');
  });

  test('uses "&" separator when path already has "?"', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [1], nextPageToken: 'p2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [2] }),
      });
    await meetGetAll('records/x?filter=abc', 'tok', 'items');
    // First call: no pageToken
    expect(global.fetch.mock.calls[0][0]).toContain('filter=abc');
    expect(global.fetch.mock.calls[0][0]).not.toContain('pageToken');
    // Second call: & separator, not ?
    expect(global.fetch.mock.calls[1][0]).toContain('filter=abc&pageToken=p2');
  });

  test('returns [] when the response key is absent', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const items = await meetGetAll('records', 'tok', 'items');
    expect(items).toEqual([]);
  });
});
