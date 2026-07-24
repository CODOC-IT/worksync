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

class PromptStore {
  private prompts: Map<string, SavedPromptRecord> = new Map();

  createPrompt(data: {
    userId: string;
    projectId: string | null;
    taskId: string | null;
    category: string;
    title: string;
    style: string;
    additionalInstructions: string | null;
    content: string;
    isAiGenerated: boolean;
  }): SavedPromptRecord {
    // Reject duplicate content for the same user
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

  getPromptById(promptId: string): SavedPromptRecord | undefined {
    return this.prompts.get(promptId);
  }

  getPromptsForUser(userId: string, includeArchived = false): SavedPromptRecord[] {
    return Array.from(this.prompts.values()).filter(
      (p) => p.userId === userId && (includeArchived || !p.isArchived)
    );
  }

  updatePrompt(
    promptId: string,
    userId: string,
    data: { content: string; title?: string }
  ): SavedPromptRecord | null {
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

  restoreVersion(promptId: string, versionId: string, userId: string): SavedPromptRecord | null {
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

  archivePrompt(promptId: string, userId: string): boolean {
    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    prompt.isArchived = true;
    prompt.updatedAtUtc = new Date().toISOString();
    this.prompts.set(promptId, prompt);
    return true;
  }

  unarchivePrompt(promptId: string, userId: string): boolean {
    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    prompt.isArchived = false;
    prompt.updatedAtUtc = new Date().toISOString();
    this.prompts.set(promptId, prompt);
    return true;
  }

  deletePromptPermanently(promptId: string, userId: string): boolean {
    const prompt = this.prompts.get(promptId);
    if (!prompt || prompt.userId !== userId) return false;
    this.prompts.delete(promptId);
    return true;
  }
}

export const promptStore = new PromptStore();
