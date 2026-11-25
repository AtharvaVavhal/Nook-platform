import assert from 'node:assert/strict';
import test from 'node:test';
import { hrefs, parseRoute, sectionOf, titleOf } from './route.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

test('routes parse, and every link the app builds parses back to the same route', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute(hrefs.stay), { name: 'stay' });
  assert.deepEqual(parseRoute(hrefs.rent), { name: 'rent' });
  assert.deepEqual(parseRoute(hrefs.payments), { name: 'payments' });
  assert.deepEqual(parseRoute(hrefs.profile), { name: 'profile' });
  assert.deepEqual(parseRoute(hrefs.invoice(ID)), { name: 'invoice', id: ID });
  assert.deepEqual(parseRoute(hrefs.receipt(ID)), { name: 'receipt', id: ID });
});

test('anything else is "not found", including a malformed id (never sent to the API)', () => {
  for (const h of [
    '#/admin',
    '#/finance',
    '#/login',
    '#/rent/invoice/abc',
    '#/rent/invoice',
    '#/payments/receipt/../x',
    '#/stay/extra',
    '#/rent/invoice/' + ID + '/more',
  ])
    assert.deepEqual(parseRoute(h), { name: 'notFound' }, h);
});

test('navigation sections and page titles', () => {
  assert.equal(sectionOf({ name: 'invoice', id: ID }), 'rent');
  assert.equal(sectionOf({ name: 'receipt', id: ID }), 'payments');
  assert.equal(sectionOf({ name: 'notFound' }), 'home');
  assert.equal(titleOf({ name: 'rent' }), 'Rent & Invoices');
  assert.equal(titleOf({ name: 'notFound' }), 'Page not found');
});
