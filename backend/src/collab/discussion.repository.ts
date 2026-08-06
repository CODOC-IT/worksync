import { query, withTransaction } from '../db/pool.js';
import {
  AddCommentInput,
  ChatAttachmentInput,
  CommentFileRow,
  CommentKindCode,
  CommentMentionRow,
  CommentRow,
  CreateThreadInput,
  ProjectMentionableUserRow,
  DiscussionThreadRow
} from './discussion.types.js';
import { parseAttachmentDataUrl, writeAttachmentToDisk } from './fileStorage.js';

// Repository = data access only (Repository Pattern, matching project.repository.ts /
// task.repository.ts). No recipient resolution, no authorization decisions here — those belong
// to discussion.service.ts. Reads/writes collab.DiscussionThreads/Comments/CommentMentions/
// StoredFiles/CommentFiles (database/05_collab_tables.sql), unmodified.

const ORGANIZATION_ID = 1;

// collab.DiscussionThreads.CK_DiscussionThreads_OneParent allows exactly one parent column, so a
// task-scoped thread stores TaskId only (ProjectId NULL) — the frontend's always-present
// `projectId` field is derived here via a join back to the task's own project, never stored
// redundantly.
const THREAD_COLUMNS = `
  dt.threadid, dt.threadtype, dt.subject, COALESCE(dt.projectid, t.projectid) AS effectiveprojectid,
  p.projectname, dt.taskid, t.title AS tasktitle, dt.createdbyuserid, dt.createdatutc
`;
const THREAD_JOINS = `
  FROM collab.discussionthreads dt
  LEFT JOIN work.tasks t ON t.taskid = dt.taskid
  JOIN work.projects p ON p.projectid = COALESCE(dt.projectid, t.projectid)
`;

export const findThreadsForProjects = async (projectIds: number[]): Promise<DiscussionThreadRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<DiscussionThreadRow>(
    `SELECT ${THREAD_COLUMNS} ${THREAD_JOINS}
     WHERE COALESCE(dt.projectid, t.projectid) = ANY($1::int[])
     ORDER BY dt.threadid`,
    [projectIds]
  );
  return result.rows;
};

export const findThreadById = async (threadId: number): Promise<DiscussionThreadRow | null> => {
  const result = await query<DiscussionThreadRow>(
    `SELECT ${THREAD_COLUMNS} ${THREAD_JOINS} WHERE dt.threadid = $1`,
    [threadId]
  );
  return result.rows[0] || null;
};

// The server-authoritative mention directory for each project. A user is eligible when they are
// active and either have a live ProjectMembers row (any project role), own the project, or hold
// an active Admin/HR role. Team members and Team Leads from unrelated projects are deliberately
// excluded, even if the client submits their ids directly.
export const findMentionableUsersForProjects = async (
  projectIds: number[]
): Promise<ProjectMentionableUserRow[]> => {
  if (projectIds.length === 0) return [];
  const result = await query<ProjectMentionableUserRow>(
    `SELECT DISTINCT eligible.projectid, eligible.userid
     FROM (
       SELECT pm.projectid, u.userid
       FROM work.projectmembers pm
       JOIN iam.users u ON u.userid = pm.userid
       WHERE pm.projectid = ANY($1::int[])
         AND pm.leftatutc IS NULL
         AND u.organizationid = $2
         AND u.accountstatus = 'Active'
         AND u.deactivatedatutc IS NULL

       UNION

       SELECT p.projectid, u.userid
       FROM work.projects p
       JOIN iam.users u ON u.userid = p.owneruserid
       WHERE p.projectid = ANY($1::int[])
         AND u.organizationid = $2
         AND u.accountstatus = 'Active'
         AND u.deactivatedatutc IS NULL

       UNION

       SELECT p.projectid, u.userid
       FROM iam.userroles ur
       JOIN iam.roles r ON r.roleid = ur.roleid
       JOIN iam.users u ON u.userid = ur.userid
       JOIN work.projects p ON p.projectid = ANY($1::int[])
       WHERE r.rolecode IN ('Administrator', 'HRRepresentative')
         AND ur.startsatutc <= now()
         AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
         AND ur.revokedatutc IS NULL
         AND u.organizationid = $2
         AND u.accountstatus = 'Active'
         AND u.deactivatedatutc IS NULL
     ) eligible
     ORDER BY eligible.projectid, eligible.userid`,
    [projectIds, ORGANIZATION_ID]
  );
  return result.rows;
};

// Task-scoped discussions are intentionally narrower than project discussions: only current
// assignees, the project's functional lead, and active HR/Admin accounts may participate.
export const findMentionableUsersForTask = async (
  taskId: number,
  projectId: number
): Promise<ProjectMentionableUserRow[]> => {
  const result = await query<ProjectMentionableUserRow>(
    `SELECT DISTINCT $2::int AS projectid, eligible.userid
     FROM (
       SELECT ta.userid
       FROM work.taskassignees ta
       JOIN iam.users u ON u.userid = ta.userid
       WHERE ta.taskid = $1 AND ta.unassignedatutc IS NULL
         AND u.organizationid = $3 AND u.accountstatus = 'Active' AND u.deactivatedatutc IS NULL
       UNION
       SELECT COALESCE(
         (SELECT pm.userid FROM work.projectmembers pm WHERE pm.projectid = $2 AND pm.memberrolecode = 'TeamLead' AND pm.leftatutc IS NULL LIMIT 1),
         p.owneruserid
       )
       FROM work.projects p WHERE p.projectid = $2
       UNION
       SELECT ur.userid
       FROM iam.userroles ur
       JOIN iam.roles r ON r.roleid = ur.roleid
       JOIN iam.users u ON u.userid = ur.userid
       WHERE r.rolecode IN ('Administrator', 'HRRepresentative')
         AND ur.startsatutc <= now() AND (ur.endsatutc IS NULL OR ur.endsatutc > now()) AND ur.revokedatutc IS NULL
         AND u.organizationid = $3 AND u.accountstatus = 'Active' AND u.deactivatedatutc IS NULL
     ) eligible`,
    [taskId, projectId, ORGANIZATION_ID]
  );
  return result.rows;
};

export const findCommentsForThreads = async (threadIds: number[]): Promise<CommentRow[]> => {
  if (threadIds.length === 0) return [];
  const result = await query<CommentRow>(
    `SELECT commentid, threadid, parentcommentid, authoruserid, commentkind, commenttext,
            createdatutc, editedatutc, deletedatutc
     FROM collab.comments
     WHERE threadid = ANY($1::bigint[])
     ORDER BY commentid`,
    [threadIds]
  );
  return result.rows;
};

export const findCommentById = async (commentId: number): Promise<CommentRow | null> => {
  const result = await query<CommentRow>(
    `SELECT commentid, threadid, parentcommentid, authoruserid, commentkind, commenttext,
            createdatutc, editedatutc, deletedatutc
     FROM collab.comments WHERE commentid = $1`,
    [commentId]
  );
  return result.rows[0] || null;
};

export const findMentionsForComments = async (commentIds: number[]): Promise<CommentMentionRow[]> => {
  if (commentIds.length === 0) return [];
  const result = await query<CommentMentionRow>(
    `SELECT commentid, mentioneduserid FROM collab.commentmentions WHERE commentid = ANY($1::bigint[])`,
    [commentIds]
  );
  return result.rows;
};

export const findAttachmentsForComments = async (commentIds: number[]): Promise<CommentFileRow[]> => {
  if (commentIds.length === 0) return [];
  const result = await query<CommentFileRow>(
    `SELECT cf.commentid, sf.fileid, sf.originalfilename, sf.mimetype, sf.sizebytes::text AS sizebytes,
            sf.storageobjectkey
     FROM collab.commentfiles cf
     JOIN collab.storedfiles sf ON sf.fileid = cf.fileid
     WHERE cf.commentid = ANY($1::bigint[])
     ORDER BY sf.fileid`,
    [commentIds]
  );
  return result.rows;
};

// Content-addressed upsert: identical bytes (same sha256) reuse the same StoredFiles row rather
// than duplicating storage — "DO UPDATE SET x = EXCLUDED.x" is a standard no-op upsert trick to
// make Postgres RETURNING the existing row on a conflict (plain DO NOTHING returns nothing).
const upsertStoredFile = async (
  runQuery: typeof query,
  uploadedByUserId: number,
  attachment: ChatAttachmentInput
): Promise<number> => {
  const parsed = attachment.url ? parseAttachmentDataUrl(attachment.url) : null;
  if (!parsed) {
    throw new Error(`Attachment "${attachment.name}" has no readable content to store.`);
  }
  const written = await writeAttachmentToDisk(parsed.buffer, parsed.mimeType);
  const extension = attachment.name.includes('.') ? attachment.name.split('.').pop()! : null;

  // ScanStatus stays 'Pending' — this app has no virus-scanning pipeline, and claiming 'Clean'
  // without ever having scanned anything would be its own kind of fake data.
  const result = await runQuery<{ fileid: number }>(
    `INSERT INTO collab.storedfiles
       (organizationid, uploadedbyuserid, originalfilename, storageobjectkey, mimetype, fileextension,
        sizebytes, sha256hash, scanstatus)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Pending')
     ON CONFLICT (storageobjectkey) DO UPDATE SET storageobjectkey = EXCLUDED.storageobjectkey
     RETURNING fileid`,
    [
      ORGANIZATION_ID,
      uploadedByUserId,
      attachment.name,
      written.storageObjectKey,
      attachment.mimeType,
      extension,
      written.sizeBytes,
      Buffer.from(written.sha256Hex, 'hex')
    ]
  );
  return result.rows[0].fileid;
};

const linkCommentFiles = async (
  runQuery: typeof query,
  commentId: number,
  uploadedByUserId: number,
  attachments: ChatAttachmentInput[]
): Promise<void> => {
  for (const attachment of attachments) {
    const fileId = await upsertStoredFile(runQuery, uploadedByUserId, attachment);
    await runQuery(
      `INSERT INTO collab.commentfiles (commentid, fileid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [commentId, fileId]
    );
  }
};

const insertMentions = async (runQuery: typeof query, commentId: number, mentionUserIds: number[]): Promise<void> => {
  for (const userId of Array.from(new Set(mentionUserIds))) {
    await runQuery(
      `INSERT INTO collab.commentmentions (commentid, mentioneduserid) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [commentId, userId]
    );
  }
};

export interface InsertThreadRow {
  projectId: number;
  taskId?: number;
  title: string;
  commentKind: CommentKindCode;
  creatorUserId: number;
  body: string;
  mentionUserIds: number[];
  attachments: ChatAttachmentInput[];
}

// Thread + its opening comment (+ mentions/attachments) are created atomically — a thread with
// no opening message would violate the app's own contract that every discussion starts with one.
export const insertThread = async (input: InsertThreadRow): Promise<{ threadId: number; commentId: number }> =>
  withTransaction(async (runQuery) => {
    const threadType = input.taskId ? 'Task' : 'Project';
    const threadResult = await runQuery<{ threadid: number }>(
      `INSERT INTO collab.discussionthreads (organizationid, threadtype, subject, projectid, taskid, createdbyuserid)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING threadid`,
      [
        ORGANIZATION_ID,
        threadType,
        input.title,
        threadType === 'Project' ? input.projectId : null,
        threadType === 'Task' ? input.taskId : null,
        input.creatorUserId
      ]
    );
    const threadId = threadResult.rows[0].threadid;

    const commentResult = await runQuery<{ commentid: number }>(
      `INSERT INTO collab.comments (threadid, authoruserid, commentkind, commenttext)
       VALUES ($1, $2, $3, $4)
       RETURNING commentid`,
      [threadId, input.creatorUserId, input.commentKind, input.body]
    );
    const commentId = commentResult.rows[0].commentid;

    await insertMentions(runQuery, commentId, input.mentionUserIds);
    await linkCommentFiles(runQuery, commentId, input.creatorUserId, input.attachments);

    return { threadId, commentId };
  });

export interface InsertCommentRow {
  threadId: number;
  parentCommentId?: number;
  authorUserId: number;
  body: string;
  mentionUserIds: number[];
  attachments: ChatAttachmentInput[];
}

export const insertComment = async (input: InsertCommentRow): Promise<number> =>
  withTransaction(async (runQuery) => {
    const commentResult = await runQuery<{ commentid: number }>(
      `INSERT INTO collab.comments (threadid, parentcommentid, authoruserid, commentkind, commenttext)
       VALUES ($1, $2, $3, 'General', $4)
       RETURNING commentid`,
      [input.threadId, input.parentCommentId || null, input.authorUserId, input.body]
    );
    const commentId = commentResult.rows[0].commentid;

    await insertMentions(runQuery, commentId, input.mentionUserIds);
    await linkCommentFiles(runQuery, commentId, input.authorUserId, input.attachments);

    return commentId;
  });

export const updateCommentText = async (commentId: number, body: string): Promise<void> => {
  await query(
    `UPDATE collab.comments
     SET commenttext = $1, editedatutc = CURRENT_TIMESTAMP, rowversion = rowversion + 1
     WHERE commentid = $2`,
    [body, commentId]
  );
};

// Soft-delete — collab.Comments has DeletedAtUtc for exactly this, matching the same
// "never a hard DELETE" pattern as Projects/Tasks/Notifications.
export const softDeleteComment = async (commentId: number): Promise<void> => {
  await query(
    `UPDATE collab.comments
     SET deletedatutc = CURRENT_TIMESTAMP, commenttext = '[deleted]', rowversion = rowversion + 1
     WHERE commentid = $1`,
    [commentId]
  );
};

