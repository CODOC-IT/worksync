import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommentDTO } from './discussion.mapper.js';
import type { CommentRow } from './discussion.types.js';

const deletedComment: CommentRow = {
  commentid: 8,
  threadid: 4,
  parentcommentid: null,
  authoruserid: 2,
  commentkind: 'General',
  commenttext: 'This is retained for authorized review.',
  createdatutc: new Date('2026-08-08T10:00:00Z'),
  editedatutc: null,
  deletedatutc: new Date('2026-08-08T10:05:00Z')
};

test('deleted comment content is redacted for members', async () => {
  const dto = await buildCommentDTO(deletedComment, [], [], false);
  assert.equal(dto.body, '[deleted]');
  assert.deepEqual(dto.attachments, []);
});

test('deleted comment content remains available for HR and Admin review', async () => {
  const dto = await buildCommentDTO(deletedComment, [], [], true);
  assert.equal(dto.body, 'This is retained for authorized review.');
});
