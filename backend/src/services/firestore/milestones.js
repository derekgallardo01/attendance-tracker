// Automated Founder / Admin Growth Milestones Engine
// Tracks key growth milestones (total users, paid pro customers, meetings tracked)
// and idempotently alerts the founder when thresholds are crossed.

const { getDb, FieldValue, log } = require('./_core');

const USER_MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const PRO_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MEETING_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

const METRIC_CONFIG = {
  users: {
    label: 'Registered Users',
    icon: '👥',
    thresholds: USER_MILESTONES,
    format: (v) => `${Number(v).toLocaleString()} Users`,
  },
  pro: {
    label: 'Pro Customers',
    icon: '💰',
    thresholds: PRO_MILESTONES,
    format: (v) => `${Number(v).toLocaleString()} Pro Customers`,
  },
  meetings: {
    label: 'Meetings Tracked',
    icon: '📊',
    thresholds: MEETING_MILESTONES,
    format: (v) => `${Number(v).toLocaleString()} Meetings Tracked`,
  },
};

/**
 * Returns the next upcoming milestone target given a current value.
 */
function getNextMilestone(currentVal, thresholds) {
  const num = Number(currentVal) || 0;
  for (const t of thresholds) {
    if (num < t) {
      const prev = thresholds[thresholds.indexOf(t) - 1] || 0;
      const progress = Math.min(100, Math.max(0, Math.round(((num - prev) / (t - prev)) * 100)));
      return { target: t, previous: prev, current: num, progressPercent: progress, remaining: t - num };
    }
  }
  return { target: null, previous: thresholds[thresholds.length - 1], current: num, progressPercent: 100, remaining: 0 };
}

/**
 * Finds all milestone thresholds that have been reached by currentVal.
 */
function getEligibleMilestones(metric, currentVal) {
  const cfg = METRIC_CONFIG[metric];
  if (!cfg) return [];
  const num = Number(currentVal) || 0;
  return cfg.thresholds
    .filter(t => num >= t)
    .map(t => ({
      id: `${metric}_${t}`,
      metric,
      threshold: t,
      label: `${cfg.icon} ${cfg.format(t)}`,
    }));
}

/**
 * Check metrics and record any newly achieved milestones.
 * Idempotently saves to Firestore `admin_milestones` collection and dispatches alert.
 *
 * @param {Object} counts - { userCount, proCount, meetingCount }
 * @param {Object} options - { sendNotificationFn, meta }
 * @returns {Promise<Array>} newly unlocked milestones
 */
async function checkAndRecordMilestones(counts = {}, options = {}) {
  const db = getDb();
  if (!db) return [];

  const userCount = Number(counts.userCount || counts.users || 0);
  const proCount = Number(counts.proCount || counts.activeProUsers || 0);
  const meetingCount = Number(counts.meetingCount || counts.meetings || 0);

  const metricsToCheck = [
    { metric: 'users', count: userCount },
    { metric: 'pro', count: proCount },
    { metric: 'meetings', count: meetingCount },
  ];

  const newlyUnlocked = [];

  try {
    const milestonesColl = db.collection('admin_milestones');
    const existingSnap = await milestonesColl.get();
    const existingIds = new Set(existingSnap.docs.map(d => d.id));

    for (const { metric, count } of metricsToCheck) {
      if (count <= 0) continue;
      const eligible = getEligibleMilestones(metric, count);

      for (const m of eligible) {
        if (!existingIds.has(m.id)) {
          // New milestone reached!
          const record = {
            id: m.id,
            metric: m.metric,
            threshold: m.threshold,
            currentValue: count,
            label: m.label,
            reachedAt: FieldValue.serverTimestamp(),
            notified: false,
            meta: options.meta || null,
          };

          await milestonesColl.doc(m.id).set(record);
          existingIds.add(m.id);

          log.info('milestone: unlocked new milestone', { id: m.id, metric: m.metric, threshold: m.threshold, count });

          // Send notification email if handler provided or imported
          let notifyFn = options.sendNotificationFn;
          if (!notifyFn) {
            try {
              const { sendAdminMilestoneEmail } = require('../../lib/notifications');
              notifyFn = sendAdminMilestoneEmail;
            } catch (_) {}
          }

          if (typeof notifyFn === 'function') {
            try {
              await notifyFn({
                milestone: m,
                currentStats: { userCount, proCount, meetingCount },
                meta: options.meta,
              });
              await milestonesColl.doc(m.id).update({
                notified: true,
                notifiedAt: FieldValue.serverTimestamp(),
              });
            } catch (err) {
              log.warn('milestone: alert email dispatch failed', { id: m.id, error: err.message });
            }
          }

          newlyUnlocked.push(record);
        }
      }
    }
  } catch (err) {
    log.error('milestones: checkAndRecordMilestones failed', { error: err.message });
  }

  return newlyUnlocked;
}

/**
 * Returns all achieved milestones and upcoming milestone targets.
 */
async function getMilestoneProgress(counts = {}) {
  const db = getDb();
  let achieved = [];

  if (db) {
    try {
      const snap = await db.collection('admin_milestones').orderBy('threshold', 'asc').get();
      achieved = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          metric: data.metric,
          threshold: data.threshold,
          label: data.label || `${METRIC_CONFIG[data.metric]?.icon || '🏆'} ${data.threshold} ${data.metric}`,
          reachedAt: data.reachedAt?.toDate?.()?.toISOString() || data.reachedAt || null,
          currentValue: data.currentValue || data.threshold,
        };
      });
    } catch (err) {
      log.warn('milestones: could not fetch achieved milestones', { error: err.message });
    }
  }

  const userCount = Number(counts.userCount || counts.users || 0);
  const proCount = Number(counts.proCount || counts.activeProUsers || 0);
  const meetingCount = Number(counts.meetingCount || counts.meetings || 0);

  return {
    achieved,
    upcoming: {
      users: {
        metric: 'users',
        label: 'Users',
        icon: '👥',
        ...getNextMilestone(userCount, USER_MILESTONES),
      },
      pro: {
        metric: 'pro',
        label: 'Pro Customers',
        icon: '💰',
        ...getNextMilestone(proCount, PRO_MILESTONES),
      },
      meetings: {
        metric: 'meetings',
        label: 'Meetings Tracked',
        icon: '📊',
        ...getNextMilestone(meetingCount, MEETING_MILESTONES),
      },
    },
  };
}

module.exports = {
  USER_MILESTONES,
  PRO_MILESTONES,
  MEETING_MILESTONES,
  METRIC_CONFIG,
  getNextMilestone,
  getEligibleMilestones,
  checkAndRecordMilestones,
  getMilestoneProgress,
};
