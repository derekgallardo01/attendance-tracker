const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, milestonesService;

beforeEach(() => {
  ctx = installFirestoreMock();
  milestonesService = require('../../src/services/firestore/milestones');
});

afterEach(() => {
  ctx.uninstall();
});

describe('milestonesService - getNextMilestone', () => {
  test('computes next milestone, remaining count, and progress percent', () => {
    const thresholds = [100, 250, 500, 1000];

    // Under first threshold
    const under = milestonesService.getNextMilestone(50, thresholds);
    expect(under.target).toBe(100);
    expect(under.previous).toBe(0);
    expect(under.remaining).toBe(50);
    expect(under.progressPercent).toBe(50);

    // Exact threshold boundary
    const exact = milestonesService.getNextMilestone(100, thresholds);
    expect(exact.target).toBe(250);
    expect(exact.previous).toBe(100);
    expect(exact.remaining).toBe(150);
    expect(exact.progressPercent).toBe(0);

    // Between thresholds
    const mid = milestonesService.getNextMilestone(175, thresholds);
    expect(mid.target).toBe(250);
    expect(mid.previous).toBe(100);
    expect(mid.remaining).toBe(75);
    expect(mid.progressPercent).toBe(50);

    // Beyond all thresholds
    const max = milestonesService.getNextMilestone(2000, thresholds);
    expect(max.target).toBeNull();
    expect(max.remaining).toBe(0);
    expect(max.progressPercent).toBe(100);
  });
});

describe('milestonesService - getEligibleMilestones', () => {
  test('returns eligible milestones for registered users', () => {
    const eligible = milestonesService.getEligibleMilestones('users', 300);
    expect(eligible.map(e => e.threshold)).toEqual([100, 250]);
    expect(eligible[0].id).toBe('users_100');
    expect(eligible[1].id).toBe('users_250');
  });

  test('returns empty array for non-existent metric or zero count', () => {
    expect(milestonesService.getEligibleMilestones('invalid_metric', 100)).toEqual([]);
    expect(milestonesService.getEligibleMilestones('users', 0)).toEqual([]);
  });
});

describe('milestonesService - checkAndRecordMilestones & getMilestoneProgress', () => {
  test('idempotently records unlocked milestones and dispatches notifications', async () => {
    const notified = [];
    const mockNotifyFn = async (payload) => {
      notified.push(payload);
      return { ok: true };
    };

    // First sweep: crossing 100 users, 10 pro, 500 meetings
    const newlyUnlocked1 = await milestonesService.checkAndRecordMilestones(
      { userCount: 120, proCount: 15, meetingCount: 600 },
      { sendNotificationFn: mockNotifyFn }
    );

    expect(newlyUnlocked1.length).toBe(3);
    const unlockedIds1 = newlyUnlocked1.map(m => m.id);
    expect(unlockedIds1).toContain('users_100');
    expect(unlockedIds1).toContain('pro_10');
    expect(unlockedIds1).toContain('meetings_500');
    expect(notified.length).toBe(3);

    // Check Firestore doc directly in mock
    const userMilestoneDoc = ctx.read('admin_milestones/users_100');
    expect(userMilestoneDoc).toBeDefined();
    expect(userMilestoneDoc.threshold).toBe(100);
    expect(userMilestoneDoc.notified).toBe(true);

    // Second sweep with the EXACT SAME counts — must be idempotent (0 newly unlocked, 0 new emails)
    const newlyUnlocked2 = await milestonesService.checkAndRecordMilestones(
      { userCount: 120, proCount: 15, meetingCount: 600 },
      { sendNotificationFn: mockNotifyFn }
    );
    expect(newlyUnlocked2.length).toBe(0);
    expect(notified.length).toBe(3); // unchanged!

    // Third sweep: growth surge crossing 250 users
    const newlyUnlocked3 = await milestonesService.checkAndRecordMilestones(
      { userCount: 260, proCount: 15, meetingCount: 600 },
      { sendNotificationFn: mockNotifyFn }
    );
    expect(newlyUnlocked3.length).toBe(1);
    expect(newlyUnlocked3[0].id).toBe('users_250');
    expect(notified.length).toBe(4);

    // Fetch progress overview
    const progress = await milestonesService.getMilestoneProgress({
      userCount: 260,
      proCount: 15,
      meetingCount: 600,
    });

    expect(progress.achieved.length).toBe(4);
    expect(progress.upcoming.users.target).toBe(500);
    expect(progress.upcoming.users.remaining).toBe(240);
    expect(progress.upcoming.pro.target).toBe(25);
    expect(progress.upcoming.pro.remaining).toBe(10);
    expect(progress.upcoming.meetings.target).toBe(1000);
    expect(progress.upcoming.meetings.remaining).toBe(400);
  });
});
