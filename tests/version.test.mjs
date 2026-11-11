import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newer } from '../src/shared/version.mjs';

test('newer compares release versions part by part', () => {
  assert.equal(newer('0.9.0', '0.8.1'), true);
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('v1.0.0', '0.99.0'), true);
  assert.equal(newer('0.9.0', '0.9.0'), false);
  assert.equal(newer('0.8.1', '0.9.0'), false);
  assert.equal(newer('0.9.1-beta', '0.9.0'), true);
  assert.equal(newer('0.9', '0.9.0'), false);
});
