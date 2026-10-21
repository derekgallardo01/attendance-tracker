const { google } = require('googleapis');
const log = require('../lib/logger');

function memoizeTTL(fn, ttlMs, maxEntries = 200) {
  const cache = new Map();
  return async function (...args) {
    let forceRefresh = false;
    const normalizedArgs = args.slice();
    if (normalizedArgs.length > 0) {
      const last = normalizedArgs[normalizedArgs.length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        if (last.force === true) forceRefresh = true;
        const rest = { ...last };
        delete rest.force;
        if (Object.keys(rest).length === 0) {
          normalizedArgs[normalizedArgs.length - 1] = undefined;
        } else {
          normalizedArgs[normalizedArgs.length - 1] = rest;
        }
      }
    }
    while (normalizedArgs.length > 0 && normalizedArgs[normalizedArgs.length - 1] === undefined) {
      normalizedArgs.pop();
    }
    const key = JSON.stringify(normalizedArgs);
    const now = Date.now();
    const hit = cache.get(key);
    if (!forceRefresh && hit) {
      if (hit.promise) return hit.promise;
      if (now - hit.at < ttlMs) return hit.value;
    }
    const promise = Promise.resolve().then(() => fn(...args)).then(
      (val) => {
        if (cache.size >= maxEntries && !cache.has(key)) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { at: Date.now(), value: val, promise: null });
        return val;
      },
      (err) => {
        cache.delete(key);
        throw err;
      }
    );
    cache.set(key, { at: now, value: hit ? hit.value : undefined, promise });
    return promise;
  };
}

const DEFAULT_PROJECT_ID = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'attendance-tracker-490319';
const BILLING_CACHE_TTL_MS = 12 * 60 * 1000; // 12 minutes (within 10-15 min target; zero Firestore reads)

// Official Google Cloud Firestore (us-central1 / nam5) pricing & safe thresholds
const FIRESTORE_PRICING = {
  readsPerMillionUsd: 0.30,      // $0.03 per 100k ($0.30 per 1M) after 50k/day free tier
  writesPerMillionUsd: 0.90,     // $0.09 per 100k ($0.90 per 1M) after 20k/day free tier
  deletesPer100kUsd: 0.06,       // $0.06 per 100k deletes ($0.60 per 1M) after 20k/day free tier
  deletesPerMillionUsd: 0.60,
  freeReadsPerDay: 50000,
  freeWritesPerDay: 20000,
  freeDeletesPerDay: 20000,
  cloudRunPerBillableSecondUsd: 0.00002525, // ~1 vCPU + 512MiB tier-1 estimate
  safeHourlyReadThreshold: Number(process.env.BILLING_ALERT_READS_PER_HOUR) || 500000,
  hourlyReadAlertThreshold: Number(process.env.BILLING_ALERT_READS_PER_HOUR) || 500000,
  warningHourlyReadThreshold: Number(process.env.BILLING_WARN_READS_PER_HOUR) || 150000,
  hourlyReadWarningThreshold: Number(process.env.BILLING_WARN_READS_PER_HOUR) || 150000,
  safeHourlyWriteThreshold: Number(process.env.BILLING_ALERT_WRITES_PER_HOUR) || 25000,
  hourlyWriteAlertThreshold: Number(process.env.BILLING_ALERT_WRITES_PER_HOUR) || 25000,
  warningHourlyWriteThreshold: Number(process.env.BILLING_WARN_WRITES_PER_HOUR) || 10000,
  hourlyWriteWarningThreshold: Number(process.env.BILLING_WARN_WRITES_PER_HOUR) || 10000,
  safeDailyCostThresholdUsd: Number(process.env.BILLING_ALERT_DAILY_COST_USD) || 2.00,
  dailyCostAlertThresholdUsd: Number(process.env.BILLING_ALERT_DAILY_COST_USD) || 2.00,
};

const METRIC_TYPES = {
  reads: 'firestore.googleapis.com/document/read_count',
  writes: 'firestore.googleapis.com/document/write_count',
  deletes: 'firestore.googleapis.com/document/delete_count',
  cloudRunBillableTime: 'run.googleapis.com/container/billable_instance_time',
};

/**
 * Calculate exact estimated USD cost for Firestore reads, writes, deletes, and
 * Cloud Run billable instance time over `days` days.
 */
function calculateFirestoreCost({
  reads = 0,
  writes = 0,
  deletes = 0,
  days = 1,
  cloudRunBillableSeconds = 0,
} = {}) {
  const numReads = Math.max(0, Math.round(Number(reads) || 0));
  const numWrites = Math.max(0, Math.round(Number(writes) || 0));
  const numDeletes = Math.max(0, Math.round(Number(deletes) || 0));
  const rawDays = Number(days);
  const numDays = (!Number.isFinite(rawDays) || rawDays <= 0) ? 1 : rawDays;
  const cloudRunSec = Math.max(0, Number(cloudRunBillableSeconds) || 0);

  const freeReads = Math.round(FIRESTORE_PRICING.freeReadsPerDay * numDays);
  const freeWrites = Math.round(FIRESTORE_PRICING.freeWritesPerDay * numDays);
  const freeDeletes = Math.round(FIRESTORE_PRICING.freeDeletesPerDay * numDays);

  const billableReads = Math.max(0, numReads - freeReads);
  const billableWrites = Math.max(0, numWrites - freeWrites);
  const billableDeletes = Math.max(0, numDeletes - freeDeletes);

  const readCostUsd = Number(((billableReads / 1_000_000) * FIRESTORE_PRICING.readsPerMillionUsd).toFixed(4));
  const writeCostUsd = Number(((billableWrites / 1_000_000) * FIRESTORE_PRICING.writesPerMillionUsd).toFixed(4));
  const deleteCostUsd = Number(((billableDeletes / 100_000) * FIRESTORE_PRICING.deletesPer100kUsd).toFixed(4));
  const firestoreCostUsd = Number((readCostUsd + writeCostUsd + deleteCostUsd).toFixed(4));
  const cloudRunCostUsd = Number((cloudRunSec * FIRESTORE_PRICING.cloudRunPerBillableSecondUsd).toFixed(4));
  const totalCostUsd = Number((firestoreCostUsd + cloudRunCostUsd).toFixed(4));

  return {
    reads: numReads,
    writes: numWrites,
    deletes: numDeletes,
    days: numDays,
    freeReads,
    freeWrites,
    freeDeletes,
    billableReads,
    billableWrites,
    billableDeletes,
    readCostUsd,
    writeCostUsd,
    deleteCostUsd,
    firestoreCostUsd,
    costUsd: firestoreCostUsd,
    cloudRunBillableSeconds: Math.round(cloudRunSec),
    cloudRunHours: Number((cloudRunSec / 3600).toFixed(2)),
    cloudRunCostUsd,
    totalCostUsd,
  };
}

/**
 * Determine health status ({ level, label }) for a 1-hour rate.
 * Accepts either (reads, writes) positional args or ({ reads, writes }) object.
 */
function classifyHourlyStatus(arg1 = 0, arg2 = 0) {
  let reads = 0;
  let writes = 0;
  let readThreshold = FIRESTORE_PRICING.safeHourlyReadThreshold;
  let writeThreshold = FIRESTORE_PRICING.safeHourlyWriteThreshold;
  let warnRead = FIRESTORE_PRICING.warningHourlyReadThreshold;
  let warnWrite = FIRESTORE_PRICING.warningHourlyWriteThreshold;

  if (arg1 && typeof arg1 === 'object') {
    reads = Number(arg1.reads) || 0;
    writes = Number(arg1.writes) || 0;
    if (arg1.readThreshold) readThreshold = Number(arg1.readThreshold);
    if (arg1.writeThreshold) writeThreshold = Number(arg1.writeThreshold);
  } else {
    reads = Number(arg1) || 0;
    writes = Number(arg2) || 0;
  }

  if (reads >= readThreshold || writes >= writeThreshold) {
    return { level: 'critical', label: 'Critical' };
  }
  if (reads >= warnRead || writes >= warnWrite) {
    return { level: 'warning', label: 'Warning' };
  }
  return { level: 'healthy', label: 'Healthy' };
}

/**
 * Obtain an OAuth2 access token with Cloud Monitoring read permissions.
 * Prefers Application Default Credentials (Cloud Run attached service account),
 * falling back to the Secret Manager service account key if ADC is unavailable.
 */
async function getMonitoringAccessToken() {
  if (process.env.GCP_MONITORING_ACCESS_TOKEN) {
    return process.env.GCP_MONITORING_ACCESS_TOKEN.trim();
  }
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/monitoring.read'],
    });
    const token = await auth.getAccessToken();
    if (token) return token;
  } catch (err) {
    log.warn('billing-telemetry: ADC token fetch failed, trying service account key', { error: err.message });
  }

  const { loadServiceAccountKey } = require('./googleAuth');
  const key = await loadServiceAccountKey();
  const jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/monitoring.read'],
  });
  const tokens = await jwt.authorize();
  return tokens.access_token;
}

/**
 * Query a single metric timeSeries from Google Cloud Monitoring v3 API.
 */
async function fetchMetricTimeSeries({
  projectId = DEFAULT_PROJECT_ID,
  metricType,
  startTime,
  startTimeIso,
  endTime,
  endTimeIso,
  alignmentPeriodSec = 3600,
  accessToken,
  fetchImpl = global.fetch,
}) {
  const start = startTime || startTimeIso;
  const end = endTime || endTimeIso;
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    'interval.startTime': start,
    'interval.endTime': end,
    'aggregation.alignmentPeriod': `${alignmentPeriodSec}s`,
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Cloud Monitoring API ${res.status} for ${metricType}: ${bodyText.slice(0, 200)}`);
  }

  const data = await res.json();
  const seriesList = Array.isArray(data.timeSeries) ? data.timeSeries : [];
  const byEndTime = new Map();

  for (const series of seriesList) {
    const points = Array.isArray(series.points) ? series.points : [];
    for (const pt of points) {
      const endIsoVal = pt.interval?.endTime;
      const startIsoVal = pt.interval?.startTime || endIsoVal;
      if (!endIsoVal) continue;
      const rawVal = pt.value?.int64Value ?? pt.value?.doubleValue ?? 0;
      const val = Number(rawVal) || 0;
      const prev = byEndTime.get(endIsoVal) || { startTime: startIsoVal, endTime: endIsoVal, value: 0 };
      prev.value += val;
      byEndTime.set(endIsoVal, prev);
    }
  }

  return Array.from(byEndTime.values())
    .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())
    .map(pt => ({ endTime: pt.endTime, value: pt.value }));
}

/**
 * Fetch full billing telemetry for the last 24h (hourly buckets) and current
 * calendar Month-to-Date (daily buckets).
 */
async function fetchBillingTelemetryRaw({
  projectId = DEFAULT_PROJECT_ID,
  now = new Date(),
  accessToken = null,
  fetchImpl = global.fetch,
} = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const endIso = nowDate.toISOString();
  const start24hIso = new Date(nowMs - 24 * 3600 * 1000).toISOString();

  // Month-to-date start (UTC 1st of current month at 00:00:00Z)
  const monthStartDate = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1, 0, 0, 0));
  const mtdSpanMs = Math.max(3600 * 1000, nowMs - monthStartDate.getTime());
  const startMtdIso = new Date(nowMs - mtdSpanMs).toISOString();

  const token = accessToken === false
    ? null
    : (accessToken || await getMonitoringAccessToken().catch(() => null));
  if (!token) {
    const emptyCost = calculateFirestoreCost({ reads: 0, writes: 0, deletes: 0, days: 1 });
    return {
      projectId,
      generatedAt: endIso,
      fetchedAt: endIso,
      source: 'unavailable',
      cacheTtlMs: BILLING_CACHE_TTL_MS,
      pricing: FIRESTORE_PRICING,
      status: { level: 'healthy', label: 'Healthy' },
      currentHour: {
        hour: null,
        reads: 0,
        writes: 0,
        deletes: 0,
        status: { level: 'healthy', label: 'Healthy' },
        projectedDailyCostUsd: 0,
      },
      last24h: {
        ...emptyCost,
        cost: emptyCost,
        hourlyBuckets: [],
      },
      mtd: {
        ...emptyCost,
        cost: emptyCost,
        daysElapsed: 1,
      },
      monthToDate: {
        ...emptyCost,
        cost: emptyCost,
        daysElapsed: 1,
      },
      projections: {
        daysInMonth: 30,
        daysElapsedInMonth: 1,
        daysRemainingInMonth: 29,
        monthTotalFrom24hRateUsd: 0,
        monthTotalFromCurrentHourRateUsd: 0,
      },
      hourlyBuckets: [],
      dailyBuckets: [],
    };
  }

  const [
    reads24hPts,
    writes24hPts,
    deletes24hPts,
    cloudRun24hPts,
    readsMtdPts,
    writesMtdPts,
    deletesMtdPts,
    cloudRunMtdPts,
  ] = await Promise.all([
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.reads, startTime: start24hIso, endTime: endIso, alignmentPeriodSec: 3600, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.writes, startTime: start24hIso, endTime: endIso, alignmentPeriodSec: 3600, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.deletes, startTime: start24hIso, endTime: endIso, alignmentPeriodSec: 3600, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.cloudRunBillableTime, startTime: start24hIso, endTime: endIso, alignmentPeriodSec: 3600, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.reads, startTime: startMtdIso, endTime: endIso, alignmentPeriodSec: 86400, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.writes, startTime: startMtdIso, endTime: endIso, alignmentPeriodSec: 86400, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.deletes, startTime: startMtdIso, endTime: endIso, alignmentPeriodSec: 86400, accessToken: token, fetchImpl }),
    fetchMetricTimeSeries({ projectId, metricType: METRIC_TYPES.cloudRunBillableTime, startTime: startMtdIso, endTime: endIso, alignmentPeriodSec: 86400, accessToken: token, fetchImpl }),
  ]);

  // Merge 24h hourly buckets
  const hourlyMap = new Map();
  const ensureHourBucket = (pt) => {
    const key = pt.endTime;
    if (!hourlyMap.has(key)) {
      const endMsVal = new Date(pt.endTime).getTime();
      const computedStart = Number.isFinite(endMsVal)
        ? new Date(endMsVal - 3600 * 1000).toISOString()
        : pt.endTime;
      hourlyMap.set(key, {
        hour: pt.endTime,
        startTime: (pt.startTime && pt.startTime !== pt.endTime) ? pt.startTime : computedStart,
        endTime: pt.endTime,
        reads: 0,
        writes: 0,
        deletes: 0,
        cloudRunBillableSeconds: 0,
      });
    }
    return hourlyMap.get(key);
  };

  for (const pt of reads24hPts) ensureHourBucket(pt).reads += Math.round(pt.value);
  for (const pt of writes24hPts) ensureHourBucket(pt).writes += Math.round(pt.value);
  for (const pt of deletes24hPts) ensureHourBucket(pt).deletes += Math.round(pt.value);
  for (const pt of cloudRun24hPts) ensureHourBucket(pt).cloudRunBillableSeconds += pt.value;

  const hourlyBuckets = Array.from(hourlyMap.values())
    .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())
    .map((b) => {
      const hourlyCost = calculateFirestoreCost({
        reads: b.reads,
        writes: b.writes,
        deletes: b.deletes,
        days: 1 / 24,
        cloudRunBillableSeconds: b.cloudRunBillableSeconds,
      });
      const status = classifyHourlyStatus(b.reads, b.writes);
      return {
        hour: b.endTime,
        startTime: b.startTime,
        endTime: b.endTime,
        reads: b.reads,
        writes: b.writes,
        deletes: b.deletes,
        cloudRunBillableSeconds: Math.round(b.cloudRunBillableSeconds),
        costUsd: hourlyCost.costUsd,
        totalCostUsd: hourlyCost.totalCostUsd,
        status,
      };
    });

  // Current 1h rate = most recent non-empty hourly bucket (Cloud Monitoring has ~3m ingestion lag)
  let latestBucket = hourlyBuckets.length > 0 ? hourlyBuckets[hourlyBuckets.length - 1] : null;
  if (
    latestBucket &&
    latestBucket.reads === 0 &&
    latestBucket.writes === 0 &&
    hourlyBuckets.length >= 2
  ) {
    latestBucket = hourlyBuckets[hourlyBuckets.length - 2];
  }
  if (!latestBucket) {
    latestBucket = {
      hour: endIso,
      startTime: new Date(nowMs - 3600 * 1000).toISOString(),
      endTime: endIso,
      reads: 0,
      writes: 0,
      deletes: 0,
      cloudRunBillableSeconds: 0,
      costUsd: 0,
      totalCostUsd: 0,
      status: { level: 'healthy', label: 'Healthy' },
    };
  }

  const projected1hDailyCost = calculateFirestoreCost({
    reads: latestBucket.reads * 24,
    writes: latestBucket.writes * 24,
    deletes: latestBucket.deletes * 24,
    days: 1,
    cloudRunBillableSeconds: latestBucket.cloudRunBillableSeconds * 24,
  });

  const currentHour = {
    hour: latestBucket.endTime,
    startTime: latestBucket.startTime,
    endTime: latestBucket.endTime,
    reads: latestBucket.reads,
    writes: latestBucket.writes,
    deletes: latestBucket.deletes,
    cloudRunBillableSeconds: latestBucket.cloudRunBillableSeconds,
    readThreshold: FIRESTORE_PRICING.safeHourlyReadThreshold,
    writeThreshold: FIRESTORE_PRICING.safeHourlyWriteThreshold,
    readUtilizationPct: Number(((latestBucket.reads / FIRESTORE_PRICING.safeHourlyReadThreshold) * 100).toFixed(1)),
    writeUtilizationPct: Number(((latestBucket.writes / FIRESTORE_PRICING.safeHourlyWriteThreshold) * 100).toFixed(1)),
    status: classifyHourlyStatus(latestBucket.reads, latestBucket.writes),
    costUsd: latestBucket.costUsd,
    projectedDailyReads: latestBucket.reads * 24,
    projectedDailyWrites: latestBucket.writes * 24,
    projectedDailyCostUsd: projected1hDailyCost.costUsd,
    projectedDailyTotalCostUsd: projected1hDailyCost.totalCostUsd,
  };

  // Sum 24h totals
  const totals24h = hourlyBuckets.reduce(
    (acc, b) => {
      acc.reads += b.reads;
      acc.writes += b.writes;
      acc.deletes += b.deletes;
      acc.cloudRunBillableSeconds += b.cloudRunBillableSeconds;
      return acc;
    },
    { reads: 0, writes: 0, deletes: 0, cloudRunBillableSeconds: 0 }
  );
  const last24hCost = calculateFirestoreCost({
    ...totals24h,
    days: 1,
  });
  const last24h = {
    ...last24hCost,
    cost: last24hCost,
    hourlyBuckets,
  };

  // Merge MTD daily buckets
  const dailyMap = new Map();
  const ensureDayBucket = (pt) => {
    const key = pt.endTime;
    if (!dailyMap.has(key)) {
      const endMsVal = new Date(pt.endTime).getTime();
      const computedStart = Number.isFinite(endMsVal)
        ? new Date(endMsVal - 86400 * 1000).toISOString()
        : pt.endTime;
      dailyMap.set(key, {
        startTime: (pt.startTime && pt.startTime !== pt.endTime) ? pt.startTime : computedStart,
        endTime: pt.endTime,
        reads: 0,
        writes: 0,
        deletes: 0,
        cloudRunBillableSeconds: 0,
      });
    }
    return dailyMap.get(key);
  };

  for (const pt of readsMtdPts) ensureDayBucket(pt).reads += Math.round(pt.value);
  for (const pt of writesMtdPts) ensureDayBucket(pt).writes += Math.round(pt.value);
  for (const pt of deletesMtdPts) ensureDayBucket(pt).deletes += Math.round(pt.value);
  for (const pt of cloudRunMtdPts) ensureDayBucket(pt).cloudRunBillableSeconds += pt.value;

  const dailyBuckets = Array.from(dailyMap.values())
    .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime())
    .map((d) => {
      const dayCost = calculateFirestoreCost({
        reads: d.reads,
        writes: d.writes,
        deletes: d.deletes,
        days: 1,
        cloudRunBillableSeconds: d.cloudRunBillableSeconds,
      });
      return {
        startTime: d.startTime,
        endTime: d.endTime,
        reads: d.reads,
        writes: d.writes,
        deletes: d.deletes,
        billableReads: dayCost.billableReads,
        billableWrites: dayCost.billableWrites,
        billableDeletes: dayCost.billableDeletes,
        cloudRunBillableSeconds: Math.round(d.cloudRunBillableSeconds),
        costUsd: dayCost.costUsd,
        totalCostUsd: dayCost.totalCostUsd,
      };
    });

  const totalsMtd = dailyBuckets.reduce(
    (acc, d) => {
      acc.reads += d.reads;
      acc.writes += d.writes;
      acc.deletes += d.deletes;
      acc.billableReads += d.billableReads;
      acc.billableWrites += d.billableWrites;
      acc.billableDeletes += d.billableDeletes;
      acc.cloudRunBillableSeconds += d.cloudRunBillableSeconds;
      return acc;
    },
    { reads: 0, writes: 0, deletes: 0, billableReads: 0, billableWrites: 0, billableDeletes: 0, cloudRunBillableSeconds: 0 }
  );

  const daysInMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsedExact = Math.max(0.04, (nowMs - monthStartDate.getTime()) / 86400000);
  const calendarDaysElapsed = Math.max(1, dailyBuckets.length || Math.ceil(daysElapsedExact));
  const remainingDays = Math.max(0, daysInMonth - daysElapsedExact);

  // Sum per-day billable usage so unused daily free quota on quiet days does not
  // falsely roll over to offset spikes on other days.
  let mtdCost;
  if (dailyBuckets.length > 0) {
    const readCostUsd = Number(((totalsMtd.billableReads / 1_000_000) * FIRESTORE_PRICING.readsPerMillionUsd).toFixed(4));
    const writeCostUsd = Number(((totalsMtd.billableWrites / 1_000_000) * FIRESTORE_PRICING.writesPerMillionUsd).toFixed(4));
    const deleteCostUsd = Number(((totalsMtd.billableDeletes / 100_000) * FIRESTORE_PRICING.deletesPer100kUsd).toFixed(4));
    const firestoreCostUsd = Number((readCostUsd + writeCostUsd + deleteCostUsd).toFixed(4));
    const cloudRunSec = Math.max(0, Number(totalsMtd.cloudRunBillableSeconds) || 0);
    const cloudRunCostUsd = Number((cloudRunSec * FIRESTORE_PRICING.cloudRunPerBillableSecondUsd).toFixed(4));
    const totalCostUsd = Number((firestoreCostUsd + cloudRunCostUsd).toFixed(4));
    mtdCost = {
      reads: totalsMtd.reads,
      writes: totalsMtd.writes,
      deletes: totalsMtd.deletes,
      days: calendarDaysElapsed,
      freeReads: totalsMtd.reads - totalsMtd.billableReads,
      freeWrites: totalsMtd.writes - totalsMtd.billableWrites,
      freeDeletes: totalsMtd.deletes - totalsMtd.billableDeletes,
      billableReads: totalsMtd.billableReads,
      billableWrites: totalsMtd.billableWrites,
      billableDeletes: totalsMtd.billableDeletes,
      readCostUsd,
      writeCostUsd,
      deleteCostUsd,
      firestoreCostUsd,
      costUsd: firestoreCostUsd,
      cloudRunBillableSeconds: Math.round(cloudRunSec),
      cloudRunHours: Number((cloudRunSec / 3600).toFixed(2)),
      cloudRunCostUsd,
      totalCostUsd,
    };
  } else {
    mtdCost = calculateFirestoreCost({
      ...totalsMtd,
      days: calendarDaysElapsed,
    });
  }

  const projectedFullMonthCostUsd = Number((mtdCost.costUsd + remainingDays * last24hCost.costUsd).toFixed(2));
  const projectedFullMonthTotalCostUsd = Number((mtdCost.totalCostUsd + remainingDays * last24hCost.totalCostUsd).toFixed(2));
  const projectedFullMonthFrom1hCostUsd = Number((mtdCost.totalCostUsd + remainingDays * currentHour.projectedDailyTotalCostUsd).toFixed(2));
  const projectedFullMonthReads = Math.round(mtdCost.reads + remainingDays * last24hCost.reads);
  const projectedFullMonthWrites = Math.round(mtdCost.writes + remainingDays * last24hCost.writes);

  const mtd = {
    ...mtdCost,
    cost: mtdCost,
    monthStart: monthStartDate.toISOString(),
    daysInMonth,
    daysElapsed: calendarDaysElapsed,
    daysElapsedExact: Number(daysElapsedExact.toFixed(2)),
    calendarDaysElapsed,
    remainingDays: Number(remainingDays.toFixed(2)),
    projectedFullMonthCostUsd,
    projectedFullMonthTotalCostUsd,
    projectedFullMonthFrom1hCostUsd,
    projectedFullMonthReads,
    projectedFullMonthWrites,
  };

  const projections = {
    daysInMonth,
    daysElapsedInMonth: calendarDaysElapsed,
    daysRemainingInMonth: Math.max(0, Math.round(remainingDays)),
    monthTotalFrom24hRateUsd: projectedFullMonthTotalCostUsd,
    monthTotalFromCurrentHourRateUsd: projectedFullMonthFrom1hCostUsd,
  };

  return {
    projectId,
    generatedAt: endIso,
    fetchedAt: endIso,
    source: 'cloud_monitoring',
    cacheTtlMs: BILLING_CACHE_TTL_MS,
    pricing: FIRESTORE_PRICING,
    status: currentHour.status,
    currentHour,
    last24h,
    mtd,
    monthToDate: mtd,
    projections,
    hourlyBuckets,
    dailyBuckets,
  };
}

let getBillingTelemetryMemoized = memoizeTTL(
  (opts = {}) => fetchBillingTelemetryRaw(opts),
  BILLING_CACHE_TTL_MS,
  10
);

function clearCacheAll() {
  getBillingTelemetryMemoized = memoizeTTL(
    (opts = {}) => fetchBillingTelemetryRaw(opts),
    BILLING_CACHE_TTL_MS,
    10
  );
  getBillingTelemetry._testCachedResult = null;
  getBillingTelemetry._testCachedProject = null;
}

async function getBillingTelemetry(options = {}) {
  const {
    force = false,
    useCache = true,
    projectId = DEFAULT_PROJECT_ID,
    now,
    accessToken,
    fetchImpl,
  } = options;

  if (!useCache) {
    return fetchBillingTelemetryRaw({ projectId, now, accessToken, fetchImpl });
  }

  if (now || accessToken || fetchImpl) {
    if (!force && getBillingTelemetry._testCachedResult && getBillingTelemetry._testCachedProject === projectId) {
      return getBillingTelemetry._testCachedResult;
    }
    const res = await fetchBillingTelemetryRaw({ projectId, now, accessToken, fetchImpl });
    getBillingTelemetry._testCachedResult = res;
    getBillingTelemetry._testCachedProject = projectId;
    return res;
  }

  return getBillingTelemetryMemoized({ projectId, force: Boolean(force) });
}

/**
 * Evaluate trailing 1h and 24h Firestore read/write rate and projected daily cost
 * against safe thresholds.
 */
function evaluateBillingWatchdog(telemetry, thresholds = {}) {
  const readRateThresholdPerHour = Number(thresholds.hourlyReadThreshold || thresholds.readRateThresholdPerHour) || FIRESTORE_PRICING.safeHourlyReadThreshold;
  const writeRateThresholdPerHour = Number(thresholds.hourlyWriteThreshold || thresholds.writeRateThresholdPerHour) || FIRESTORE_PRICING.safeHourlyWriteThreshold;
  const dailyCostThresholdUsd = Number(thresholds.dailyCostUsdThreshold || thresholds.dailyCostThresholdUsd) || FIRESTORE_PRICING.safeDailyCostThresholdUsd;

  const ch = telemetry?.currentHour || {};
  const d24 = telemetry?.last24h || {};

  const currentHourReads = Number(ch.reads) || 0;
  const currentHourWrites = Number(ch.writes) || 0;
  const last24hReads = Number(d24.reads) || 0;
  const last24hCostUsd = Number(d24.cost?.totalCostUsd ?? d24.totalCostUsd ?? d24.costUsd) || 0;

  const readSpike1h = currentHourReads >= readRateThresholdPerHour;
  const writeSpike1h = currentHourWrites >= writeRateThresholdPerHour;
  const costSpike24h = last24hCostUsd >= dailyCostThresholdUsd;

  const reasons = [];
  if (readSpike1h) {
    reasons.push(`Trailing 1h Firestore reads (${currentHourReads.toLocaleString()}/hr) exceeded threshold (${readRateThresholdPerHour.toLocaleString()}/hr)`);
  }
  if (writeSpike1h) {
    reasons.push(`Trailing 1h Firestore writes (${currentHourWrites.toLocaleString()}/hr) exceeded threshold (${writeRateThresholdPerHour.toLocaleString()}/hr)`);
  }
  if (costSpike24h) {
    reasons.push(`Trailing 24h estimated Firestore cost ($${last24hCostUsd.toFixed(2)}) exceeded threshold ($${dailyCostThresholdUsd.toFixed(2)}/day)`);
  }

  const breached = reasons.length > 0;
  return {
    breached,
    readSpike1h,
    writeSpike1h,
    costSpike24h,
    reasons,
    thresholds: {
      hourlyReadThreshold: readRateThresholdPerHour,
      hourlyWriteThreshold: writeRateThresholdPerHour,
      dailyCostUsdThreshold: dailyCostThresholdUsd,
      readRateThresholdPerHour,
      writeRateThresholdPerHour,
      dailyCostThresholdUsd,
    },
    metrics: {
      currentHourReads,
      currentHourWrites,
      last24hReads,
      last24hCostUsd,
    },
  };
}

module.exports = {
  DEFAULT_PROJECT_ID,
  BILLING_CACHE_TTL_MS,
  FIRESTORE_PRICING,
  METRIC_TYPES,
  calculateFirestoreCost,
  classifyHourlyStatus,
  getMonitoringAccessToken,
  fetchMetricTimeSeries,
  fetchBillingTelemetryRaw,
  getBillingTelemetry,
  evaluateBillingWatchdog,
  _clearBillingTelemetryCache: clearCacheAll,
};
