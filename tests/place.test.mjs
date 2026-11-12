import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPSULE, capsuleWindowAt, boardWindowAt } from '../src/shared/place.mjs';

const AREA = { x: 0, y: 25, width: 1920, height: 1055 };
const BUTTON = { x: 651, y: 32 };              // the shrink button's centre in a 780-wide board
const SIZE = { width: 780, height: 560 };

test('the capsule forms with its expand arrows on the point', () => {
  const w = capsuleWindowAt({ x: 1351, y: 182 });
  assert.deepEqual(w, { x: 1351 - CAPSULE.margin - CAPSULE.arrowsX, y: 182 - CAPSULE.margin - CAPSULE.arrowsY });
});

test('a larger text size moves the arrows further into the capsule', () => {
  const w = capsuleWindowAt({ x: 1000, y: 500 }, 1.12);
  assert.deepEqual(w, { x: Math.round(1000 - 87 * 1.12), y: Math.round(500 - 46 * 1.12) });
});

test('the board forms with its shrink button on the point', () => {
  const b = boardWindowAt({ x: 1351, y: 182 }, BUTTON, SIZE, AREA);
  assert.deepEqual(b, { x: 700, y: 150, ...SIZE });
});

test('shrinking and expanding again puts the board back where it was', () => {
  const board = { x: 700, y: 150 };
  const point = { x: board.x + BUTTON.x, y: board.y + BUTTON.y };
  const capsule = capsuleWindowAt(point);
  const arrows = { x: capsule.x + CAPSULE.margin + CAPSULE.arrowsX, y: capsule.y + CAPSULE.margin + CAPSULE.arrowsY };
  assert.deepEqual(boardWindowAt(arrows, BUTTON, SIZE, AREA), { ...board, ...SIZE });
});

test('the board stays on the screen when the capsule sits in a corner', () => {
  const b = boardWindowAt({ x: 1900, y: 1060 }, BUTTON, SIZE, AREA);
  assert.deepEqual(b, { x: 1920 - 780, y: 25 + 1055 - 560, ...SIZE });
  const c = boardWindowAt({ x: 10, y: 30 }, BUTTON, SIZE, AREA);
  assert.deepEqual(c, { x: 0, y: 25, ...SIZE });
});

test('a board bigger than the screen keeps its top left corner on it', () => {
  const b = boardWindowAt({ x: 900, y: 500 }, BUTTON, { width: 2400, height: 1400 }, AREA);
  assert.equal(b.x, 0);
  assert.equal(b.y, 25);
});
