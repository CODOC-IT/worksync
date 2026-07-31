import assert from 'node:assert/strict';
import test from 'node:test';
import { parseActivityFilters } from './activity.validation.js';

test('parses combined activity filters and boolean flags', () => {
  const filters = parseActivityFilters({
    module: 'Tasks', action: 'Status Changed', projectId: 'prj-1',
    myActivityOnly: 'true', importantOnly: 'false', sort: 'oldest', page: '3', pageSize: '50'
  });
  assert.equal(filters.module, 'Tasks');
  assert.equal(filters.action, 'Status Changed');
  assert.equal(filters.projectId, 'prj-1');
  assert.equal(filters.myActivityOnly, true);
  assert.equal(filters.importantOnly, false);
  assert.equal(filters.sort, 'oldest');
  assert.equal(filters.page, 3);
  assert.equal(filters.pageSize, 50);
});

test('applies safe pagination bounds', () => {
  assert.equal(parseActivityFilters({ page: '-2', pageSize: '1000' }).page, 1);
  assert.equal(parseActivityFilters({ pageSize: '1000' }).pageSize, 100);
  assert.equal(parseActivityFilters({ pageSize: '0' }).pageSize, 20);
});

test('treats blank select values as unset filters', () => {
  const filters = parseActivityFilters({
    module: '', action: '', entityType: '', result: '', source: '', userRole: '',
    projectId: '', taskId: '', userId: '',
  });
  assert.equal(filters.module, undefined);
  assert.equal(filters.action, undefined);
  assert.equal(filters.result, undefined);
  assert.equal(filters.source, undefined);
  assert.equal(filters.userId, undefined);
});

