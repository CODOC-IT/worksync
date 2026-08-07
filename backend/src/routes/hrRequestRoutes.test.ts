import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canReviewRequestStage,
  canSubmitOwnCorrection,
  getInitialApprovalStage,
  mapHRRequestRow,
  validateNotPastDate
} from './hrRequestRoutes.js';

test('routes Team Member and Team Lead attendance edits to HR', () => {
  assert.equal(getInitialApprovalStage('Correction', 'Team_Member'), 'HR');
  assert.equal(getInitialApprovalStage('Correction', 'Team_Lead'), 'HR');
});

test('routes HR attendance edits directly to Admin', () => {
  assert.equal(getInitialApprovalStage('Correction', 'HR'), 'Admin');
});

test('routes Team Member leave to HR and HR leave to Admin', () => {
  assert.equal(getInitialApprovalStage('Leave', 'Team_Member'), 'HR');
  assert.equal(getInitialApprovalStage('Leave', 'HR'), 'Admin');
});

test('enforces staged reviewer roles', () => {
  assert.equal(canReviewRequestStage('Leave', 'HR', 'HR'), true);
  assert.equal(canReviewRequestStage('Correction', 'HR', 'HR'), true);
  assert.equal(canReviewRequestStage('Leave', 'HR', 'Admin'), false);
  assert.equal(canReviewRequestStage('Leave', 'Admin', 'Admin'), true);
  assert.equal(canReviewRequestStage('Correction', 'Admin', 'Admin'), true);
  assert.equal(canReviewRequestStage('Correction', 'Admin', 'HR'), false);
});

test('backend blocks past leave and allows today/future leave', () => {
  assert.equal(validateNotPastDate('2026-08-01', '2026-08-02'), 'Leave date cannot be in the past.');
  assert.equal(validateNotPastDate('2026-08-02', '2026-08-02'), null);
  assert.equal(validateNotPastDate('2026-08-03', '2026-08-02'), null);
});

test('Team Member and Team Lead can correct their own completed or Absent day', () => {
  assert.equal(canSubmitOwnCorrection('usr-1', 'usr-1', 'Team_Member', false), true);
  assert.equal(canSubmitOwnCorrection('usr-1', 'usr-1', 'Team_Lead', false), true);
});

test('another user, Admin, and active sessions cannot be corrected', () => {
  assert.equal(canSubmitOwnCorrection('usr-1', 'usr-2', 'Team_Member', false), false);
  assert.equal(canSubmitOwnCorrection('usr-1', 'usr-1', 'Admin', false), false);
  assert.equal(canSubmitOwnCorrection('usr-1', 'usr-1', 'Team_Member', true), false);
});

test('Half Day period persists into approval history DTOs', () => {
  const mapped = mapHRRequestRow({
    id: 'leave-1',
    user_id: 'usr-7',
    user_name: 'Member',
    requester_role: 'Team_Member',
    request_type: 'Leave',
    request_date: '2026-08-10',
    reason: 'Appointment',
    status: 'Approved',
    approval_stage: 'Admin',
    details: { leaveType: 'Half Day Leave', leavePeriod: 'First Half', leaveDays: 1 },
    submitted_at: '2026-08-07T10:00:00Z',
    decided_by: 'usr-1',
    decision_reason: null
  });
  assert.equal(mapped.details.leaveType, 'Half Day Leave');
  assert.equal(mapped.details.leavePeriod, 'First Half');
});
