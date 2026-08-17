import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeaveDecisionCopy,
  buildLeaveForwardedCopy,
  buildLeaveRequestedCopy,
  describeLeavePeriod,
  describeLeaveType,
  formatLeaveDate
} from './leaveNotifications.js';

const fullDay = { date: '2026-08-12', reason: 'Family commitment', details: { leaveType: 'Full Day Leave' as const } };
const halfDayMorning = {
  date: '2026-08-12',
  reason: 'Medical appointment',
  details: { leaveType: 'Half Day Leave' as const, leavePeriod: 'First Half' as const }
};
const halfDayAfternoon = {
  date: '2026-08-12',
  reason: 'Medical appointment',
  details: { leaveType: 'Half Day Leave' as const, leavePeriod: 'Second Half' as const }
};

test('describes full-day and half-day leave distinctly, naming the half', () => {
  assert.equal(describeLeaveType(fullDay.details), 'Full Day Leave');
  assert.equal(describeLeaveType(halfDayMorning.details), 'Half Day Leave (Morning)');
  assert.equal(describeLeaveType(halfDayAfternoon.details), 'Half Day Leave (Afternoon)');
});

test('a half day with no recorded period still reads as a half day, never a full day', () => {
  assert.equal(describeLeaveType({ leaveType: 'Half Day Leave' }), 'Half Day Leave');
  assert.equal(describeLeavePeriod({ leaveType: 'Half Day Leave' }), undefined);
});

test('leave requests predating the half-day option default to Full Day', () => {
  assert.equal(describeLeaveType(undefined), 'Full Day Leave');
  assert.equal(describeLeaveType({}), 'Full Day Leave');
  assert.equal(describeLeavePeriod(fullDay.details), undefined);
});

test('dates render unambiguously as "12 Aug 2026", never as 08/12', () => {
  assert.equal(formatLeaveDate('2026-08-12'), '12 Aug 2026');
  assert.equal(formatLeaveDate('not-a-date'), 'not-a-date');
});

test('submitted-leave preview names the leave type, the half and the date', () => {
  assert.equal(
    buildLeaveRequestedCopy({ requesterName: 'Bilal', request: fullDay }).message,
    'Bilal has applied for a Full Day Leave on 12 Aug 2026.'
  );
  assert.equal(
    buildLeaveRequestedCopy({ requesterName: 'Bilal', request: halfDayMorning }).message,
    'Bilal has applied for a Half Day Leave (Morning) on 12 Aug 2026.'
  );
});

test('decision previews name the leave type, and the reason stays in the expanded body', () => {
  const approved = buildLeaveDecisionCopy({
    decision: 'Approved',
    approverName: 'Maryam',
    request: fullDay
  });
  assert.equal(approved.title, 'Full Day Leave Approved');
  assert.equal(approved.message, 'Your Full Day Leave on 12 Aug 2026 has been approved by Maryam.');

  const rejected = buildLeaveDecisionCopy({
    decision: 'Rejected',
    approverName: 'Maryam',
    request: halfDayAfternoon,
    decisionReason: 'Sprint review is that afternoon.'
  });
  assert.equal(rejected.title, 'Half Day Leave (Afternoon) Rejected');
  assert.equal(
    rejected.message,
    'Your Half Day Leave (Afternoon) on 12 Aug 2026 has been rejected by Maryam.'
  );
  // The preview stays scannable; the mandatory reason is carried in `detail`/`metadata` so the
  // Notification Center can show it on expand and it survives a refresh.
  assert.ok(!rejected.message.includes('Sprint review'));
  assert.ok(rejected.detail.includes('Reason: Sprint review is that afternoon.'));
  assert.equal(rejected.metadata.rejectionReason, 'Sprint review is that afternoon.');
  assert.equal(rejected.metadata.status, 'Rejected');
  assert.equal(rejected.metadata.period, 'Afternoon');
});

test('the HR-to-Admin forward names the leave type for both audiences', () => {
  const copy = buildLeaveForwardedCopy({
    requesterName: 'Bilal',
    approverName: 'Maryam',
    request: halfDayMorning
  });
  assert.equal(copy.title, 'Half Day Leave (Morning) Awaiting Final Approval');
  assert.ok(copy.message.includes('Half Day Leave (Morning)'));
  assert.equal(copy.metadata.status, 'Pending Admin approval');
});
