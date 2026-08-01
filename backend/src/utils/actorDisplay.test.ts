import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActorMessage } from './actorDisplay.js';

test('normalizes a historical leading Someone placeholder to the known actor', () => {
  assert.equal(
    normalizeActorMessage('Someone archived "Requirements Gathering".', 'Maryam Yousaf'),
    'Maryam Yousaf archived "Requirements Gathering".'
  );
});

test('removes a duplicate Someone suffix after a known actor name', () => {
  assert.equal(
    normalizeActorMessage('Maryam Yousaf Someone archived "Requirements Gathering".', 'Maryam Yousaf'),
    'Maryam Yousaf archived "Requirements Gathering".'
  );
});

test('does not alter unrelated uses of the word someone', () => {
  const message = 'Maryam Yousaf asked someone to review the requirements.';
  assert.equal(normalizeActorMessage(message, 'Maryam Yousaf'), message);
});

test('removes an unresolvable leading placeholder without displaying Someone', () => {
  assert.equal(normalizeActorMessage('Someone archived the project.', null), 'archived the project.');
});
