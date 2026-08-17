import test from 'node:test';
import assert from 'node:assert/strict';

test('runtime project approval module exposes createApprovalRequest as a named function', async () => {
  const approvalService = await import('./projectApproval.service.js');
  assert.equal(typeof approvalService.createApprovalRequest, 'function');
});

test('project controller loads against the named project approval export', async () => {
  const controller = await import('./project.controller.js');
  assert.equal(typeof controller.updateProject, 'function');
});
