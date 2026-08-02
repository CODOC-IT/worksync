import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMentionTrigger,
  getProjectMentionCandidates,
  insertMention,
  parseMentionIds
} from './projectChatRules.js';

const users = [
  { id: 'usr-1', name: 'Ann', status: 'active' },
  { id: 'usr-2', name: 'Ann Marie', status: 'active' },
  { id: 'usr-3', name: 'Jane Doe', status: 'active' },
  { id: 'usr-4', name: 'Inactive User', status: 'inactive' }
];

test('parses exact mentions without consuming the rest of the message', () => {
  assert.deepEqual(
    parseMentionIds('@Jane Doe please review this with @Ann Marie.', users),
    ['usr-3', 'usr-2']
  );
});

test('prefers the longest matching project-member name and excludes inactive users', () => {
  assert.deepEqual(parseMentionIds('@Ann Marie and @Inactive User', users), ['usr-2']);
});

test('tracks an active mention query and replaces it with the selected member', () => {
  const text = 'Please ask @Jan';
  const trigger = getMentionTrigger(text);
  assert.deepEqual(trigger, { start: 11, end: 15, query: 'Jan' });
  assert.deepEqual(
    insertMention(text, trigger!, 'Jane Doe'),
    { body: 'Please ask @Jane Doe ', cursor: 21 }
  );
});

test('closes the picker once a complete known mention is followed by message text', () => {
  assert.equal(getMentionTrigger('@Jane Doe please review', undefined, users), null);
});

test('mention candidates include project participants plus active HR and Admin only', () => {
  const candidates = [
    { id: 'member-1', name: 'Member One', status: 'active', role: 'Team_Member' },
    { id: 'lead-1', name: 'Lead One', status: 'active', role: 'Team_Lead' },
    { id: 'member-2', name: 'Member Two', status: 'active', role: 'Team_Member' },
    { id: 'lead-2', name: 'Lead Two', status: 'active', role: 'Team_Lead' },
    { id: 'hr-1', name: 'HR User', status: 'active', role: 'HR' },
    { id: 'admin-1', name: 'Admin User', status: 'active', role: 'Admin' },
    { id: 'inactive-admin', name: 'Inactive Admin', status: 'inactive', role: 'Admin' }
  ];

  assert.deepEqual(
    getProjectMentionCandidates(candidates, ['member-1', 'lead-1']).map((user) => user.id),
    ['member-1', 'lead-1', 'hr-1', 'admin-1']
  );
});
