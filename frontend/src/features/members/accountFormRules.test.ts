import assert from 'node:assert/strict';
import test from 'node:test';
import { getPasswordChecks, validateAccountForm } from './accountFormRules.js';

const valid = {
  fullName: 'Ayesha Khan',
  username: 'ayesha.khan',
  email: 'ayesha@example.com',
  password: 'Strong#123',
  confirmPassword: 'Strong#123',
  designation: 'Engineer',
  baseRole: 'Team_Member',
  departmentId: '2'
};

test('account form accepts a complete strong-password payload', () => {
  assert.deepEqual(validateAccountForm(valid), {});
  assert.deepEqual(getPasswordChecks(valid.password), {
    length: true,
    uppercase: true,
    lowercase: true,
    number: true,
    special: true
  });
});

test('account form reports independent required, password, matching, and hierarchy fields', () => {
  const errors = validateAccountForm({
    ...valid,
    fullName: '',
    email: 'invalid',
    password: 'weak',
    confirmPassword: 'other',
    departmentId: ''
  });
  assert.ok(errors.fullName);
  assert.ok(errors.email);
  assert.ok(errors.password);
  assert.ok(errors.confirmPassword);
  assert.ok(errors.departmentId);
});
