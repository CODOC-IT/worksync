import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCredentialEmailContent } from '../services/emailService.js';

test('credential email presents the supplied password as permanent sign-in credentials', () => {
  const content = buildCredentialEmailContent({
    toEmail: 'ayesha@example.com',
    recipientName: 'Ayesha Khan',
    password: 'Strong#123',
    role: 'Member'
  }, 'WorkSync', 'https://worksync.example/login');

  assert.match(content.text, /Password: Strong#123/);
  assert.match(content.text, /remains valid until you choose to reset it/);
  assert.match(content.html, /<strong>Password<\/strong>/);
  assert.doesNotMatch(`${content.text}\n${content.html}`, /temporary password|temporary credentials|must replace|change.*password/i);
});
