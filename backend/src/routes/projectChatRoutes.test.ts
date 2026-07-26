import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

const jwtSecret = 'project-chat-route-test-secret-that-is-longer-than-32-characters';
const discussionDbPath = path.join(os.tmpdir(), `worksync-project-chats-${process.pid}-${Date.now()}.json`);
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = jwtSecret;
process.env.PROJECT_CHAT_DB_PATH = discussionDbPath;

let server: Server;
let baseUrl: string;
let threadId = '';
let commentId = '';
const token = jwt.sign({ id: 'usr-1', email: 'admin@codoc.com', role: 'Admin' }, jwtSecret, { expiresIn: '5m' });
const memberToken = jwt.sign({ id: 'usr-4', email: 'member@codoc.com', role: 'Team_Member' }, jwtSecret, { expiresIn: '5m' });
const request = (pathname: string, auth = token, init: RequestInit = {}) => fetch(`${baseUrl}${pathname}`, { ...init, headers: { Authorization: `Bearer ${auth}`, ...init.headers } });

before(async () => {
  const { default: app } = await import('../server.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (fs.existsSync(discussionDbPath)) fs.unlinkSync(discussionDbPath);
});

test('creates a project discussion and rejects a task from another project', async () => {
  const invalid = await request('/api/project-chats', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'prj-1', taskId: 'tsk-103', title: 'Bad context', type: 'General', body: 'This task does not belong to the project.' }) });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).fieldErrors.taskId, /belong/);

  const response = await request('/api/project-chats', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: 'prj-1', taskId: 'tsk-101', title: 'Release readiness', type: 'Decision', body: 'Please confirm the release criteria.', mentionIds: ['usr-4', 'usr-4'] }) });
  const payload = await response.json();
  assert.equal(response.status, 201);
  threadId = payload.data.id;
  assert.deepEqual(payload.data.comments[0].mentionIds, ['usr-4']);
});

test('rejects empty replies and creates a one-level reply', async () => {
  const blank = await request(`/api/project-chats/${threadId}/comments`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: '   ' }) });
  assert.equal(blank.status, 400);
  const response = await request(`/api/project-chats/${threadId}/comments`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'The checklist is ready.', parentCommentId: undefined, mentionIds: ['usr-4'] }) });
  const payload = await response.json();
  assert.equal(response.status, 201);
  commentId = payload.data.id;
  assert.deepEqual(payload.data.mentionIds, ['usr-4']);
});

test('enforces comment ownership and soft-deletes an owned comment', async () => {
  const forbidden = await request(`/api/project-chats/comments/${commentId}`, memberToken, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'Attempted edit.' }) });
  assert.equal(forbidden.status, 403);
  const deleted = await request(`/api/project-chats/comments/${commentId}`, token, { method: 'DELETE' });
  const payload = await deleted.json();
  assert.equal(deleted.status, 200);
  assert.ok(payload.data.deletedAt);
});

test('resolves and reopens a discussion for an administrator', async () => {
  const resolved = await request(`/api/project-chats/${threadId}/resolution`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: true }) });
  assert.equal((await resolved.json()).data.resolved, true);
  const reopened = await request(`/api/project-chats/${threadId}/resolution`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved: false }) });
  assert.equal((await reopened.json()).data.resolved, false);
});
