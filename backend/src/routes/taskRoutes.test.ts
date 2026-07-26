import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';

const jwtSecret = 'task-route-test-secret-that-is-longer-than-32-characters';
const taskDbPath = path.join(
  os.tmpdir(),
  `worksync-task-routes-${process.pid}-${Date.now()}.json`
);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = jwtSecret;
process.env.TASK_DB_PATH = taskDbPath;

let server: Server;
let baseUrl: string;

const tokenFor = (id: string, role: string) =>
  jwt.sign({ id, email: `${id}@codoc.com`, role }, jwtSecret, {
    expiresIn: '5m'
  });

const request = (
  pathname: string,
  token?: string,
  init: RequestInit = {}
) => fetch(`${baseUrl}${pathname}`, {
  ...init,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers
  }
});

before(async () => {
  const { default: app } = await import('../server.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (fs.existsSync(taskDbPath)) fs.unlinkSync(taskDbPath);
});

test('GET /api/tasks requires authentication', async () => {
  const response = await request('/api/tasks');
  assert.equal(response.status, 401);
});

test('GET /api/tasks returns tasks visible to the authenticated user', async () => {
  const response = await request('/api/tasks', tokenFor('usr-1', 'Admin'));
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.ok(Array.isArray(payload.data));
  assert.ok(payload.data.length >= 8);
});

test('POST /api/tasks validates input and creates an authoritative task', async () => {
  const token = tokenFor('usr-2', 'Team_Lead');
  const invalidResponse = await request('/api/tasks', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const invalidPayload = await invalidResponse.json();

  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidPayload.success, false);
  assert.equal(invalidPayload.fieldErrors.projectId, 'Select a project.');

  const createResponse = await request('/api/tasks', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'prj-1',
      title: 'Backend-connected task creation',
      description: 'Verify that the task API validates and persists new tasks.',
      priority: 'Critical',
      startDate: '2026-07-28',
      dueDate: '2026-08-01',
      assigneeIds: ['usr-4'],
      status: 'Todo'
    })
  });
  const createPayload = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.equal(createPayload.success, true);
  assert.equal(createPayload.data.priority, 'Urgent');
  assert.equal(createPayload.data.taskNumber, 'NX-23');
  assert.deepEqual(createPayload.data.assigneeIds, ['usr-4']);

  const listResponse = await request('/api/tasks', token);
  const listPayload = await listResponse.json();
  assert.ok(listPayload.data.some((task: { id: string }) =>
    task.id === createPayload.data.id
  ));
});

test('POST /api/tasks rejects users without task-creation permission', async () => {
  const response = await request(
    '/api/tasks',
    tokenFor('usr-1', 'Admin'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj-1',
        title: 'Unauthorized task',
        description: 'An admin can view tasks but must not create them directly.',
        priority: 'Medium',
        startDate: '2026-07-28',
        dueDate: '2026-08-01',
        assigneeIds: ['usr-4'],
        status: 'Todo'
      })
    }
  );

  assert.equal(response.status, 403);
});

test('POST /api/tasks allows a Team Lead within project scope', async () => {
  const response = await request(
    '/api/tasks',
    tokenFor('usr-2', 'Team_Lead'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj-1',
        title: 'Team Lead task',
        description: 'A scoped Team Lead can create a task for an active project.',
        priority: 'High',
        startDate: '2026-07-28',
        dueDate: '2026-08-01',
        assigneeIds: ['usr-4'],
        status: 'Todo'
      })
    }
  );

  assert.equal(response.status, 201);
});

test('POST /api/tasks rejects start dates before today', async () => {
  const response = await request(
    '/api/tasks',
    tokenFor('usr-2', 'Team_Lead'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'prj-1',
        title: 'Past task',
        description: 'Start dates must not be in the past.',
        priority: 'Medium',
        startDate: '2026-07-26',
        dueDate: '2026-08-01',
        assigneeIds: ['usr-4'],
        status: 'Todo'
      })
    }
  );
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.ok(payload.fieldErrors.startDate);
});

test('PATCH and DELETE /api/tasks/:taskId allow a scoped Team Lead', async () => {
  const token = tokenFor('usr-2', 'Team_Lead');
  const createResponse = await request('/api/tasks', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: 'prj-1',
      title: 'Editable task',
      description: 'This task will be edited and deleted by a Team Lead.',
      priority: 'Medium',
      startDate: '2026-07-28',
      dueDate: '2026-08-01',
      assigneeIds: ['usr-4'],
      status: 'Todo'
    })
  });
  const created = await createResponse.json();

  const patchResponse = await request(`/api/tasks/${created.data.id}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Edited task',
      description: 'Updated from the API.',
      priority: 'High',
      startDate: '2026-07-28',
      dueDate: '2026-08-02',
      assigneeIds: ['usr-4'],
      status: 'In Progress'
    })
  });
  const patched = await patchResponse.json();

  assert.equal(patchResponse.status, 200);
  assert.equal(patched.data.title, 'Edited task');
  assert.equal(patched.data.status, 'In Progress');

  const deleteResponse = await request(`/api/tasks/${created.data.id}`, token, {
    method: 'DELETE'
  });

  assert.equal(deleteResponse.status, 200);
});
