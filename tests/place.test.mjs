import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPSULE, capsuleWindowAt, boardWindowAt, capsuleReturn } from '../src/shared/place.mjs';

const AREA = { x: 0, y: 25, width: 1920, height: 1055 };
const ADD = { x: 34, y: 64 };                  // the centre of Add's + in the board
const SIZE = { width: 780, height: 560 };
const plusOf = (w, z = 1) => ({ x: w.x + (CAPSULE.margin + CAPSULE.plusX) * z, y: w.y + (CAPSULE.margin + CAPSULE.plusY) * z });

test('the capsule forms with its + on the point', () => {
  const w = capsuleWindowAt({ x: 734, y: 214 });
  assert.deepEqual(w, { x: 734 - 46, y: 214 - 46 });
  assert.deepEqual(plusOf(w), { x: 734, y: 214 });
});

test('a larger text size moves the + further into the capsule', () => {
  const w = capsuleWindowAt({ x: 1000, y: 500 }, 1.12);
  assert.deepEqual(w, { x: Math.round(1000 - 46 * 1.12), y: Math.round(500 - 46 * 1.12) });
});

test('the board forms with its Add button on the point', () => {
  assert.deepEqual(boardWindowAt({ x: 734, y: 214 }, ADD, SIZE, AREA), { x: 700, y: 150, ...SIZE });
});

test('shrinking and expanding again puts the board back where it was', () => {
  const board = { x: 700, y: 150 };
  const capsule = capsuleWindowAt({ x: board.x + ADD.x, y: board.y + ADD.y });
  assert.deepEqual(boardWindowAt(plusOf(capsule), ADD, SIZE, AREA), { ...board, ...SIZE });
});

test('the board stays on the screen when the capsule sits in a corner', () => {
  assert.deepEqual(boardWindowAt({ x: 1900, y: 1060 }, ADD, SIZE, AREA), { x: 1920 - 780, y: 25 + 1055 - 560, ...SIZE });
  assert.deepEqual(boardWindowAt({ x: 10, y: 30 }, ADD, SIZE, AREA), { x: 0, y: 25, ...SIZE });
});

test('a board bigger than the screen keeps its top left corner on it', () => {
  const b = boardWindowAt({ x: 900, y: 500 }, ADD, { width: 2400, height: 1400 }, AREA);
  assert.equal(b.x, 0);
  assert.equal(b.y, 25);
});

// The capsule near the top right corner: the board it opens into can't put its
// Add button on the capsule's + and is pushed inside the screen.
const HOME = { x: 1740, y: 30 };
const FORMED = { board: { x: 1140, y: 25, ...SIZE }, capsule: HOME };

test('a board that has not moved gathers back into the capsule where it was', () => {
  assert.deepEqual(capsuleReturn(FORMED, { x: 1140, y: 25, ...SIZE }, { x: 1174, y: 89 }), HOME);
});

test('a pixel or two of rounding, or a resize, still counts as not moved', () => {
  assert.deepEqual(capsuleReturn(FORMED, { x: 1141, y: 26, width: 900, height: 700 }, { x: 1175, y: 90 }), HOME);
});

test('a board moved since it opened gathers into the capsule at its own Add button', () => {
  assert.deepEqual(capsuleReturn(FORMED, { x: 600, y: 300, ...SIZE }, { x: 634, y: 364 }, 1.12), capsuleWindowAt({ x: 634, y: 364 }, 1.12));
});

test('a board that did not open from the capsule gathers at its Add button', () => {
  assert.deepEqual(capsuleReturn(null, { x: 700, y: 150, ...SIZE }, { x: 734, y: 214 }), capsuleWindowAt({ x: 734, y: 214 }));
  assert.equal(capsuleReturn(null, { x: 700, y: 150, ...SIZE }, null), null);
});
