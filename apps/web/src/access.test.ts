import assert from 'node:assert/strict';
import test from 'node:test';
import { experienceFor, isWorkspaceRole, ROLE_MATRIX, roleLabel } from './access';
import { adminLinks, isAdminHash, parseAdminRoute } from './admin/adminRoute';

test('only API-defined roles enter the workspace', () => {
  assert.equal(experienceFor('OWNER'), 'workspace');
  assert.equal(experienceFor('PROPERTY_MANAGER'), 'workspace');
  for (const role of ['STAFF', 'RESIDENT', '', 'owner', 'ADMIN'])
    assert.equal(experienceFor(role), 'unsupported', role);
  assert.equal(isWorkspaceRole('RESIDENT'), false);
  assert.equal(roleLabel('STAFF'), 'Unsupported role');
});

test('matrix never grants a manager an owner-only capability', () => {
  for (const row of ROLE_MATRIX) {
    if (row.owner === 'owner-only') assert.notEqual(row.manager, 'allowed', row.capability);
  }
  assert.ok(ROLE_MATRIX.some((row) => row.owner === 'owner-only'));
  const execution = ROLE_MATRIX.find((row) => row.capability === 'Transfer execution');
  assert.equal(execution?.owner, 'not-defined');
  assert.equal(execution?.manager, 'not-defined');
});

test('admin routes parse and fall back safely', () => {
  assert.equal(isAdminHash('#settings'), true);
  assert.equal(isAdminHash('#settings/billing'), true);
  assert.equal(isAdminHash('#settingsx'), false);
  assert.deepEqual(parseAdminRoute('#settings/billing'), { name: 'settings', section: 'billing' });
  assert.deepEqual(parseAdminRoute('#settings/nonsense'), {
    name: 'settings',
    section: 'organization',
  });
  assert.deepEqual(parseAdminRoute('#staff'), { name: 'staff' });
  assert.deepEqual(parseAdminRoute('#transfers/not-a-uuid'), { name: 'transfers' });
  const id = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(parseAdminRoute(adminLinks.transfer(id)), { name: 'transfer', id });
});
