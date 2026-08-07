import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectApprovalRejectionCopy, formatRejectedOn } from './projectApprovalRejectionCopy.js';

const REASON =
  'The project timeline is incomplete. Please assign all required team members and ' +
  'complete the project milestones before resubmitting.';

test('formats a decision timestamp as "08 Aug 2026, 2:45 PM"', () => {
  assert.equal(formatRejectedOn(new Date(2026, 7, 8, 14, 45)), '08 Aug 2026, 2:45 PM');
});

test('preview stays concise and does not include the rejection reason', () => {
  const copy = buildProjectApprovalRejectionCopy({
    reviewerName: 'Bilal Ahmed',
    projectName: 'ERP Management System',
    requestTypeLabel: 'create',
    reason: REASON,
    decidedAt: new Date(2026, 7, 8, 14, 45)
  });
  assert.equal(copy.title, 'Project Approval Request Rejected');
  assert.equal(copy.message, 'Bilal Ahmed rejected your approval request for "ERP Management System".');
  assert.ok(!copy.message.includes(REASON), 'the compact preview must not carry the full reason');
});

test('expanded detail carries the full reason and reads naturally for any request type', () => {
  const copy = buildProjectApprovalRejectionCopy({
    reviewerName: 'Bilal Ahmed',
    projectName: 'ERP Management System',
    requestTypeLabel: 'archive',
    reason: REASON,
    decidedAt: new Date(2026, 7, 8, 14, 45)
  });
  assert.ok(copy.detail.includes('rejected your request to archive "ERP Management System"'));
  assert.ok(copy.detail.includes(`Reason: ${REASON}`));
});

test('metadata matches the spec\'s expanded-view field set exactly', () => {
  const copy = buildProjectApprovalRejectionCopy({
    reviewerName: 'Bilal Ahmed',
    projectName: 'ERP Management System',
    requestTypeLabel: 'create',
    reason: REASON,
    decidedAt: new Date(2026, 7, 8, 14, 45)
  });
  assert.deepEqual(copy.metadata, {
    project: 'ERP Management System',
    rejectedBy: 'Bilal Ahmed (Admin)',
    status: 'Rejected',
    reason: REASON,
    rejectedOn: '08 Aug 2026, 2:45 PM',
    requestType: 'create'
  });
});

test('an empty/whitespace reason renders as "No reason was recorded." rather than a blank line', () => {
  const copy = buildProjectApprovalRejectionCopy({
    reviewerName: 'Bilal Ahmed',
    projectName: 'ERP Management System',
    requestTypeLabel: 'edit',
    reason: '   ',
    decidedAt: new Date(2026, 7, 8, 14, 45)
  });
  assert.ok(copy.detail.includes('Reason: No reason was recorded.'));
  // Still surfaced in metadata as an empty string, not fabricated text -- a consumer that reads
  // metadata.reason directly (rather than the prose `detail`) should see "there was none", not a
  // sentence pretending there was.
  assert.equal(copy.metadata.reason, '');
});

test('the reason is trimmed of surrounding whitespace', () => {
  const copy = buildProjectApprovalRejectionCopy({
    reviewerName: 'Bilal Ahmed',
    projectName: 'ERP Management System',
    requestTypeLabel: 'create',
    reason: '  Needs more detail.  ',
    decidedAt: new Date(2026, 7, 8, 14, 45)
  });
  assert.equal(copy.metadata.reason, 'Needs more detail.');
});
