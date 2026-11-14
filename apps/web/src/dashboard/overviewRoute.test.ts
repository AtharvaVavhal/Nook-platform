import assert from 'node:assert/strict';
import test from 'node:test';
import { adminLinks, isAdminHash } from '../admin/adminRoute';
import { isFinanceHash } from '../finance/financeRoute';
import { isOpsHash } from '../ops/opsRoute';
import { overviewHref, parseOverviewHash } from './overviewRoute';

const ID = '11111111-1111-4111-8111-111111111111';
const none = { propertyId: null, malformedPropertyId: false };

test('the empty hash and #overview are the overview with no property', () => {
  assert.deepEqual(parseOverviewHash(''), { section: 'overview', ...none });
  assert.deepEqual(parseOverviewHash('#'), { section: 'overview', ...none });
  assert.deepEqual(parseOverviewHash('#overview'), { section: 'overview', ...none });
  assert.deepEqual(parseOverviewHash('#overview/'), { section: 'overview', ...none });
});

test('#overview/<propertyId> keeps the section as overview and parses the property separately', () => {
  assert.deepEqual(parseOverviewHash(`#overview/${ID}`), {
    section: 'overview',
    propertyId: ID,
    malformedPropertyId: false,
  });
  assert.equal(parseOverviewHash(`#overview/${ID.toUpperCase()}`).propertyId, ID);
  assert.equal(parseOverviewHash(`#overview/${ID}?x=1`).propertyId, ID);
  assert.equal(parseOverviewHash(`#overview/${ID}/extra`).propertyId, ID);
});

test('a malformed property id is flagged and never becomes a property id', () => {
  for (const bad of ['not-a-uuid', '123', `${ID}x`, '11111111-1111-6111-8111-111111111111']) {
    assert.deepEqual(parseOverviewHash(`#overview/${bad}`), {
      section: 'overview',
      propertyId: null,
      malformedPropertyId: true,
    });
  }
});

test('other in-page anchors keep their own section and carry no property', () => {
  assert.deepEqual(parseOverviewHash('#inventory'), { section: 'inventory', ...none });
  assert.deepEqual(parseOverviewHash(`#inventory/${ID}`), { section: 'inventory', ...none });
  assert.deepEqual(parseOverviewHash('#finance/invoices'), { section: 'finance', ...none });
  assert.deepEqual(parseOverviewHash('#login'), { section: 'login', ...none });
});

test('the legacy #floor-plan link (the demonstration floor plan is gone) lands on the overview', () => {
  assert.deepEqual(parseOverviewHash('#floor-plan'), { section: 'overview', ...none });
  assert.deepEqual(parseOverviewHash('#floor-plan/x'), { section: 'overview', ...none });
  assert.deepEqual(parseOverviewHash(`#floor-plan/${ID}`), { section: 'overview', ...none });
});

test('the dashboard hash is never taken for an ops, finance or admin route', () => {
  const hash = overviewHref(ID);
  assert.equal(hash, `#overview/${ID}`);
  assert.equal(isOpsHash(hash), false);
  assert.equal(isOpsHash('#overview'), false);
  assert.equal(isFinanceHash(hash), false);
  assert.equal(isAdminHash(hash), false);
  // and the existing routes are not captured by the overview parser
  assert.equal(isAdminHash(adminLinks.transfers), true);
  assert.equal(
    parseOverviewHash(adminLinks.transfers).section,
    adminLinks.transfers.replace(/^#/, '').split('/')[0],
  );
});
