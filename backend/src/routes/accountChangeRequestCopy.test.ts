import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAccountChangeApprovalCopy,
  buildAccountChangeRejectionCopy,
  humanizeAccountField
} from './accountChangeRequestCopy.js';

const REASON = 'Please provide a work-issued email address instead of a personal one before resubmitting.';
const DECIDED_AT = new Date(2026, 7, 8, 14, 45);

test('humanizes each recognized field key, and degrades unknown/missing keys to "Profile"', () => {
  assert.equal(humanizeAccountField('name'), 'Display Name');
  assert.equal(humanizeAccountField('email'), 'Email');
  assert.equal(humanizeAccountField('username'), 'Username');
  assert.equal(humanizeAccountField('password'), 'Password');
  assert.equal(humanizeAccountField('something-unexpected'), 'Profile');
  assert.equal(humanizeAccountField(null), 'Profile');
  assert.equal(humanizeAccountField(undefined), 'Profile');
});

test('approval preview names the reviewer and the field', () => {
  const copy = buildAccountChangeApprovalCopy({
    reviewerName: 'Maryam Yousaf',
    fieldLabel: 'Email',
    decidedAt: DECIDED_AT
  });
  assert.equal(copy.title, 'Account Change Request Approved');
  assert.equal(copy.message, 'Maryam Yousaf approved your email change request.');
  assert.equal(copy.metadata.status, 'Approved');
  assert.equal(copy.metadata.approvedBy, 'Maryam Yousaf');
  assert.equal(copy.metadata.decidedOn, '08 Aug 2026, 2:45 PM');
});

test('rejection preview stays concise and omits the reason', () => {
  const copy = buildAccountChangeRejectionCopy({
    reviewerName: 'Maryam Yousaf',
    fieldLabel: 'Email',
    reason: REASON,
    decidedAt: DECIDED_AT
  });
  assert.equal(copy.title, 'Account Change Request Rejected');
  assert.equal(copy.message, 'Maryam Yousaf rejected your email change request.');
  assert.ok(!copy.message.includes(REASON), 'the compact preview must not carry the full reason');
});

test('rejection detail and metadata carry the full reason', () => {
  const copy = buildAccountChangeRejectionCopy({
    reviewerName: 'Maryam Yousaf',
    fieldLabel: 'Username',
    reason: REASON,
    decidedAt: DECIDED_AT
  });
  assert.ok(copy.detail.includes('rejected your request to change your username'));
  assert.ok(copy.detail.includes(`Reason: ${REASON}`));
  assert.deepEqual(copy.metadata, {
    field: 'Username',
    rejectedBy: 'Maryam Yousaf',
    status: 'Rejected',
    reason: REASON,
    decidedOn: '08 Aug 2026, 2:45 PM'
  });
});

test('an empty/whitespace rejection reason renders as "No reason was recorded."', () => {
  const copy = buildAccountChangeRejectionCopy({
    reviewerName: 'Maryam Yousaf',
    fieldLabel: 'Display Name',
    reason: '   ',
    decidedAt: DECIDED_AT
  });
  assert.ok(copy.detail.includes('Reason: No reason was recorded.'));
  assert.equal(copy.metadata.reason, '');
});
