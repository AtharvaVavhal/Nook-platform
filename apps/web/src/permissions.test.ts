import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSIONS,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from './auth/permissions';
import { MOCK_PERSONAS } from './auth/AuthContext';

test('Cashier has payment.record but NOT payment.confirm or data.export', () => {
  const cashierSession = MOCK_PERSONAS.cashier.session;
  assert.ok(cashierSession);
  assert.equal(hasPermission(cashierSession, PERMISSIONS.PAYMENT_RECORD), true);
  assert.equal(hasPermission(cashierSession, PERMISSIONS.PAYMENT_CONFIRM), false);
  assert.equal(hasPermission(cashierSession, PERMISSIONS.DATA_EXPORT), false);
});

test('Warden has occupancy.read but CANNOT see finance, documents or payments', () => {
  const wardenSession = MOCK_PERSONAS.warden.session;
  assert.ok(wardenSession);
  assert.equal(hasPermission(wardenSession, PERMISSIONS.OCCUPANCY_READ), true);
  assert.equal(hasPermission(wardenSession, PERMISSIONS.FINANCE_READ), false);
  assert.equal(hasPermission(wardenSession, PERMISSIONS.DOCUMENT_READ), false);
  assert.equal(hasPermission(wardenSession, PERMISSIONS.PAYMENT_RECORD), false);
});

test('Resident.read does not grant document.read separation', () => {
  const ownerSession = MOCK_PERSONAS.owner.session;
  assert.ok(ownerSession);
  assert.equal(hasPermission(ownerSession, PERMISSIONS.RESIDENT_READ), true);
  // Owner in our separation does not have document.read
  assert.equal(hasPermission(ownerSession, PERMISSIONS.DOCUMENT_READ), false);
});

test('hasAllPermissions and hasAnyPermission handle session boundaries and null sessions', () => {
  assert.equal(hasPermission(null, PERMISSIONS.OCCUPANCY_READ), false);
  assert.equal(hasAllPermissions(null, [PERMISSIONS.OCCUPANCY_READ]), false);
  assert.equal(hasAnyPermission(null, [PERMISSIONS.OCCUPANCY_READ]), false);

  const mgrSession = MOCK_PERSONAS.manager.session;
  assert.ok(mgrSession);
  assert.equal(
    hasAllPermissions(mgrSession, [PERMISSIONS.OCCUPANCY_READ, PERMISSIONS.RESIDENT_READ]),
    true
  );
  assert.equal(
    hasAllPermissions(mgrSession, [PERMISSIONS.OCCUPANCY_READ, PERMISSIONS.PAYMENT_CONFIRM]),
    false
  );
  assert.equal(
    hasAnyPermission(mgrSession, [PERMISSIONS.PAYMENT_CONFIRM, PERMISSIONS.OCCUPANCY_READ]),
    true
  );
});
