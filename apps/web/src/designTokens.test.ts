import assert from 'node:assert/strict';
import test from 'node:test';
import { nookBrandTokens } from './designTokens';

test('Nook canonical brand tokens remain stable', () => {
  assert.equal(nookBrandTokens.midnightIndigo, '#171338');
  assert.equal(nookBrandTokens.nookViolet, '#7657F6');
  assert.equal(nookBrandTokens.softLavender, '#F4F1FF');
  assert.equal(nookBrandTokens.pureWhite, '#FFFFFF');
  assert.equal(nookBrandTokens.primaryText, '#26233D');
});
