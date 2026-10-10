// Tests for meetApi.js — the thin retry wrapper around meet.googleapis.com/v2.
// Small module, but critical: silent failure here would strand every attendance
// export. The retry loop's exit invariants are the main thing to lock in.

const { meetGet, meetGetAll, fetchConferenceParticipants } = require('../../src/services/meetApi');

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

  test('retries on 429 (quota) then succeeds', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null }, text: async () => 'RESOURCE_EXHAUSTED' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const result = await meetGet('x/participantSessions', 'tok', 2);
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  test('a persistent 429 throws an error carrying .status = 429 (callers degrade gracefully)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null }, text: async () => 'RESOURCE_EXHAUSTED' });
    await expect(meetGet('x', 'tok', 2)).rejects.toMatchObject({ status: 429 });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  }, 15000);

  test('honors Retry-After header on a 429', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: (h) => h === 'retry-after' ? '1' : null }, text: async () => 'slow down' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ done: true }) });
    const result = await meetGet('x', 'tok', 2);
    expect(result).toEqual({ done: true });
  }, 15000);

  test('4xx (non-429) errors also carry .status for caller branching', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden' });
    await expect(meetGet('x', 'tok')).rejects.toMatchObject({ status: 403 });
  });

  test('retries on network error, then throws when exhausted', async () => {
    global.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(meetGet('x', 'tok', 2)).rejects.toThrow(/Meet API request failed: ENOTFOUND/);
    expect(global.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  }, 15000);

  test('recovers if a network error is followed by success', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const result = await meetGet('x', 'tok', 2);
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  test('recovers if response body stream aborts (terminated / other side closed)', async () => {
    const socketErr = new TypeError('terminated');
    socketErr.cause = new Error('other side closed');
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => { throw socketErr; },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ recovered: true }),
      });
    const result = await meetGet('conferenceRecords/stream-drop', 'tok', 2);
    expect(result).toEqual({ recovered: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  test('treats a timeout (AbortError) as a retryable failure', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    global.fetch.mockRejectedValue(abortErr);
    await expect(meetGet('x', 'tok', 1)).rejects.toMatchObject({
      message: expect.stringMatching(/Meet API timeout after \d+ms/),
      isNetworkError: true,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  }, 15000);

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

describe('meetGet — request timeout (abort)', () => {
  afterEach(() => { delete global.fetch; jest.resetModules(); });

  test('fires the abort timer and throws a timeout error when the request hangs', async () => {
    jest.resetModules();
    process.env.MEET_TIMEOUT_MS = '30';
    const { meetGet } = require('../../src/services/meetApi');
    // fetch never resolves on its own; it rejects only when the abort signal
    // fires — i.e. when meetGet's timeout callback calls controller.abort().
    global.fetch = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })));
    }));
    await expect(meetGet('conferenceRecords', 'tok', 0)).rejects.toThrow(/timeout/i);
    delete process.env.MEET_TIMEOUT_MS;
  });
});

describe('fetchConferenceParticipants', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  test('marks participants within 2-3 minutes of meetingEndTime as present, earlier leavers as absent', async () => {
    const meetingEnd = '2026-03-01T11:00:00Z';
    // Mock participants listing
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('p-stayed/participantSessions')) {
        return {
          ok: true,
          json: async () => ({
            participantSessions: [
              { startTime: '2026-03-01T10:00:00Z', endTime: '2026-03-01T10:58:30Z' }, // 1.5 min before end
            ],
          }),
        };
      }
      if (url.includes('p-left-early/participantSessions')) {
        return {
          ok: true,
          json: async () => ({
            participantSessions: [
              { startTime: '2026-03-01T10:00:00Z', endTime: '2026-03-01T10:30:00Z' }, // 30 min before end
            ],
          }),
        };
      }
      if (url.includes('p-still-in/participantSessions')) {
        return {
          ok: true,
          json: async () => ({
            participantSessions: [
              { startTime: '2026-03-01T10:00:00Z' }, // open session (no endTime)
            ],
          }),
        };
      }
      if (url.includes('/participants')) {
        return {
          ok: true,
          json: async () => ({
            participants: [
              { name: 'rec1/participants/p-stayed', signedinUser: { displayName: 'Stayed', email: 'stayed@x.com' } },
              { name: 'rec1/participants/p-left-early', signedinUser: { displayName: 'Left Early', email: 'early@x.com' } },
              { name: 'rec1/participants/p-still-in', signedinUser: { displayName: 'Open Session', email: 'open@x.com' } },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await fetchConferenceParticipants('rec1', 'tok', meetingEnd);
    expect(res).toHaveLength(3);

    const stayed = res.find(p => p.email === 'stayed@x.com');
    const early = res.find(p => p.email === 'early@x.com');
    const open = res.find(p => p.email === 'open@x.com');

    expect(stayed.present).toBe(true);
    expect(early.present).toBe(false);
    expect(open.present).toBe(true);
    expect(open.durationMs).toBe(3600000); // Capped at meetingEndTime (10:00 to 11:00) rather than Date.now()
  });

  test('falls back to latest participant activity when meetingEndTime is null', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('p1/participantSessions')) {
        return {
          ok: true,
          json: async () => ({
            participantSessions: [
              { startTime: '2026-03-01T10:00:00Z', endTime: '2026-03-01T11:00:00Z' }, // latest activity is 11:00
            ],
          }),
        };
      }
      if (url.includes('p2/participantSessions')) {
        return {
          ok: true,
          json: async () => ({
            participantSessions: [
              { startTime: '2026-03-01T10:00:00Z', endTime: '2026-03-01T10:20:00Z' }, // 40m before latest
            ],
          }),
        };
      }
      if (url.includes('/participants')) {
        return {
          ok: true,
          json: async () => ({
            participants: [
              { name: 'rec1/participants/p1', signedinUser: { displayName: 'P1', email: 'p1@x.com' } },
              { name: 'rec1/participants/p2', signedinUser: { displayName: 'P2', email: 'p2@x.com' } },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = await fetchConferenceParticipants('rec1', 'tok', null);
    const p1 = res.find(p => p.email === 'p1@x.com');
    const p2 = res.find(p => p.email === 'p2@x.com');

    expect(p1.present).toBe(true);
    expect(p2.present).toBe(false);
  });
});
