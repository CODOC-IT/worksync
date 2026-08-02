import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountChangeRequest } from '../../types';
import {
  getOwnAccountChangeRequests,
  getSafeRequestedChangeLabel
} from './accountChangeRequestHistory.js';

const rejectedRequest: AccountChangeRequest = {
  id: 'acr-1',
  userId: 'usr-10',
  userName: 'Taylor Member',
  requesterRole: 'Team_Member',
  requestType: 'Account_Change',
  requestedField: 'email',
  requestedChanges: { email: 'updated@example.com' },
  reason: 'My address changed.',
  status: 'Rejected',
  assignedApproverRole: 'HR',
  submittedAt: '2026-07-31 10:00',
  decidedBy: 'usr-20',
  decisionReason: 'Please verify the address with HR.',
  decidedAt: '2026-07-31 11:00'
};

test('requester history retains rejected status, rejection reason, and decision time', () => {
  const [request] = getOwnAccountChangeRequests([rejectedRequest], 'usr-10');
  assert.equal(request.status, 'Rejected');
  assert.equal(request.decisionReason, 'Please verify the address with HR.');
  assert.equal(request.decidedAt, '2026-07-31 11:00');
});

test('requester history excludes another user account change request', () => {
  const anotherUsersRequest = { ...rejectedRequest, id: 'acr-2', userId: 'usr-99' };
  assert.deepEqual(
    getOwnAccountChangeRequests([rejectedRequest, anotherUsersRequest], 'usr-10').map((request) => request.id),
    ['acr-1']
  );
});

test('password request history exposes only a safe label', () => {
  const secret = 'NeverExpose#123';
  const passwordRequest: AccountChangeRequest = {
    ...rejectedRequest,
    requestedField: 'password',
    requestedChanges: { password: secret, password_hash: secret },
    passwordChangeRequested: true
  };
  const label = getSafeRequestedChangeLabel(passwordRequest);
  assert.equal(label, 'Password change requested');
  assert.doesNotMatch(label, new RegExp(secret));
});
