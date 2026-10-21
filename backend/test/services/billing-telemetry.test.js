const {
  FIRESTORE_PRICING,
  calculateFirestoreCost,
  classifyHourlyStatus,
  fetchMetricTimeSeries,
  fetchBillingTelemetryRaw,
  getBillingTelemetry,
  evaluateBillingWatchdog,
  _clearBillingTelemetryCache,
} = require('../../src/services/billing-telemetry');

const {
  buildAlertPolicies,
} = require('../../scripts/setup-billing-alerts');

describe('billing-telemetry service', () => {
  beforeEach(() => {
    _clearBillingTelemetryCache();
  });

  describe('calculateFirestoreCost', () => {
    test('returns $0 when usage is within the daily free tier (50k reads, 20k writes, 20k deletes)', () => {
      const res = calculateFirestoreCost({
        reads: 49_999,
        writes: 19_999,
        deletes: 19_999,
        days: 1,
      });
      expect(res.billableReads).toBe(0);
      expect(res.billableWrites).toBe(0);
      expect(res.billableDeletes).toBe(0);
      expect(res.totalCostUsd).toBe(0);
    });

    test('computes exact USD cost above the daily free tier ($0.30/1M reads, $0.90/1M writes, $0.60/1M deletes)', () => {
      // 1,050,000 reads in 1 day -> 1,000,000 billable reads -> $0.30
      // 1,020,000 writes in 1 day -> 1,000,000 billable writes -> $0.90
      // 120,000 deletes in 1 day -> 100,000 billable deletes -> $0.06
      const res = calculateFirestoreCost({
        reads: 1_050_000,
        writes: 1_020_000,
        deletes: 120_000,
        days: 1,
      });
      expect(res.billableReads).toBe(1_000_000);
      expect(res.billableWrites).toBe(1_000_000);
      expect(res.billableDeletes).toBe(100_000);
      expect(res.readCostUsd).toBeCloseTo(0.30, 4);
      expect(res.writeCostUsd).toBeCloseTo(0.90, 4);
      expect(res.deleteCostUsd).toBeCloseTo(0.06, 4);
      expect(res.totalCostUsd).toBeCloseTo(1.26, 4);
    });

    test('scales free tier deduction across multi-day month-to-date windows', () => {
      // 10 days -> free tier = 500,000 reads
      const res = calculateFirestoreCost({
        reads: 500_000,
        writes: 200_000,
        deletes: 200_000,
        days: 10,
      });
      expect(res.freeReads).toBe(500_000);
      expect(res.totalCostUsd).toBe(0);
    });

    test('handles zero, negative, and non-numeric inputs safely', () => {
      const res = calculateFirestoreCost({
        reads: -500,
        writes: NaN,
        deletes: null,
        days: 0,
      });
      expect(res.reads).toBe(0);
      expect(res.writes).toBe(0);
      expect(res.deletes).toBe(0);
      expect(res.days).toBe(1);
      expect(res.totalCostUsd).toBe(0);
    });
  });

  describe('classifyHourlyStatus', () => {
    test('returns healthy when reads < 150k/hr and writes < 10k/hr', () => {
      expect(classifyHourlyStatus(136_938, 120)).toEqual({
        level: 'healthy',
        label: 'Healthy',
      });
    });

    test('returns warning when reads >= 150k/hr or writes >= 10k/hr', () => {
      expect(classifyHourlyStatus(164_197, 100).level).toBe('warning');
      expect(classifyHourlyStatus(10_000, 12_000).level).toBe('warning');
    });

    test('returns critical when reads >= 500k/hr or writes >= 25k/hr', () => {
      expect(classifyHourlyStatus(500_000, 100)).toEqual({
        level: 'critical',
        label: 'Critical',
      });
      expect(classifyHourlyStatus(10_000, 25_000)).toEqual({
        level: 'critical',
        label: 'Critical',
      });
    });
  });

  describe('fetchMetricTimeSeries', () => {
    test('parses Cloud Monitoring timeSeries points and sums across response_code series', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          timeSeries: [
            {
              points: [
                { interval: { endTime: '2026-04-19T14:00:00Z' }, value: { int64Value: '100000' } },
                { interval: { endTime: '2026-04-19T13:00:00Z' }, value: { int64Value: '50000' } },
              ],
            },
            {
              points: [
                { interval: { endTime: '2026-04-19T14:00:00Z' }, value: { int64Value: '36938' } },
              ],
            },
          ],
        }),
      });

      const points = await fetchMetricTimeSeries({
        projectId: 'attendance-tracker-490319',
        accessToken: 'test-token',
        metricType: 'firestore.googleapis.com/document/read_count',
        startTimeIso: '2026-04-18T14:00:00Z',
        endTimeIso: '2026-04-19T14:00:00Z',
        alignmentPeriodSec: 3600,
        fetchImpl: mockFetch,
      });

      expect(points).toEqual([
        { endTime: '2026-04-19T13:00:00Z', value: 50000 },
        { endTime: '2026-04-19T14:00:00Z', value: 136938 },
      ]);
    });

    test('throws descriptive error when Cloud Monitoring API returns non-200', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Permission monitoring.timeSeries.list denied',
      });

      await expect(fetchMetricTimeSeries({
        projectId: 'attendance-tracker-490319',
        accessToken: 'bad-token',
        metricType: 'firestore.googleapis.com/document/read_count',
        startTimeIso: '2026-04-18T14:00:00Z',
        endTimeIso: '2026-04-19T14:00:00Z',
        alignmentPeriodSec: 3600,
        fetchImpl: mockFetch,
      })).rejects.toThrow(/Cloud Monitoring API 403/);
    });
  });

  describe('fetchBillingTelemetryRaw & getBillingTelemetry', () => {
    test('returns fallback empty telemetry when no access token is available', async () => {
      const res = await fetchBillingTelemetryRaw({
        projectId: 'attendance-tracker-490319',
        now: new Date('2026-04-19T14:30:00Z'),
        accessToken: false,
        fetchImpl: jest.fn(),
      });
      expect(res.projectId).toBe('attendance-tracker-490319');
      expect(res.source).toBe('unavailable');
      expect(res.currentHour.reads).toBe(0);
    });

    test('aggregates 24h hourly buckets, currentHour, MTD totals, and full-month projections', async () => {
      const mockFetch = jest.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes('read_count') && u.includes('3600s')) {
          return {
            ok: true,
            json: async () => ({
              timeSeries: [{
                points: [
                  { interval: { endTime: '2026-04-19T13:00:00Z' }, value: { int64Value: '164197' } },
                  { interval: { endTime: '2026-04-19T14:00:00Z' }, value: { int64Value: '136938' } },
                ],
              }],
            }),
          };
        }
        if (u.includes('write_count') && u.includes('3600s')) {
          return {
            ok: true,
            json: async () => ({
              timeSeries: [{
                points: [
                  { interval: { endTime: '2026-04-19T13:00:00Z' }, value: { int64Value: '200' } },
                  { interval: { endTime: '2026-04-19T14:00:00Z' }, value: { int64Value: '150' } },
                ],
              }],
            }),
          };
        }
        if (u.includes('read_count') && u.includes('86400s')) {
          return {
            ok: true,
            json: async () => ({
              timeSeries: [{
                points: [
                  { interval: { endTime: '2026-04-18T00:00:00Z' }, value: { int64Value: '5000000' } },
                  { interval: { endTime: '2026-04-19T00:00:00Z' }, value: { int64Value: '300000' } },
                ],
              }],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ timeSeries: [] }),
        };
      });

      const data = await getBillingTelemetry({
        useCache: false,
        projectId: 'attendance-tracker-490319',
        now: new Date('2026-04-19T14:15:00Z'),
        accessToken: 'mock-token',
        fetchImpl: mockFetch,
      });

      expect(data.source).toBe('cloud_monitoring');
      expect(data.currentHour.reads).toBe(136938);
      expect(data.currentHour.writes).toBe(150);
      expect(data.currentHour.status.level).toBe('healthy');
      expect(data.last24h.reads).toBe(164197 + 136938);
      expect(data.last24h.writes).toBe(350);
      expect(data.last24h.hourlyBuckets).toHaveLength(2);
      expect(data.last24h.hourlyBuckets[0].startTime).toBe('2026-04-19T12:00:00.000Z');
      expect(data.last24h.hourlyBuckets[0].endTime).toBe('2026-04-19T13:00:00Z');
      expect(data.dailyBuckets[0].startTime).toBe('2026-04-17T00:00:00.000Z');
      expect(data.dailyBuckets[0].endTime).toBe('2026-04-18T00:00:00Z');
      expect(data.monthToDate.reads).toBe(5_300_000);
      expect(data.projections.daysInMonth).toBe(30);
    });

    test('applies daily free tier per day bucket so unused quota on quiet days does not roll over to offset a spike day', async () => {
      const mockFetch = jest.fn().mockImplementation(async (url) => {
        const u = String(url);
        if (u.includes('delete_count') && u.includes('86400s')) {
          return {
            ok: true,
            json: async () => ({
              timeSeries: [{
                points: [
                  { interval: { endTime: '2026-10-19T00:00:00Z' }, value: { int64Value: '100' } },
                  { interval: { endTime: '2026-10-20T00:00:00Z' }, value: { int64Value: '50' } },
                  { interval: { endTime: '2026-10-21T00:00:00Z' }, value: { int64Value: '288097' } },
                ],
              }],
            }),
          };
        }
        return { ok: true, json: async () => ({ timeSeries: [] }) };
      });

      const data = await getBillingTelemetry({
        useCache: false,
        projectId: 'attendance-tracker-490319',
        now: new Date('2026-10-21T15:00:00Z'),
        accessToken: 'mock-token',
        fetchImpl: mockFetch,
      });

      // Quiet days 1 & 2 (<20k deletes) have 0 billable deletes; spike day 3 has 288,097 - 20,000 = 268,097 billable deletes ($0.1609)
      expect(data.monthToDate.deletes).toBe(288247);
      expect(data.monthToDate.billableDeletes).toBe(268097);
      expect(data.monthToDate.deleteCostUsd).toBeCloseTo(0.1609, 4);
    });

    test('memoizes responses when useCache is true and bypasses cache when force is true', async () => {
      let callCount = 0;
      const mockFetch = jest.fn().mockImplementation(async () => {
        callCount++;
        return { ok: true, json: async () => ({ timeSeries: [] }) };
      });

      await getBillingTelemetry({
        useCache: true,
        accessToken: 'mock-token',
        fetchImpl: mockFetch,
      });
      const firstCalls = callCount;
      expect(firstCalls).toBeGreaterThan(0);

      await getBillingTelemetry({
        useCache: true,
        accessToken: 'mock-token',
        fetchImpl: mockFetch,
      });
      // Cached! Zero new fetch calls:
      expect(callCount).toBe(firstCalls);

      await getBillingTelemetry({
        useCache: true,
        force: true,
        accessToken: 'mock-token',
        fetchImpl: mockFetch,
      });
      expect(callCount).toBeGreaterThan(firstCalls);
    });
  });

  describe('evaluateBillingWatchdog', () => {
    test('returns breached=false when all metrics are below thresholds', () => {
      const res = evaluateBillingWatchdog({
        currentHour: { reads: 136_938, writes: 120 },
        last24h: { reads: 3_000_000, cost: { totalCostUsd: 0.89 } },
      });
      expect(res.breached).toBe(false);
      expect(res.reasons).toEqual([]);
    });

    test('flags breach when trailing 1h reads >= 500k, writes >= 25k, or 24h cost >= $2.00', () => {
      const res = evaluateBillingWatchdog({
        currentHour: { reads: 620_000, writes: 30_000 },
        last24h: { reads: 9_000_000, cost: { totalCostUsd: 2.68 } },
      });
      expect(res.breached).toBe(true);
      expect(res.reasons).toHaveLength(3);
      expect(res.reasons[0]).toMatch(/Trailing 1h Firestore reads/);
      expect(res.reasons[1]).toMatch(/Trailing 1h Firestore writes/);
      expect(res.reasons[2]).toMatch(/Trailing 24h estimated Firestore cost/);
    });
  });

  describe('setup-billing-alerts policy builders', () => {
    test('builds valid GCP Cloud Monitoring alert policies for read and write spikes', () => {
      const channels = ['projects/p/notificationChannels/1', 'projects/p/notificationChannels/2'];
      const [readPolicy, writePolicy] = buildAlertPolicies({ channelNames: channels });

      expect(readPolicy.displayName).toBe('Firestore Read Spike Alert (> 500k reads/hr)');
      expect(readPolicy.notificationChannels).toEqual(channels);
      expect(readPolicy.conditions[0].conditionThreshold.thresholdValue).toBe(FIRESTORE_PRICING.hourlyReadAlertThreshold);

      expect(writePolicy.displayName).toBe('Firestore Write Spike Alert (> 25k writes/hr)');
      expect(writePolicy.notificationChannels).toEqual(channels);
      expect(writePolicy.conditions[0].conditionThreshold.thresholdValue).toBe(FIRESTORE_PRICING.hourlyWriteAlertThreshold);
    });
  });
});

