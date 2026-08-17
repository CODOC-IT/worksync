import { isDatabaseConfigured, query, withTransaction } from '../db/pool.js';
import {
  fromPromptPk,
  fromProjectPk,
  fromPromptVersionPk,
  fromTaskPk,
  fromUserPk,
  toProjectPkOrNull,
  toPromptPk,
  toPromptVersionPk,
  toTaskPkOrNull,
  toUserPk,
} from '../utils/idMapping.js';

export interface PromptVersion {
  versionId: string;
  versionNumber: number;
  content: string;
  isAiGenerated: boolean;
  createdByUserId: string;
  createdAtUtc: string;
}

export interface SavedPromptRecord {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  category: string;
  title: string;
  style: string;
  additionalInstructions: string | null;
  isArchived: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  versions: PromptVersion[];
}

interface PromptLibraryRow {
  promptlibraryid: number;
  userid: number;
  projectid: number | null;
  taskid: number | null;
  categorycode: string;
  title: string;
  stylecode: string;
  additionalinstructions: string | null;
  isarchived: boolean;
  createdatutc: string | Date;
  updatedatutc: string | Date;
}

interface PromptVersionRow {
  promptversionid: number;
  promptlibraryid: number;
  versionnumber: number;
  content: string;
  isaigenerated: boolean;
  createdbyuserid: number;
  createdatutc: string | Date;
}

const rowToVersion = (row: PromptVersionRow): PromptVersion => ({
  versionId: fromPromptVersionPk(row.promptversionid),
  versionNumber: row.versionnumber,
  content: row.content,
  isAiGenerated: row.isaigenerated,
  createdByUserId: fromUserPk(row.createdbyuserid),
  createdAtUtc: new Date(row.createdatutc).toISOString(),
});

const rowToPrompt = (row: PromptLibraryRow, versionRows: PromptVersionRow[]): SavedPromptRecord => ({
  id: fromPromptPk(row.promptlibraryid),
  userId: fromUserPk(row.userid),
  projectId: row.projectid !== null ? fromProjectPk(row.projectid) : null,
  taskId: row.taskid !== null ? fromTaskPk(row.taskid) : null,
  category: row.categorycode,
  title: row.title,
  style: row.stylecode,
  additionalInstructions: row.additionalinstructions,
  isArchived: row.isarchived,
  createdAtUtc: new Date(row.createdatutc).toISOString(),
  updatedAtUtc: new Date(row.updatedatutc).toISOString(),
  versions: versionRows.map(rowToVersion),
});

// Saved prompts live in Postgres (ai.PromptLibraries / ai.PromptVersions, see
// database/09_ai_tables.sql) so they survive page reloads and backend restarts. When no
// database is configured (e.g. unit tests, or local dev before DATABASE_URL is set) the store
// degrades to the original in-memory Map so the assistant still works for the session.
class PromptStore {
  private prompts: Map<string, SavedPromptRecord> = new Map();
  private useDb: boolean;

  constructor() {
    this.useDb = process.env.NODE_ENV !== 'test' && isDatabaseConfigured();
  }

  async createPrompt(data: {
    userId: string;
    projectId: string | null;
    taskId: string | null;
    category: string;
    title: string;
    style: string;
    additionalInstructions: string | null;
    content: string;
    isAiGenerated: boolean;
  }): Promise<SavedPromptRecord> {
    if (this.useDb) {
      const userIdPk = toUserPk(data.userId);
      const duplicate = await query<{ promptlibraryid: number }>(
        `SELECT pl.PromptLibraryId
         FROM ai.PromptLibraries pl
         JOIN LATERAL (
           SELECT pv.Content
           FROM ai.PromptVersions pv
           WHERE pv.PromptLibraryId = pl.PromptLibraryId
           ORDER BY pv.VersionNumber DESC
           LIMIT 1
         ) latest ON TRUE
         WHERE pl.UserId = $1
           AND pl.IsArchived = FALSE
           AND latest.Content = $2
         LIMIT 1`,
        [userIdPk, data.content]
      );
      if (duplicate.rows[0]) {
        throw new Error('A prompt with this content already exists. Edit the content or delete the existing prompt first.');
      }

      const now = new Date();
      const libraryId = await withTransaction(async (runQuery) => {
        const inserted = await runQuery<{ promptlibraryid: number }>(
          `INSERT INTO ai.PromptLibraries
             (UserId, ProjectId, TaskId, CategoryCode, Title, StyleCode, AdditionalInstructions, IsArchived, CreatedAtUtc, UpdatedAtUtc)
           VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $8)
           RETURNING PromptLibraryId`,
          [
            userIdPk,
            toProjectPkOrNull(data.projectId),
            toTaskPkOrNull(data.taskId),
            data.category,
            data.title,
            data.style,
            data.additionalInstructions,
            now,
          ]
        );
        const newId = inserted.rows[0].promptlibraryid;
        await runQuery(
          `INSERT INTO ai.PromptVersions (PromptLibraryId, VersionNumber, Content, IsAiGenerated, CreatedByUserId, CreatedAtUtc)
           VALUES ($1, 1, $2, $3, $4, $5)`,
          [newId, data.content, data.isAiGenerated, userIdPk, now]
        );
        return newId;
      });

      const prompt = await this.getPromptById(fromPromptPk(libraryId));
      if (!prompt) throw new Error('Failed to save prompt.');
      return prompt;
    }

    const existing = Array.from(this.prompts.values()).find(
      (p) =>
        p.userId === data.userId &&
        !p.isArchived &&
        p.versions[p.versions.length - 1]?.content === data.content
    );
    if (existing) {
      throw new Error('A prompt with this content already exists. Edit the content or delete the existing prompt first.');
    }

    const id = `prompt-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date().toISOString();
    const prompt: SavedPromptRecord = {
      id,
      userId: data.userId,
      projectId: data.projectId,
      taskId: data.taskId,
      category: data.category,
      title: data.title,
      style: data.style,
      additionalInstructions: data.additionalInstructions,
      isArchived: false,
      createdAtUtc: now,
      updatedAtUtc: now,
      versions: [
        {
          versionId: `v-${now}-1`,
          versionNumber: 1,
          content: data.content,
          isAiGenerated: data.isAiGenerated,
          createdByUserId: data.userId,
          createdAtUtc: now,
        },
      ],
    };
    this.prompts.set(id, prompt);
    return prompt;
  }

  async getPromptById(promptId: string): Promise<SavedPromptRecord | undefined> {
    if (this.useDb) {
      const libraryResult = await query<PromptLibraryRow>(
        `SELECT * FROM ai.PromptLibraries WHERE PromptLibraryId = $1`,
        [toPromptPk(promptId)]
      );
      const row = libraryResult.rows[0];
      if (!row) return undefined;
      const versionResult = await query<PromptVersionRow>(
        `SELECT * FROM ai.PromptVersions WHERE PromptLibraryId = $1 ORDER BY VersionNumber`,
        [row.promptlibraryid]
      );
      return rowToPrompt(row, versionResult.rows);
    }
    return this.prompts.get(promptId);
  }

  async getPromptsForUser(userId: string, includeArchived = false): Promise<SavedPromptRecord[]> {
    if (this.useDb) {
      const userIdPk = toUserPk(userId);
      const libraryResult = await query<PromptLibraryRow>(
        `SELECT * FROM ai.PromptLibraries
         WHERE UserId = $1 AND (IsArchived = FALSE OR $2)
         ORDER BY UpdatedAtUtc DESC, PromptLibraryId DESC`,
        [userIdPk, includeArchived]
      );
      const rows = libraryResult.rows;
      let versionRows: PromptVersionRow[] = [];
      if (rows.length > 0) {
        const ids = rows.map((r) => r.promptlibraryid);
        const versionResult = await query<PromptVersionRow>(
          `SELECT * FROM ai.PromptVersions
           WHERE PromptLibraryId = ANY($1::bigint[])
           ORDER BY PromptLibraryId, VersionNumber`,
          [ids]
        );
        versionRows = versionResult.rows;
      }
      const grouped = new Map<number, PromptVersionRow[]>();
      for (const v of versionRows) {
        const list = grouped.get(v.promptlibraryid) || [];
        list.push(v);
        grouped.set(v.promptlibraryid, list);
      }
      return rows.map((r) => rowToPrompt(r, grouped.get(r.promptlibraryid) || []));
    }
    return Array.from(this.prompts.values()).filter(
      (p) => p.userId === userId && (includeArchived || !p.isArchived)
    );
  }

  async updatePrompt(
    promptId: string,
    userId: string,
    data: { content: string; title?: string }
  ): Promise<SavedPromptRecord | null> {
    if (this.useDb) {
      const libraryId = toPromptPk(promptId);
      const userIdPk = toUserPk(userId);
      const ownership = await query<{ promptlibraryid: number }>(
        `SELECT PromptLibraryId FROM ai.PromptLibraries WHERE PromptLibraryId = $1 AND UserId = $2`,
        [libraryId, userIdPk]
      );
      if (!ownership.rows[0]) return null;

      const versionResult = await query<{ versionnumber: number }>(
        `SELECT COALESCE(MAX(VersionNumber), 0) AS versionnumber FROM ai.PromptVersions WHERE PromptLibraryId = $1`,
        [libraryId]
      );
      const nextVersion = versionResult.rows[0].versionnumber + 1;
      const now = new Date();

      await withTransaction(async (runQuery) => {
        await runQuery(
          `INSERT INTO ai.PromptVersions (PromptLibraryId, VersionNumber, Content, IsAiGenerated, CreatedByUserId, CreatedAtUtc)
           VALUES ($1, $2, $3, FALSE, $4, $5)`,
          [libraryId, nextVersion, data.content, userIdPk, now]
        );
        await runQuery(
          `UPDATE ai.PromptLibraries SET Title = COALESCE($2, Title), UpdatedAtUtc = $3 WHERE PromptLibraryId = $1`,
          [libraryId, data.title || null, now]
        );
      });

      return (await this.getPromptById(promptId)) || null;
    }

    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return null;

    const now = new Date().toISOString();
    const lastVersionNumber = prompt.versions.length;

    prompt.versions.push({
      versionId: `v-${now}-${lastVersionNumber + 1}`,
      versionNumber: lastVersionNumber + 1,
      content: data.content,
      isAiGenerated: false,
      createdByUserId: userId,
      createdAtUtc: now,
    });

    if (data.title) {
      prompt.title = data.title;
    }
    prompt.updatedAtUtc = now;

    this.prompts.set(promptId, prompt);
    return prompt;
  }

  async restoreVersion(promptId: string, versionId: string, userId: string): Promise<SavedPromptRecord | null> {
    if (this.useDb) {
      const libraryId = toPromptPk(promptId);
      const userIdPk = toUserPk(userId);
      const ownership = await query<{ promptlibraryid: number }>(
        `SELECT PromptLibraryId FROM ai.PromptLibraries WHERE PromptLibraryId = $1 AND UserId = $2`,
        [libraryId, userIdPk]
      );
      if (!ownership.rows[0]) return null;

      const version = await query<{ content: string }>(
        `SELECT Content FROM ai.PromptVersions WHERE PromptVersionId = $1 AND PromptLibraryId = $2`,
        [toPromptVersionPk(versionId), libraryId]
      );
      if (!version.rows[0]) return null;

      const versionResult = await query<{ versionnumber: number }>(
        `SELECT COALESCE(MAX(VersionNumber), 0) AS versionnumber FROM ai.PromptVersions WHERE PromptLibraryId = $1`,
        [libraryId]
      );
      const nextVersion = versionResult.rows[0].versionnumber + 1;
      const now = new Date();

      await withTransaction(async (runQuery) => {
        await runQuery(
          `INSERT INTO ai.PromptVersions (PromptLibraryId, VersionNumber, Content, IsAiGenerated, CreatedByUserId, CreatedAtUtc)
           VALUES ($1, $2, $3, FALSE, $4, $5)`,
          [libraryId, nextVersion, version.rows[0].content, userIdPk, now]
        );
        await runQuery(
          `UPDATE ai.PromptLibraries SET UpdatedAtUtc = $2 WHERE PromptLibraryId = $1`,
          [libraryId, now]
        );
      });

      return (await this.getPromptById(promptId)) || null;
    }

    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return null;

    const version = prompt.versions.find((v) => v.versionId === versionId);
    if (!version) return null;

    const now = new Date().toISOString();
    const lastVersionNumber = prompt.versions.length;

    prompt.versions.push({
      versionId: `v-${now}-${lastVersionNumber + 1}`,
      versionNumber: lastVersionNumber + 1,
      content: version.content,
      isAiGenerated: false,
      createdByUserId: userId,
      createdAtUtc: now,
    });

    prompt.updatedAtUtc = now;
    this.prompts.set(promptId, prompt);
    return prompt;
  }

  async archivePrompt(promptId: string, userId: string): Promise<boolean> {
    if (this.useDb) {
      const result = await query(
        `UPDATE ai.PromptLibraries
         SET IsArchived = TRUE, UpdatedAtUtc = CURRENT_TIMESTAMP
         WHERE PromptLibraryId = $1 AND UserId = $2`,
        [toPromptPk(promptId), toUserPk(userId)]
      );
      return (result.rowCount ?? 0) > 0;
    }

    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    prompt.isArchived = true;
    prompt.updatedAtUtc = new Date().toISOString();
    this.prompts.set(promptId, prompt);
    return true;
  }

  async unarchivePrompt(promptId: string, userId: string): Promise<boolean> {
    if (this.useDb) {
      const result = await query(
        `UPDATE ai.PromptLibraries
         SET IsArchived = FALSE, UpdatedAtUtc = CURRENT_TIMESTAMP
         WHERE PromptLibraryId = $1 AND UserId = $2`,
        [toPromptPk(promptId), toUserPk(userId)]
      );
      return (result.rowCount ?? 0) > 0;
    }

    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    prompt.isArchived = false;
    prompt.updatedAtUtc = new Date().toISOString();
    this.prompts.set(promptId, prompt);
    return true;
  }

  async deletePromptPermanently(promptId: string, userId: string): Promise<boolean> {
    if (this.useDb) {
      const result = await query(
        `DELETE FROM ai.PromptLibraries WHERE PromptLibraryId = $1 AND UserId = $2`,
        [toPromptPk(promptId), toUserPk(userId)]
      );
      return (result.rowCount ?? 0) > 0;
    }

    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    this.prompts.delete(promptId);
    return true;
  }
}

export const promptStore = new PromptStore();
