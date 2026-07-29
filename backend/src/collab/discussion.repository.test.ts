import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { newDb } from 'pg-mem';
import { setPoolForTesting, resetPoolForTesting } from '../db/pool.js';

// Repository tests run against pg-mem (an in-memory Postgres emulator) executing the REAL
// collab.DiscussionThreads/Comments/CommentMentions table shapes from
// database/05_collab_tables.sql and their FK targets from database/02_org_tables.sql /
// database/03_iam_tables.sql / database/04_work_tables.sql — trimmed to the columns these tests
// actually exercise, matching the exact approach and caveats already documented in
// notification.repository.test.ts. CHECK constraints are intentionally omitted (the repository
// layer only ever writes values discussion.service.ts has already validated, so exercising
// constraint-violation paths isn't this suite's job).
//
// Scoped to discussion.repository.ts only, not discussion.service.ts — the service layer also
// calls into backend/src/store/userStore.ts (actor names/emails, mention-eligibility checks),
// which is a real Supabase/file-backed singleton loaded at process start, not something this
// pg-mem swap can substitute for. Attachment storage (collab.StoredFiles/CommentFiles, backed by
// real local-disk content-addressed storage — see fileStorage.ts) was verified live against the
// running dev server and a real project/user instead of here, to avoid writing test fixtures to
// the real backend/storage/collab-files directory.

const SCHEMA_DDL = `
  CREATE SCHEMA org;
  CREATE SCHEMA iam;
  CREATE SCHEMA work;
  CREATE SCHEMA collab;

  CREATE TABLE org.Organizations (
    OrganizationId SERIAL PRIMARY KEY,
    OrganizationCode VARCHAR(30) NOT NULL
  );

  CREATE TABLE iam.Users (
    UserId SERIAL PRIMARY KEY,
    OrganizationId INT NOT NULL REFERENCES org.Organizations(OrganizationId),
    Email VARCHAR(254) NOT NULL,
    DisplayName VARCHAR(170) NOT NULL
  );

  CREATE TABLE work.ProjectStatuses (
    ProjectStatusId SERIAL PRIMARY KEY,
    StatusCode VARCHAR(30) NOT NULL
  );

  CREATE TABLE work.Priorities (
    PriorityId SERIAL PRIMARY KEY,
    PriorityCode VARCHAR(20) NOT NULL
  );

  CREATE TABLE work.Projects (
    ProjectId SERIAL PRIMARY KEY,
    OrganizationId INT NOT NULL REFERENCES org.Organizations(OrganizationId),
    ProjectCode VARCHAR(30) NOT NULL,
    ProjectName VARCHAR(150) NOT NULL,
    OwnerUserId INT NOT NULL REFERENCES iam.Users(UserId),
    ProjectStatusId SMALLINT NOT NULL REFERENCES work.ProjectStatuses(ProjectStatusId),
    PriorityId SMALLINT NOT NULL REFERENCES work.Priorities(PriorityId)
  );

  CREATE TABLE work.TaskStatuses (
    TaskStatusId SERIAL PRIMARY KEY,
    StatusCode VARCHAR(30) NOT NULL
  );

  CREATE TABLE work.Tasks (
    TaskId BIGSERIAL PRIMARY KEY,
    ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
    Title VARCHAR(200) NOT NULL,
    TaskStatusId SMALLINT NOT NULL REFERENCES work.TaskStatuses(TaskStatusId),
    PriorityId SMALLINT NOT NULL REFERENCES work.Priorities(PriorityId)
  );

  CREATE TABLE collab.DiscussionThreads (
    ThreadId BIGSERIAL PRIMARY KEY,
    OrganizationId INT NOT NULL,
    ThreadType VARCHAR(30) NOT NULL,
    Subject VARCHAR(200) NULL,
    ProjectId INT NULL REFERENCES work.Projects(ProjectId),
    TaskId BIGINT NULL REFERENCES work.Tasks(TaskId),
    CreatedByUserId INT NOT NULL REFERENCES iam.Users(UserId),
    IsResolved BOOLEAN NOT NULL DEFAULT FALSE,
    ResolvedByUserId INT NULL,
    ResolvedAtUtc TIMESTAMPTZ NULL,
    CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE collab.Comments (
    CommentId BIGSERIAL PRIMARY KEY,
    ThreadId BIGINT NOT NULL REFERENCES collab.DiscussionThreads(ThreadId),
    ParentCommentId BIGINT NULL,
    AuthorUserId INT NOT NULL REFERENCES iam.Users(UserId),
    CommentKind VARCHAR(30) NOT NULL DEFAULT 'General',
    CommentText TEXT NOT NULL,
    CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    EditedAtUtc TIMESTAMPTZ NULL,
    DeletedAtUtc TIMESTAMPTZ NULL,
    RowVersion BIGINT NOT NULL DEFAULT 1
  );

  CREATE TABLE collab.CommentMentions (
    CommentId BIGINT NOT NULL REFERENCES collab.Comments(CommentId),
    MentionedUserId INT NOT NULL REFERENCES iam.Users(UserId),
    PRIMARY KEY (CommentId, MentionedUserId)
  );
`;

const SEED_DML = `
  INSERT INTO org.Organizations (OrganizationCode) VALUES ('WORKSYNC');
  INSERT INTO iam.Users (OrganizationId, Email, DisplayName) VALUES
    (1, 'lead@test.com', 'Team Lead User'),
    (1, 'member@test.com', 'Team Member User');
  INSERT INTO work.ProjectStatuses (StatusCode) VALUES ('Active');
  INSERT INTO work.Priorities (PriorityCode) VALUES ('Medium');
  INSERT INTO work.TaskStatuses (StatusCode) VALUES ('Todo');
  INSERT INTO work.Projects (OrganizationId, ProjectCode, ProjectName, OwnerUserId, ProjectStatusId, PriorityId)
    VALUES (1, 'PROJ-1', 'Test Project', 1, 1, 1), (1, 'PROJ-2', 'Other Project', 1, 1, 1);
  INSERT INTO work.Tasks (ProjectId, Title, TaskStatusId, PriorityId) VALUES (1, 'Test Task', 1, 1);
`;

let db: ReturnType<typeof newDb>;

before(() => {
  // autoCreateForeignKeyIndices left off (unlike notification.repository.test.ts's db) — pg-mem
  // mishandles `col = ANY($::type[])` against an auto-indexed FK column (same bug family as that
  // file's documented UNIQUE-column issue; here it's collab.Comments.ThreadId referencing
  // collab.DiscussionThreads), returning zero rows even though the exact same query behaves
  // correctly against real Postgres (confirmed via live testing against the running dev server).
  db = newDb({ autoCreateForeignKeyIndices: false });
  db.public.none(SCHEMA_DDL);
  db.public.none(SEED_DML);
  const { Pool } = db.adapters.createPg();
  setPoolForTesting(new Pool());
});

after(() => {
  resetPoolForTesting();
});

beforeEach(() => {
  db.public.none(`
    DELETE FROM collab.CommentMentions;
    DELETE FROM collab.Comments;
    DELETE FROM collab.DiscussionThreads;
  `);
});

test('insertThread: creates a Project-scoped thread with its opening comment', async () => {
  const repo = await import('./discussion.repository.js');
  const { threadId, commentId } = await repo.insertThread({
    projectId: 1,
    title: 'Release readiness',
    commentKind: 'Decision',
    creatorUserId: 1,
    body: 'Please confirm the release criteria.',
    mentionUserIds: [2],
    attachments: []
  });

  const row = await repo.findThreadById(threadId);
  assert.ok(row);
  assert.equal(row!.threadtype, 'Project');
  assert.equal(row!.effectiveprojectid, 1, 'Project-type thread reads ProjectId directly');
  assert.equal(row!.taskid, null);

  const comments = await repo.findCommentsForThreads([threadId]);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].commentid, commentId);
  assert.equal(comments[0].commentkind, 'Decision');
  assert.equal(comments[0].parentcommentid, null);

  const mentions = await repo.findMentionsForComments([commentId]);
  assert.deepEqual(mentions.map((m) => m.mentioneduserid), [2]);
});

test('insertThread: a Task-scoped thread derives its project id via the task, not a stored column', async () => {
  const repo = await import('./discussion.repository.js');
  const { threadId } = await repo.insertThread({
    projectId: 1,
    taskId: 1,
    title: 'Task-specific question',
    commentKind: 'General',
    creatorUserId: 1,
    body: 'Any blockers here?',
    mentionUserIds: [],
    attachments: []
  });

  const row = await repo.findThreadById(threadId);
  assert.ok(row);
  assert.equal(row!.threadtype, 'Task');
  assert.equal(row!.taskid, 1);
  // CK_DiscussionThreads_OneParent (the real schema's constraint) allows only TaskId to be set
  // for a task-scoped thread — effectiveprojectid must still resolve to the task's own project
  // via the join, exactly like production reads.
  assert.equal(row!.effectiveprojectid, 1);
});

test('findThreadsForProjects: only returns threads whose effective project id is in the given set', async () => {
  const repo = await import('./discussion.repository.js');
  await repo.insertThread({
    projectId: 1, title: 'In project 1', commentKind: 'General', creatorUserId: 1,
    body: 'hello', mentionUserIds: [], attachments: []
  });
  await repo.insertThread({
    projectId: 2, title: 'In project 2', commentKind: 'General', creatorUserId: 1,
    body: 'hello', mentionUserIds: [], attachments: []
  });

  const onlyProject1 = await repo.findThreadsForProjects([1]);
  assert.equal(onlyProject1.length, 1);
  assert.equal(onlyProject1[0].effectiveprojectid, 1);

  const both = await repo.findThreadsForProjects([1, 2]);
  assert.equal(both.length, 2);

  assert.deepEqual(await repo.findThreadsForProjects([]), []);
});

test('insertComment: adds a one-level reply and preserves comment order', async () => {
  const repo = await import('./discussion.repository.js');
  const { threadId, commentId: openingId } = await repo.insertThread({
    projectId: 1, title: 'Thread with replies', commentKind: 'General', creatorUserId: 1,
    body: 'Opening message.', mentionUserIds: [], attachments: []
  });

  const replyId = await repo.insertComment({
    threadId, parentCommentId: openingId, authorUserId: 2, body: 'A reply.',
    mentionUserIds: [], attachments: []
  });

  const comments = await repo.findCommentsForThreads([threadId]);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].commentid, openingId);
  assert.equal(comments[1].commentid, replyId);
  assert.equal(comments[1].parentcommentid, openingId);
  assert.equal(comments[1].authoruserid, 2);
});

test('updateCommentText: sets EditedAtUtc alongside the new text', async () => {
  const repo = await import('./discussion.repository.js');
  const { commentId } = await repo.insertThread({
    projectId: 1, title: 'Editable thread', commentKind: 'General', creatorUserId: 1,
    body: 'Original text.', mentionUserIds: [], attachments: []
  });

  let comment = await repo.findCommentById(commentId);
  assert.equal(comment!.editedatutc, null);

  await repo.updateCommentText(commentId, 'Edited text.');
  comment = await repo.findCommentById(commentId);
  assert.equal(comment!.commenttext, 'Edited text.');
  assert.ok(comment!.editedatutc, 'EditedAtUtc should be set after an edit');
});

test('softDeleteComment: sets DeletedAtUtc without violating the non-empty text constraint', async () => {
  const repo = await import('./discussion.repository.js');
  const { commentId } = await repo.insertThread({
    projectId: 1, title: 'Deletable thread', commentKind: 'General', creatorUserId: 1,
    body: 'Will be deleted.', mentionUserIds: [], attachments: []
  });

  await repo.softDeleteComment(commentId);
  const comment = await repo.findCommentById(commentId);
  assert.ok(comment!.deletedatutc, 'DeletedAtUtc should be set');
  assert.ok(comment!.commenttext.length > 0, 'CommentText must stay non-empty (CK_Comments_Text)');
});

