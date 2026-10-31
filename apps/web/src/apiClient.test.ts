import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createErrorFromResponse,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RuleNotConfiguredError,
} from './api/errors';
import { mockDataService } from './api/mockAdapter';

test('createErrorFromResponse maps 401, 403, 404, 409 to typed errors', () => {
  assert.ok(createErrorFromResponse(401) instanceof UnauthorizedError);
  assert.ok(createErrorFromResponse(403) instanceof ForbiddenError);
  assert.ok(createErrorFromResponse(404) instanceof NotFoundError);
  assert.ok(createErrorFromResponse(409) instanceof ConflictError);
});

test('createErrorFromResponse extracts 422 RULE_NOT_CONFIGURED and names rule plainly', () => {
  const err = createErrorFromResponse(422, {
    error: {
      code: 'RULE_NOT_CONFIGURED',
      message: 'Rent calculation formula is not configured.',
      rule: 'RENT_FORMULA_PRORATA',
    },
  });
  assert.ok(err instanceof RuleNotConfiguredError);
  assert.equal((err as RuleNotConfiguredError).rule, 'RENT_FORMULA_PRORATA');
  assert.match(err.message, /RENT_FORMULA_PRORATA/);
});

test('Mock adapter demonstrates derived balance without floating-point storage', async () => {
  const statement = await mockDataService.getResidentStatement('res_demo_01');
  assert.ok(statement.lineItems.length > 0);

  // Check that the sum of line items strictly equals the derived balance
  let sum = 0n;
  for (const item of statement.lineItems) {
    sum += item.amountPaise;
    assert.equal(item.runningBalancePaise, sum);
  }
  assert.equal(statement.currentBalancePaise, sum);
});

test('Mock adapter refuses duplicate payment references and enforces idempotency', async () => {
  const paymentInput = {
    residentId: 'res_demo_01',
    amountPaise: 100000n, // ₹1,000.00
    date: '2026-10-31',
    method: 'upi' as const,
    reference: 'UPI/TEST/REF_12345',
    settledChargeId: 'txn_05',
  };

  const receipt1 = await mockDataService.recordPayment(paymentInput, 'idem_key_001');
  assert.ok(receipt1.receiptNumber.startsWith('REC-2026-'));

  // Re-submitting with the same idempotency key replays the exact receipt
  const receipt2 = await mockDataService.recordPayment(paymentInput, 'idem_key_001');
  assert.equal(receipt2.receiptNumber, receipt1.receiptNumber);

  // Submitting a new request with the same reference number but different idempotency key is refused
  await assert.rejects(
    async () => {
      await mockDataService.recordPayment(paymentInput, 'idem_key_002');
    },
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.match((err as ConflictError).message, /Duplicate payment reference/);
      return true;
    }
  );
});

test('Mock adapter refuses bed allocation if bed was taken, returning honest ConflictError', async () => {
  const allocation = {
    residentName: 'Arjun Verma',
    phone: '+91 99000 11223',
    floorId: 'ground',
    roomId: '001',
    bedId: 'A', // Already allocated in mock data
    expectedMoveInDate: '2026-11-01',
  };

  await assert.rejects(
    async () => {
      await mockDataService.allocateBed(allocation, 'idem_alloc_01');
    },
    (err: unknown) => {
      assert.ok(err instanceof ConflictError);
      assert.match((err as ConflictError).message, /Selecting a bed does not hold it/);
      return true;
    }
  );
});
