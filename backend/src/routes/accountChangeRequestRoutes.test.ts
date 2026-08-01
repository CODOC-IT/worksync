import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAccountReviewMessages,
  canReviewAccountChangeRequest,
  cleanRejectionReason,
  getApprovedProfileChange,
  sanitizeAccountRequestedChanges,
  shouldApplyAccountProfileChange
} from './accountChangeRequestRoutes.js';

const pendingRequest = {
  user_id: 'usr-10',
  assigned_approver_role: 'HR',
  status: 'Pending' as const
};

test('assigned HR approver can review a pending account change request', () => {
  assert.equal(canReviewAccountChangeRequest('usr-20', 'HR', pendingRequest), true);
});

test('Admin can reject an HR request assigned to Admin', () => {
  assert.equal(
    canReviewAccountChangeRequest('usr-1', 'Admin', {
      user_id: 'usr-30',
      assigned_approver_role: 'Admin',
      status: 'Pending'
    }),
    true
  );
});

test('wrong role cannot review an account change request', () => {
  assert.equal(canReviewAccountChangeRequest('usr-20', 'Admin', pendingRequest), false);
  assert.equal(canReviewAccountChangeRequest('usr-20', 'Team_Lead', pendingRequest), false);
});

test('requester cannot review their own account change request', () => {
  assert.equal(canReviewAccountChangeRequest('usr-10', 'HR', pendingRequest), false);
});

test('an already reviewed request cannot be reviewed again', () => {
  assert.equal(
    canReviewAccountChangeRequest('usr-20', 'HR', { ...pendingRequest, status: 'Approved' }),
    false
  );
  assert.equal(
    canReviewAccountChangeRequest('usr-20', 'HR', { ...pendingRequest, status: 'Rejected' }),
    false
  );
});

test('rejection reason is required and trimmed', () => {
  assert.throws(() => cleanRejectionReason(undefined), /required/i);
  assert.throws(() => cleanRejectionReason('   '), /required/i);
  assert.equal(cleanRejectionReason('  Incorrect email  '), 'Incorrect email');
});

test('rejection reason is bounded before it can enter a notification or activity record', () => {
  assert.throws(() => cleanRejectionReason('x'.repeat(1001)), /must not exceed/i);
});

test('approved profile changes retain only the supported target field and trimmed value', () => {
  assert.deepEqual(
    getApprovedProfileChange('name', { name: '  Updated Member  ' }),
    { field: 'name', value: 'Updated Member' }
  );
  assert.deepEqual(
    getApprovedProfileChange('email', { email: 'member@example.com' }),
    { field: 'email', value: 'member@example.com' }
  );
  assert.deepEqual(
    getApprovedProfileChange('username', { username: 'updated.member' }),
    { field: 'username', value: 'updated.member' }
  );
});

test('password approval is refused without exposing a password value', () => {
  const secret = 'NeverExpose#123';
  assert.throws(
    () => getApprovedProfileChange('password', { password: secret, password_hash: secret }),
    (error: Error) => {
      assert.match(error.message, /secure password completion flow/i);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    }
  );
});

test('review notification and activity messages describe approval without profile values', () => {
  const messages = buildAccountReviewMessages('Approved', 'Helen HR', 'Taylor Member', 'email');
  assert.equal(messages.notification, 'Your account change request was approved.');
  assert.match(messages.activity, /Helen HR approved Taylor Member's account email change request/);
  assert.doesNotMatch(JSON.stringify(messages), /new-address@example\.com/);
});

test('rejection notification includes the required reason and activity records rejection', () => {
  const messages = buildAccountReviewMessages(
    'Rejected',
    'Helen HR',
    'Taylor Member',
    'username',
    'Username conflicts with policy.'
  );
  assert.match(messages.notification, /Reason: Username conflicts with policy\./);
  assert.match(messages.activity, /rejected Taylor Member's account username change request/);
});

test('password and credential values are removed from API-visible requested changes', () => {
  const safe = sanitizeAccountRequestedChanges({
    name: 'Visible name',
    password: 'NeverExpose#123',
    password_hash: 'hashed-secret',
    current_password_verified: 'true',
    resetToken: 'secret-token',
  });
  assert.deepEqual(safe, { name: 'Visible name' });
  assert.doesNotMatch(JSON.stringify(safe), /NeverExpose|hashed-secret|secret-token/);
});

test('rejection messages do not include requested profile values', () => {
  const requestedValue = 'private.requested@example.com';
  const messages = buildAccountReviewMessages(
    'Rejected',
    'Helen HR',
    'Taylor Member',
    'email',
    'Please contact HR to verify this request.'
  );
  assert.doesNotMatch(JSON.stringify(messages), new RegExp(requestedValue));
});

test('a rejected request never enters profile update logic', () => {
  assert.equal(shouldApplyAccountProfileChange('Rejected'), false);
  assert.equal(shouldApplyAccountProfileChange('Approved'), true);
});
