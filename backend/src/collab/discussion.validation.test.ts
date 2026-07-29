import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_COMMENT_LENGTH,
  validateAddCommentBody,
  validateCreateThreadBody,
  validateEditCommentBody
} from './discussion.validation.js';

const validThread = {
  projectId: 'prj-1',
  title: 'Weekly coordination',
  type: 'General',
  body: 'A'.repeat(MAX_COMMENT_LENGTH)
};

test('accepts comments at the 50-character limit', () => {
  assert.equal(MAX_COMMENT_LENGTH, 50);
  assert.deepEqual(validateCreateThreadBody(validThread), { valid: true });
  assert.deepEqual(validateAddCommentBody({ body: validThread.body }), { valid: true });
  assert.deepEqual(validateEditCommentBody({ body: validThread.body }), { valid: true });
});

test('rejects initial messages, replies, and edits over 50 characters', () => {
  const body = 'A'.repeat(MAX_COMMENT_LENGTH + 1);
  assert.equal(validateCreateThreadBody({ ...validThread, body }).valid, false);
  assert.equal(validateAddCommentBody({ body }).valid, false);
  assert.equal(validateEditCommentBody({ body }).valid, false);
});
