import assert from 'node:assert/strict';
import test from 'node:test';
import { promptStore } from '../store/promptStore.js';
import { projectStore } from '../store/projectStore.js';

// ─── Prompt Store Tests ────────────────────────────────────────

test('promptStore: creates a new prompt with version 1', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-1',
    projectId: 'prj-1',
    taskId: null,
    category: 'CodeReview',
    title: 'Test Code Review Prompt',
    style: 'Default',
    additionalInstructions: null,
    content: 'Act as a senior engineer and review...',
    isAiGenerated: true,
  });

  assert.ok(prompt.id, 'Prompt ID should be generated');
  assert.equal(prompt.userId, 'usr-1');
  assert.equal(prompt.category, 'CodeReview');
  assert.equal(prompt.versions.length, 1);
  assert.equal(prompt.versions[0].versionNumber, 1);
  assert.equal(prompt.versions[0].isAiGenerated, true);
  assert.equal(prompt.versions[0].content, 'Act as a senior engineer and review...');
  assert.equal(prompt.isArchived, false);
});

test('promptStore: updating prompt creates a new version', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-2',
    projectId: null,
    taskId: null,
    category: 'TaskDescription',
    title: 'Task Description Prompt',
    style: 'Technical',
    additionalInstructions: null,
    content: 'Original content',
    isAiGenerated: true,
  });

  const updated = promptStore.updatePrompt(prompt.id, 'usr-2', {
    content: 'Edited content',
    title: 'Updated Title',
  });

  assert.ok(updated, 'Prompt should be updated');
  assert.equal(updated!.versions.length, 2);
  assert.equal(updated!.versions[1].versionNumber, 2);
  assert.equal(updated!.versions[1].content, 'Edited content');
  assert.equal(updated!.versions[1].isAiGenerated, false);
  assert.equal(updated!.title, 'Updated Title');

  // Previous version unchanged
  assert.equal(updated!.versions[0].content, 'Original content');
});

test('promptStore: updating another user\'s prompt returns null', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-1',
    projectId: null,
    taskId: null,
    category: 'Documentation',
    title: 'Doc Prompt',
    style: 'Default',
    additionalInstructions: null,
    content: 'Doc content',
    isAiGenerated: true,
  });

  const result = promptStore.updatePrompt(prompt.id, 'usr-3', { content: 'Hacked content' });
  assert.equal(result, null, 'Should not allow updating another user\'s prompt');
});

test('promptStore: restore version creates a new version with restored content', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-1',
    projectId: null,
    taskId: null,
    category: 'TestCases',
    title: 'Test Cases Prompt',
    style: 'Default',
    additionalInstructions: null,
    content: 'Version 1 content',
    isAiGenerated: true,
  });

  // Create version 2
  promptStore.updatePrompt(prompt.id, 'usr-1', { content: 'Version 2 content' });

  // Restore version 1
  const restored = promptStore.restoreVersion(prompt.id, prompt.versions[0].versionId, 'usr-1');
  assert.ok(restored, 'Should restore version');
  assert.equal(restored!.versions.length, 3);
  assert.equal(restored!.versions[2].versionNumber, 3);
  assert.equal(restored!.versions[2].content, 'Version 1 content');
});

test('promptStore: archive prompt marks it as archived', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-1',
    projectId: null,
    taskId: null,
    category: 'ProjectBreakdown',
    title: 'Breakdown',
    style: 'Default',
    additionalInstructions: null,
    content: 'Breakdown content',
    isAiGenerated: true,
  });

  const result = promptStore.archivePrompt(prompt.id, 'usr-1');
  assert.equal(result, true);

  const archived = promptStore.getPromptById(prompt.id);
  assert.equal(archived?.isArchived, true);
});

test('promptStore: archive another user\'s prompt returns false', () => {
  const prompt = promptStore.createPrompt({
    userId: 'usr-1',
    projectId: null,
    taskId: null,
    category: 'ProjectBreakdown',
    title: 'Breakdown 2',
    style: 'Default',
    additionalInstructions: null,
    content: 'Content',
    isAiGenerated: true,
  });

  const result = promptStore.archivePrompt(prompt.id, 'usr-4');
  assert.equal(result, false);
});

test('promptStore: getPromptsForUser returns only that user\'s prompts', () => {
  const user1Prompts = promptStore.getPromptsForUser('usr-1');
  const user2Prompts = promptStore.getPromptsForUser('usr-2');

  // All prompts created for usr-1 should be returned
  const allUser1 = user1Prompts.every((p) => p.userId === 'usr-1');
  assert.equal(allUser1, true);

  // All prompts created for usr-2 should be returned
  const allUser2 = user2Prompts.every((p) => p.userId === 'usr-2');
  assert.equal(allUser2, true);
});

// ─── Project Store Tests ────────────────────────────────────────

test('projectStore: Admin sees all projects', () => {
  const projects = projectStore.getProjectsForUser('usr-1', 'Admin');
  assert.equal(projects.length, 6, 'Admin should see all 6 projects');
});

test('projectStore: Team_Member sees only their projects', () => {
  const projects = projectStore.getProjectsForUser('usr-4', 'Team_Member');
  // usr-4 is in prj-1, prj-2, prj-3, prj-6
  const accessible = projects.every((p) => p.memberIds.includes('usr-4'));
  assert.equal(accessible, true, 'All returned projects should include the user');
});

test('projectStore: user without membership can\'t access project', () => {
  const accessible = projectStore.isProjectAccessible('prj-3', 'usr-5', 'Team_Member');
  // usr-5 is not in prj-3
  assert.equal(accessible, false);
});

test('projectStore: Admin can access any project', () => {
  const accessible = projectStore.isProjectAccessible('prj-3', 'usr-1', 'Admin');
  assert.equal(accessible, true);
});

test('projectStore: getTasksForProject returns only authorized tasks', () => {
  const tasks = projectStore.getTasksForProject('prj-1', 'usr-4', 'Team_Member');
  assert.ok(tasks.length > 0, 'Should return tasks for authorized project');
  assert.equal(tasks.every((t) => t.projectId === 'prj-1'), true);
});

test('projectStore: getTasksForProject returns empty for unauthorized', () => {
  // usr-5 is not in prj-3
  const tasks = projectStore.getTasksForProject('prj-3', 'usr-5', 'Team_Member');
  assert.equal(tasks.length, 0, 'Should return empty for unauthorized access');
});

test('projectStore: isTaskAccessible checks project access', () => {
  // tsk-104 is in prj-3, usr-5 is not in prj-3
  const accessible = projectStore.isTaskAccessible('tsk-104', 'usr-5', 'Team_Member');
  assert.equal(accessible, false);
});
