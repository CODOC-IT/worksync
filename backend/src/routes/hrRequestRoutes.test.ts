import test from 'node:test';
import assert from 'node:assert/strict';
import { canReviewRequestStage, getInitialApprovalStage } from './hrRequestRoutes.js';

test('routes Team Member attendance edits directly to Admin', () => {
  assert.equal(getInitialApprovalStage('Correction', 'Team_Member'), 'Admin');
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
  assert.equal(canReviewRequestStage('Leave', 'HR', 'Admin'), false);
  assert.equal(canReviewRequestStage('Leave', 'Admin', 'Admin'), true);
  assert.equal(canReviewRequestStage('Correction', 'Admin', 'Admin'), true);
  assert.equal(canReviewRequestStage('Correction', 'Admin', 'HR'), false);
});
