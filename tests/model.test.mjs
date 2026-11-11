import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRanges, toggleBold, isRangeBold, segments, fromSegments, trimRich,
  createTask, applyPatch, validateTask, migrate, arrangeBoard, arrangeOngoing, arrangeDone, orderBetween, nextOrder,
  attachmentFiles, plainToHtml, ATT_FILE, SPACES,
  TOMBSTONE_TTL_MS,
} from '../src/shared/model.mjs';

test('normalizeRanges sorts, merges, clamps and drops empty ranges', () => {
  assert.deepEqual(normalizeRanges([[5, 8], [0, 2], [1, 3], [8, 9], [4, 4], [-3, 1], [9, 50]], 10),
    [[0, 3], [5, 10]]);
  assert.deepEqual(normalizeRanges([[3, 1]], 10), [[1, 3]]);
  assert.deepEqual(normalizeRanges('junk', 10), []);
  assert.deepEqual(normalizeRanges([[1, 'x'], [2, 4]], 10), [[2, 4]]);
});

test('toggleBold bolds one word, then un-bolds it', () => {
  const text = 'Call the bank today';
  let b = toggleBold([], 9, 13, text.length);
  assert.deepEqual(b, [[9, 13]]);
  assert.ok(isRangeBold(b, 9, 13));
  b = toggleBold(b, 9, 13, text.length);
  assert.deepEqual(b, []);
});

test('toggleBold over a partly bold range bolds all of it', () => {
  assert.deepEqual(toggleBold([[2, 4]], 0, 6, 10), [[0, 6]]);
});

test('toggleBold inside a bold range splits it', () => {
  assert.deepEqual(toggleBold([[0, 10]], 3, 5, 10), [[0, 3], [5, 10]]);
});

test('whole-row toggle', () => {
  assert.deepEqual(toggleBold([], 0, 5, 5), [[0, 5]]);
  assert.deepEqual(toggleBold([[0, 5]], 0, 5, 5), []);
});

test('segments and fromSegments round-trip', () => {
  const text = 'Ship the build tonight';
  const bold = [[5, 8], [15, 22]];
  const runs = segments(text, bold);
  assert.deepEqual(runs.map((r) => r.text).join(''), text);
  assert.deepEqual(runs.filter((r) => r.bold).map((r) => r.text), ['the', 'tonight']);
  assert.deepEqual(fromSegments(runs), { text, bold });
});

test('fromSegments merges adjacent bold runs', () => {
  assert.deepEqual(fromSegments([{ text: 'ab', bold: true }, { text: 'cd', bold: true }, { text: 'e', bold: false }]),
    { text: 'abcde', bold: [[0, 4]] });
});

test('trimRich keeps bold aligned with trimmed text', () => {
  assert.deepEqual(trimRich('  hello world ', [[2, 7]]), { text: 'hello world', bold: [[0, 5]] });
  assert.deepEqual(trimRich('  x ', [[0, 1]]), { text: 'x', bold: [] });
});

test('createTask defaults', () => {
  const t = createTask({ text: 'a' }, Date.parse('2026-10-26T10:00:00Z'));
  assert.equal(t.status, 'todo');
  assert.equal(t.priority, null);
  assert.equal(t.deletedAt, null);
  assert.equal(t.createdAt, '2026-10-26T10:00:00.000Z');
  assert.equal(t.createdAt, t.updatedAt);
  assert.match(t.id, /^[0-9a-f-]{36}$/);
});

test('applyPatch validates fields and bumps updatedAt', () => {
  const t = createTask({ text: 'abc' }, 0);
  const n = applyPatch(t, { status: 'bogus', priority: 'urgent', bold: [[0, 99]], id: 'hijack', notesHeight: 5 }, 1000);
  assert.equal(n.status, 'todo');
  assert.equal(n.priority, null);
  assert.deepEqual(n.bold, [[0, 3]]);
  assert.equal(n.id, t.id);
  assert.equal(n.notesHeight, 72);
  assert.equal(n.updatedAt, new Date(1000).toISOString());
  assert.equal(applyPatch(t, { status: 'done', priority: 'high' }).status, 'done');
});

test('validateTask repairs or rejects', () => {
  assert.equal(validateTask(null), null);
  assert.equal(validateTask({ text: 'no id' }), null);
  const v = validateTask({ id: 'x', text: 'hi', status: 'weird', bold: [[0, 9]], createdAt: '2026-01-01T00:00:00Z' });
  assert.equal(v.status, 'todo');
  assert.deepEqual(v.bold, [[0, 2]]);
  assert.equal(v.updatedAt, v.createdAt);
});

test('migrate keeps deviceId, drops expired tombstones', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  const old = new Date(now - TOMBSTONE_TTL_MS - 1).toISOString();
  const recent = new Date(now - 1000).toISOString();
  const f = migrate({
    deviceId: 'dev1',
    tasks: [
      { id: 'a', createdAt: recent },
      { id: 'b', createdAt: recent, deletedAt: old },
      { id: 'c', createdAt: recent, deletedAt: recent },
      'garbage',
    ],
  }, now);
  assert.equal(f.schemaVersion, 1);
  assert.equal(f.deviceId, 'dev1');
  assert.deepEqual(f.tasks.map((t) => t.id), ['a', 'c']);
  assert.ok(migrate(undefined).deviceId);
});

function mk(id, status, order, priority = null, createdAt = `2026-10-26T00:00:0${order}Z`) {
  return { ...createTask({ status, priority, order }), id, createdAt };
}

test('board: default groups today by status, To Do first, no Done', () => {
  const tasks = [
    mk('d1', 'done', 1), mk('p2', 'in_progress', 3), mk('h1', 'on_hold', 2),
    mk('t1', 'todo', 4), mk('p1', 'in_progress', 1), { ...mk('x', 'in_progress', 0), deletedAt: 'z' },
  ];
  const b = arrangeBoard(tasks, 'default');
  assert.deepEqual(b.map((s) => s.status), ['todo', 'in_progress', 'awaiting_approval', 'on_hold']);
  assert.deepEqual(b.map((s) => s.tasks.map((t) => t.id)), [['t1'], ['p1', 'p2'], [], ['h1']]);
});

test('board: priority sort is one list with To Do in it, high then medium then none', () => {
  const tasks = [mk('n', 'todo', 1), mk('m', 'in_progress', 2, 'medium'), mk('h', 'on_hold', 3, 'high'), mk('d', 'done', 4, 'high')];
  const b = arrangeBoard(tasks, 'priority');
  assert.equal(b.length, 1);
  assert.equal(b[0].status, null);
  assert.deepEqual(b[0].tasks.map((t) => t.id), ['h', 'm', 'n']);
});

test('board: created sort ignores drag order', () => {
  const tasks = [mk('b', 'todo', 1, null, '2026-10-26T02:00:00Z'), mk('a', 'todo', 9, null, '2026-10-26T01:00:00Z')];
  assert.deepEqual(arrangeBoard(tasks, 'created')[0].tasks.map((t) => t.id), ['a', 'b']);
  assert.deepEqual(arrangeBoard(tasks, 'manual')[0].tasks.map((t) => t.id), ['b', 'a']);
});

test('orderBetween and nextOrder', () => {
  assert.equal(orderBetween(1, 2), 1.5);
  assert.equal(orderBetween(null, 2), 1);
  assert.equal(orderBetween(4, null), 5);
  assert.equal(orderBetween(null, null), 0);
  assert.equal(nextOrder([{ order: 3 }, { order: 7 }]), 8);
  assert.equal(nextOrder([]), 1);
});

test('Awaiting Approval sits between In Progress and On Hold', () => {
  const b = arrangeBoard([mk('h', 'on_hold', 1), mk('w', 'awaiting_approval', 2), mk('p', 'in_progress', 3)], 'default');
  assert.deepEqual(b.filter((s) => s.tasks.length).map((s) => s.tasks[0].id), ['p', 'w', 'h']);
});

test('the board shows today only; Ongoing groups its projects; Done gathers both lists', () => {
  const on = (id, status, order) => ({ ...mk(id, status, order), list: 'ongoing' });
  const tasks = [on('od', 'done', 1), on('ot', 'todo', 2), on('op2', 'in_progress', 4), on('op1', 'in_progress', 3),
    on('ow', 'awaiting_approval', 5), mk('t', 'todo', 6), mk('p', 'in_progress', 7), mk('d', 'done', 8)];
  assert.deepEqual(arrangeBoard(tasks, 'default').flatMap((s) => s.tasks.map((t) => t.id)), ['t', 'p']);
  const og = arrangeOngoing(tasks, 'default');
  assert.deepEqual(og.map((s) => s.status), ['todo', 'in_progress', 'awaiting_approval', 'on_hold']);
  assert.deepEqual(og.map((s) => s.tasks.map((t) => t.id)), [['ot'], ['op1', 'op2'], ['ow'], []]);
  // Ongoing stays grouped whatever the sort; the sort orders each group.
  assert.equal(arrangeOngoing(tasks, 'priority').length, 4);
  assert.deepEqual(arrangeDone(tasks).map((t) => t.id).sort(), ['d', 'od']);
});

test('done: latest finished first, by doneAt', () => {
  const at = (id, doneAt) => ({ ...mk(id, 'done', 1), doneAt });
  const tasks = [at('a', '2026-11-01T10:00:00.000Z'), at('b', '2026-11-03T10:00:00.000Z'), at('c', '2026-11-02T10:00:00.000Z'),
    { ...at('x', '2026-11-04T00:00:00.000Z'), deletedAt: 'z' }];
  assert.deepEqual(arrangeDone(tasks).map((t) => t.id), ['b', 'c', 'a']);
});

test('doneAt: set on becoming done, kept through edits, cleared on leaving', () => {
  const t = createTask({ text: 'x' }, Date.parse('2026-11-01T00:00:00Z'));
  assert.equal(t.doneAt, null);
  const d = applyPatch(t, { status: 'done' }, Date.parse('2026-11-02T00:00:00Z'));
  assert.equal(d.doneAt, '2026-11-02T00:00:00.000Z');
  const e = applyPatch(d, { notes: 'later' }, Date.parse('2026-11-05T00:00:00Z'));
  assert.equal(e.doneAt, '2026-11-02T00:00:00.000Z');
  assert.equal(applyPatch(e, { status: 'todo' }).doneAt, null);
  assert.equal(applyPatch(d, { doneAt: 'forged' }).doneAt, d.doneAt);
  assert.ok(createTask({ status: 'done' }).doneAt);
});

test('doneAt: older done tasks borrow their last edit', () => {
  const v = validateTask({ id: 'a', text: 'x', status: 'done', updatedAt: '2026-11-01T00:00:00Z' });
  assert.equal(v.doneAt, '2026-11-01T00:00:00.000Z');
  assert.equal(validateTask({ id: 'b', status: 'todo', doneAt: '2026-11-01T00:00:00Z' }).doneAt, null);
  assert.equal(validateTask({ id: 'c', status: 'done', doneAt: '2026-10-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }).doneAt, '2026-10-01T00:00:00.000Z');
});

test('list and notesDir default, validate and survive a patch', () => {
  const t = createTask({ text: 'x' });
  assert.equal(t.list, 'today');
  assert.equal(t.notesDir, 'auto');
  assert.equal(createTask({ list: 'ongoing' }).list, 'ongoing');
  assert.equal(createTask({ list: 'bogus' }).list, 'today');
  const n = applyPatch(t, { list: 'ongoing', notesDir: 'rtl' });
  assert.equal(n.list, 'ongoing');
  assert.equal(n.notesDir, 'rtl');
  const bad = applyPatch(n, { list: 'nope', notesDir: 'up' });
  assert.equal(bad.list, 'ongoing');
  assert.equal(bad.notesDir, 'rtl');
  const v = validateTask({ id: 'old', text: 'from v0.1.0' });   // no list / notesDir on disk
  assert.equal(v.list, 'today');
  assert.equal(v.notesDir, 'auto');
});

test('notes formatting rides along with the plain text, and plain notes alone clear it', () => {
  const t = createTask({ text: 'x' });
  assert.equal(t.notesHtml, '');
  const rich = applyPatch(t, { notes: 'Call Dana', notesHtml: '<b>Call</b> Dana' });
  assert.equal(rich.notesHtml, '<b>Call</b> Dana');
  assert.equal(applyPatch(rich, { status: 'done' }).notesHtml, '<b>Call</b> Dana');
  assert.equal(applyPatch(rich, { notes: 'Email Dana' }).notesHtml, '');
  assert.equal(validateTask({ id: 'old', text: 'v0.5' }).notesHtml, '');
});

test('attachments: found in a note, and kept when plain notes replace it', () => {
  const img = '<img src="clearday-file://att/0b5c1e2a-1111-4222-8333-944445555666.png" alt="logo &amp; mark.png">';
  const doc = '<span class="att" data-att="0b5c1e2a-1111-4222-8333-944445555777.pdf" data-name="brief.pdf" contenteditable="false">brief.pdf</span>';
  const t = applyPatch(createTask({ text: 'x' }), { notes: 'old\n[image: logo & mark.png]', notesHtml: `<div>old</div><div>${img}</div><div>${doc}</div>` });
  assert.deepEqual([...attachmentFiles(t.notesHtml)].sort(),
    ['0b5c1e2a-1111-4222-8333-944445555666.png', '0b5c1e2a-1111-4222-8333-944445555777.pdf']);
  // Claude rewrites the notes as plain text, repeating the image line it read.
  const n = applyPatch(t, { notes: 'new text\n[image: logo & mark.png]' });
  assert.equal(n.notes, 'new text\n[image: logo & mark.png]\n[file: brief.pdf]');
  assert.ok(n.notesHtml.startsWith('<div>new text</div>'));
  assert.ok(n.notesHtml.includes(img) && n.notesHtml.includes(doc));
  assert.equal(n.notesHtml.split('clearday-file://').length, 2);   // the image once, not twice
  // A note without attachments still loses its formatting to plain notes.
  const plain = applyPatch(applyPatch(createTask(), { notes: 'a', notesHtml: '<b>a</b>' }), { notes: 'b' });
  assert.equal(plain.notesHtml, '');
  assert.ok(ATT_FILE.test('0b5c1e2a-1111-4222-8333-944445555666.png'));
  assert.ok(!ATT_FILE.test('../etc/passwd'));
});

test('plainToHtml: bullets and escaping', () => {
  assert.equal(plainToHtml('a <b>\n- one\n- two\nend'), '<div>a &lt;b&gt;</div><ul><li>one</li><li>two</li></ul><div>end</div>');
  assert.equal(plainToHtml(''), '');
});

test('space: Work by default, validated, and each board shows only its own', () => {
  assert.deepEqual(SPACES, ['work', 'personal']);
  assert.equal(createTask({ text: 'x' }).space, 'work');
  assert.equal(createTask({ space: 'personal' }).space, 'personal');
  assert.equal(createTask({ space: 'bogus' }).space, 'work');
  // Tasks saved before 0.10 have no space.
  assert.equal(validateTask({ id: 'a', text: 'old' }).space, 'work');
  const p = applyPatch(createTask({ text: 'x' }), { space: 'personal' });
  assert.equal(p.space, 'personal');
  assert.equal(applyPatch(p, { space: 'nope' }).space, 'personal');

  const at = (id, status, space, list = 'today') => ({ ...mk(id, status, 1), space, list });
  const tasks = [at('w', 'todo', 'work'), at('p', 'todo', 'personal'), at('wo', 'in_progress', 'work', 'ongoing'),
    at('po', 'in_progress', 'personal', 'ongoing'), at('wd', 'done', 'work'), at('pd', 'done', 'personal', 'ongoing')];
  const ids = (sections) => sections.flatMap((s) => s.tasks.map((t) => t.id));
  assert.deepEqual(ids(arrangeBoard(tasks, 'default', 'work')), ['w']);
  assert.deepEqual(ids(arrangeBoard(tasks, 'default', 'personal')), ['p']);
  assert.deepEqual(ids(arrangeBoard(tasks, 'default')).sort(), ['p', 'w']);
  assert.deepEqual(ids(arrangeOngoing(tasks, 'default', 'personal')), ['po']);
  assert.deepEqual(arrangeDone(tasks, 'work').map((t) => t.id), ['wd']);
  assert.deepEqual(arrangeDone(tasks, 'personal').map((t) => t.id), ['pd']);
  assert.equal(arrangeDone(tasks).length, 2);
});
