#!/usr/bin/env node
/**
 * Provision or update GCP Cloud Monitoring notification channels and
 * Firestore read/write spike alert policies for attendance-tracker-490319.
 *
 * Usage:
 *   node backend/scripts/setup-billing-alerts.js
 */

const { execSync } = require('child_process');
const { google } = require('googleapis');

const DEFAULT_PROJECT_ID = process.env.GCP_PROJECT_ID || 'attendance-tracker-490319';
const READ_THRESHOLD_PER_HOUR = Number(process.env.BILLING_ALERT_READS_PER_HOUR) || 500000;
const WRITE_THRESHOLD_PER_HOUR = Number(process.env.BILLING_ALERT_WRITES_PER_HOUR) || 25000;

const NOTIFICATION_EMAILS = [
  {
    email: 'derek@attendancetracker.dev',
    displayName: 'Attendance Tracker Admin (derek@attendancetracker.dev)',
  },
  {
    email: process.env.NOTIFY_EMAIL || 'derekgallardo01@gmail.com',
    displayName: 'Attendance Tracker Owner (derekgallardo01@gmail.com)',
  },
];

async function getAccessToken() {
  if (process.env.GCP_ACCESS_TOKEN) {
    return process.env.GCP_ACCESS_TOKEN.trim();
  }
  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    const token = await auth.getAccessToken();
    if (token) return token;
  } catch (_) {
    // Fall back to gcloud CLI below
  }
  const cmd = process.platform === 'win32' ? 'gcloud.cmd auth print-access-token' : 'gcloud auth print-access-token';
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function monitoringRequest(accessToken, path, { method = 'GET', body = null } = {}) {
  const url = `https://monitoring.googleapis.com/v3/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_) {
    json = { raw: text };
  }
  if (!res.ok) {
    const errMsg = json.error?.message || text || `HTTP ${res.status}`;
    throw new Error(`Monitoring API ${method} ${path} failed (${res.status}): ${errMsg}`);
  }
  return json;
}

function buildAlertPolicies({ channelNames, readThreshold = READ_THRESHOLD_PER_HOUR, writeThreshold = WRITE_THRESHOLD_PER_HOUR }) {
  return [
    {
      displayName: 'Firestore Read Spike Alert (> 500k reads/hr)',
      combiner: 'OR',
      enabled: true,
      notificationChannels: channelNames,
      documentation: {
        mimeType: 'text/markdown',
        content: [
          '### Firestore Read Spike Detected',
          `Hourly Firestore document reads exceeded **${readThreshold.toLocaleString()} reads/hour** in \`attendance-tracker-490319\`.`,
          '',
          '**Action Steps:**',
          '1. Check the live **Cloud Billing & Firestore Usage Monitor** widget on [https://attendancetracker.dev/admin.html](https://attendancetracker.dev/admin.html).',
          '2. Inspect `/api/admin/billing-telemetry` for the hourly breakdown.',
          '3. Check Cloud Run request logs in `us-central1` (`attendance-tracker-backend`) for runaway polling or uncached collectionGroup scans.',
        ].join('\n'),
      },
      alertStrategy: {
        autoClose: '86400s',
      },
      conditions: [
        {
          displayName: `Firestore document reads > ${readThreshold.toLocaleString()} / hour`,
          conditionThreshold: {
            filter: 'resource.type = "firestore_instance" AND metric.type = "firestore.googleapis.com/document/read_count"',
            aggregations: [
              {
                alignmentPeriod: '3600s',
                perSeriesAligner: 'ALIGN_SUM',
                crossSeriesReducer: 'REDUCE_SUM',
              },
            ],
            comparison: 'COMPARISON_GT',
            thresholdValue: readThreshold,
            duration: '0s',
            trigger: { count: 1 },
          },
        },
      ],
    },
    {
      displayName: 'Firestore Write Spike Alert (> 25k writes/hr)',
      combiner: 'OR',
      enabled: true,
      notificationChannels: channelNames,
      documentation: {
        mimeType: 'text/markdown',
        content: [
          '### Firestore Write Spike Detected',
          `Hourly Firestore document writes exceeded **${writeThreshold.toLocaleString()} writes/hour** in \`attendance-tracker-490319\`.`,
          '',
          '**Action Steps:**',
          '1. Check the live **Cloud Billing & Firestore Usage Monitor** widget on [https://attendancetracker.dev/admin.html](https://attendancetracker.dev/admin.html).',
          '2. Inspect `/api/admin/billing-telemetry` for the hourly breakdown.',
          '3. Check Cloud Run logs for repeated event writes or loop retries.',
        ].join('\n'),
      },
      alertStrategy: {
        autoClose: '86400s',
      },
      conditions: [
        {
          displayName: `Firestore document writes > ${writeThreshold.toLocaleString()} / hour`,
          conditionThreshold: {
            filter: 'resource.type = "firestore_instance" AND metric.type = "firestore.googleapis.com/document/write_count"',
            aggregations: [
              {
                alignmentPeriod: '3600s',
                perSeriesAligner: 'ALIGN_SUM',
                crossSeriesReducer: 'REDUCE_SUM',
              },
            ],
            comparison: 'COMPARISON_GT',
            thresholdValue: writeThreshold,
            duration: '0s',
            trigger: { count: 1 },
          },
        },
      ],
    },
  ];
}

async function ensureNotificationChannels(accessToken, projectId = DEFAULT_PROJECT_ID, emails = NOTIFICATION_EMAILS) {
  const existingResp = await monitoringRequest(accessToken, `projects/${projectId}/notificationChannels`);
  const existing = existingResp.notificationChannels || [];
  const channelNames = [];

  const uniqueEmails = [];
  const seen = new Set();
  for (const item of emails) {
    const norm = String(item.email || '').trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    uniqueEmails.push({ email: norm, displayName: item.displayName || norm });
  }

  for (const target of uniqueEmails) {
    const match = existing.find(
      (ch) => ch.type === 'email' && String(ch.labels?.email_address || '').toLowerCase() === target.email
    );
    if (match) {
      channelNames.push(match.name);
      continue;
    }
    const created = await monitoringRequest(accessToken, `projects/${projectId}/notificationChannels`, {
      method: 'POST',
      body: {
        type: 'email',
        displayName: target.displayName,
        labels: { email_address: target.email },
        enabled: true,
      },
    });
    channelNames.push(created.name);
  }

  return channelNames;
}

async function ensureAlertPolicies(accessToken, projectId = DEFAULT_PROJECT_ID, channelNames = []) {
  const existingResp = await monitoringRequest(accessToken, `projects/${projectId}/alertPolicies`);
  const existing = existingResp.alertPolicies || [];
  const desiredPolicies = buildAlertPolicies({ channelNames });
  const results = [];

  for (const policy of desiredPolicies) {
    const match = existing.find((p) => p.displayName === policy.displayName);
    if (match) {
      const updated = await monitoringRequest(accessToken, match.name, {
        method: 'PATCH',
        body: {
          ...policy,
          name: match.name,
        },
      });
      results.push({ action: 'updated', name: updated.name, displayName: updated.displayName });
    } else {
      const created = await monitoringRequest(accessToken, `projects/${projectId}/alertPolicies`, {
        method: 'POST',
        body: policy,
      });
      results.push({ action: 'created', name: created.name, displayName: created.displayName });
    }
  }

  return results;
}

async function setupBillingAlerts({ projectId = DEFAULT_PROJECT_ID } = {}) {
  const accessToken = await getAccessToken();
  const channelNames = await ensureNotificationChannels(accessToken, projectId);
  const policies = await ensureAlertPolicies(accessToken, projectId, channelNames);
  return { projectId, channelNames, policies };
}

if (require.main === module) {
  setupBillingAlerts()
    .then((res) => {
      console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    })
    .catch((err) => {
      console.error('Failed to set up billing alerts:', err.message);
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_PROJECT_ID,
  READ_THRESHOLD_PER_HOUR,
  WRITE_THRESHOLD_PER_HOUR,
  NOTIFICATION_EMAILS,
  getAccessToken,
  monitoringRequest,
  buildAlertPolicies,
  ensureNotificationChannels,
  ensureAlertPolicies,
  setupBillingAlerts,
};
