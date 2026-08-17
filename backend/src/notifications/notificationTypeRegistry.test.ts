import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// A NotificationType has to be declared in five independent places before it can actually reach a
// user, and nothing but agreement between them makes it work:
//
//   1. backend NotificationType union      -- what a publisher is allowed to raise
//   2. database baseline seed scripts      -- what a FRESH database knows (setup.sql)
//   3. backend/src/db/pool.ts bootstrap    -- what an already-provisioned database gets on boot
//   4. frontend NotificationType union     -- what the client's types admit
//   5. frontend NOTIFICATION_TYPE_META     -- how it renders (icon/tone/label/priority)
//
// The multi-team release added seven types to (1) and to a migration only, leaving (2), (3), (4)
// and (5) behind. Neither compiler could see it: backend and frontend are deliberately separate
// TypeScript projects with duplicated unions (see notification.types.ts's header), and the DB
// scripts are not typed at all. The failure modes were silent and different in each place --
// publishEvent() *throws* on a TypeCode missing from the database, so every team event failed on a
// fresh install, while a type missing from (4)/(5) merely rendered as a grey "System" row.
//
// These tests are the check that was missing. They read the real files rather than importing them,
// because (2) and (3) are SQL/data rather than exported values.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

// Types that exist for historical rows only and are never published by current code. They are
// deliberately absent from the newer registries and must not fail these tests.
const LEGACY_ONLY = new Set(['attendance', 'task', 'system']);

const unionMembers = (source: string, startMarker: string): Set<string> => {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `could not locate "${startMarker}"`);
  // The union ends at the first semicolon after its start -- every member is a quoted literal.
  const end = source.indexOf(';', start);
  assert.notEqual(end, -1, `could not find the end of "${startMarker}"`);
  return new Set([...source.slice(start, end).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]));
};

const backendTypes = (): Set<string> =>
  unionMembers(read('backend/src/notifications/notification.types.ts'), 'export type NotificationType =');

const frontendTypes = (): Set<string> =>
  unionMembers(read('frontend/src/types/index.ts'), 'export type NotificationType =');

// Every TypeCode seeded by the numbered baseline scripts that setup.sql actually runs. Migrations
// are deliberately excluded: they only ever reach databases that already existed, so a type present
// only in a migration is exactly the fresh-install gap these tests exist to catch.
const baselineSeededTypes = (): Set<string> => {
  const setup = read('database/setup.sql');
  const scripts = [...setup.matchAll(/^\\ir (\d+_[a-z_]+\.sql)$/gm)].map((match) => match[1]);
  const seeded = new Set<string>();
  for (const script of scripts) {
    const source = read(`database/${script}`);
    // Only rows inserted into notify.NotificationTypes, not every quoted string in the file.
    for (const block of source.matchAll(/INSERT INTO notify\.NotificationTypes[\s\S]*?;/gi)) {
      for (const match of block[0].matchAll(/\(\s*'([a-z_]+)'\s*,\s*'(?:Task|Project|Approval|System|Attendance|Break|Report|Chat|AI)'/g)) {
        seeded.add(match[1]);
      }
    }
  }
  return seeded;
};

const bootstrapTypes = (): Set<string> => {
  const source = read('backend/src/db/pool.ts');
  const start = source.indexOf('const notificationTypes:');
  assert.notEqual(start, -1, 'could not locate pool.ts\'s notificationTypes bootstrap list');
  const end = source.indexOf('];', start);
  return new Set(
    [...source.slice(start, end).matchAll(/\['([a-z_]+)',\s*'(?:Task|Project|Approval|System|Attendance|Break|Report|Chat|AI)'/g)]
      .map((match) => match[1])
  );
};

const missing = (required: Set<string>, present: Set<string>): string[] =>
  [...required].filter((type) => !present.has(type)).sort();

test('every backend NotificationType is seeded by the numbered baseline scripts setup.sql runs', () => {
  const gaps = missing(backendTypes(), baselineSeededTypes());
  assert.deepEqual(
    gaps,
    [],
    'These types can be published but a freshly provisioned database has no row for them, so ' +
      'publishEvent() will throw "Unknown notification type" for each. Add them to a numbered ' +
      'database/*.sql seed script wired into setup.sql (a migration alone is not enough).'
  );
});

test('every backend NotificationType is in pool.ts\'s self-provisioning bootstrap list', () => {
  const gaps = missing(backendTypes(), bootstrapTypes());
  assert.deepEqual(
    gaps,
    [],
    'pool.ts re-seeds notify.NotificationTypes on every boot precisely so a database the app is ' +
      'later pointed at still has them. A type absent here is one publishEvent() can throw on.'
  );
});

test('every publishable backend NotificationType is known to the frontend', () => {
  const backend = new Set([...backendTypes()].filter((type) => !LEGACY_ONLY.has(type)));
  const gaps = missing(backend, frontendTypes());
  assert.deepEqual(
    gaps,
    [],
    'The backend and frontend NotificationType unions are duplicated on purpose (separate ' +
      'TypeScript projects), so nothing but this test keeps them in step. A type missing from the ' +
      'frontend falls through getNotificationTypeMeta\'s `system` fallback and renders as a grey ' +
      '"System" row with no icon, tone or priority of its own, and cannot be filtered for.'
  );
});

test('the frontend declares no NotificationType the backend cannot publish', () => {
  // The reverse direction: a stale frontend type is dead render config, and worse, it can be
  // offered in the type filter as an option that matches nothing.
  const gaps = missing(frontendTypes(), backendTypes());
  assert.deepEqual(gaps, [], 'These frontend types have no backend counterpart and can never arrive.');
});

test('the multi-team types specifically are registered everywhere', () => {
  // Named explicitly rather than left to the generic tests above, so a regression names the actual
  // feature that broke rather than only a set difference.
  const teamTypes = [
    'team_member_removed_needs_reassignment',
    'team_member_moved',
    'team_lead_changed',
    'admin_task_needs_team_assignment',
    'subtask_transfer_requested',
    'subtask_transfer_approved',
    'subtask_transfer_rejected'
  ];
  const registries: Array<[string, Set<string>]> = [
    ['backend union', backendTypes()],
    ['database baseline seed', baselineSeededTypes()],
    ['pool.ts bootstrap', bootstrapTypes()],
    ['frontend union', frontendTypes()]
  ];
  for (const [label, registry] of registries) {
    for (const type of teamTypes) {
      assert.ok(registry.has(type), `${type} is missing from the ${label}`);
    }
  }
});
