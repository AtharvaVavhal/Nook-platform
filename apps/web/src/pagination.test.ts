import assert from 'node:assert/strict';
import test from 'node:test';
import { readAllPages } from './pagination';

test('selection data includes records beyond the first API page', async () => {
  const requests: number[] = [];
  const records = await readAllPages(async (page) => {
    requests.push(page);
    return { items: [page], totalPages: 3 };
  });
  assert.deepEqual(requests, [1, 2, 3]);
  assert.deepEqual(records, [1, 2, 3]);
});

test('a later page failure is reported instead of returning an incomplete selector', async () => {
  await assert.rejects(
    readAllPages(async (page) => {
      if (page === 2) throw new Error('Unavailable');
      return { items: ['first'], totalPages: 2 };
    }),
    /Unavailable/,
  );
});

test('empty selection data makes only one request', async () => {
  let requests = 0;
  assert.deepEqual(
    await readAllPages(async () => {
      requests++;
      return { items: [], totalPages: 0 };
    }),
    [],
  );
  assert.equal(requests, 1);
});
