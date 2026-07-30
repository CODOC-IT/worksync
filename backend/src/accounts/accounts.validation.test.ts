import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountValidationError } from './accounts.errors.js';
import { isStrongPassword, parseCreateAccount } from './accounts.validation.js';

const validInput = {
  fullName: 'Ayesha Khan',
  username: 'Ayesha.Khan',
  email: ' AYESHA@example.com ',
  password: 'Strong#123',
  confirmPassword: 'Strong#123',
  baseRole: 'Team_Member',
  departmentId: 2
};

test('create-account parser normalizes identifiers and keeps the permanent password only in request memory', () => {
  const parsed = parseCreateAccount(validInput);
  assert.equal(parsed.email, 'ayesha@example.com');
  assert.equal(parsed.username, 'ayesha.khan');
  assert.equal(parsed.password, 'Strong#123');
  assert.equal(parsed.departmentId, 2);
});

test('shared password policy enforces length and all character classes', () => {
  assert.equal(isStrongPassword('Strong#123'), true);
  for (const password of ['Short#1', 'lowercase#1', 'UPPERCASE#1', 'NoNumber#', 'NoSpecial123']) {
    assert.equal(isStrongPassword(password), false, password);
  }
  assert.throws(
    () => parseCreateAccount({ ...validInput, password: 'NoSpecial123', confirmPassword: 'NoSpecial123' }),
    AccountValidationError
  );
});

test('password confirmation, designation, roles, and Team Lead base-role rules are validated', () => {
  assert.throws(
    () => parseCreateAccount({ ...validInput, confirmPassword: 'Different#123' }),
    /Password and confirmation do not match/
  );
  assert.throws(
    () => parseCreateAccount({ ...validInput, designation: 'x'.repeat(121) }),
    /120 characters/
  );
  assert.throws(
    () => parseCreateAccount({ ...validInput, baseRole: 'Team_Lead' }),
    /Base role/
  );
  assert.throws(
    () => parseCreateAccount({
      ...validInput,
      baseRole: 'HR',
      teamLeadAssignment: { projectId: 'prj-2', endsAtUtc: new Date(Date.now() + 60_000).toISOString() }
    }),
    /only be assigned to a Member/
  );
});
