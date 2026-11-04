// ClearDay's MCP side: the tools against the file backend, the app socket
// bridge, and the stdio server end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { callTool, TOOLS } from '../src/mcp/tools.mjs';
import { fileBackend, appBackend, openBackend } from '../src/mcp/backend.mjs';
import { startBridge } from '../src/main/bridge.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'clearday-mcp-'));

test('tools: add, list, update, search, delete through the file', async () => {
  const dir = tmp();
  const b = fileBackend(dir);
  const add = await callTool('add_task', { text: 'Book the venue', priority: 'high', notes: 'Call Dana' }, b);
  assert.equal(add.data.status, 'todo');
  assert.equal(add.data.priority, 'high');
  assert.equal(add.data.notes, 'Call Dana');
  await callTool('add_task', { text: 'Brand guidelines v2', list: 'ongoing', status: 'in_progress' }, b);

  const all = await callTool('list_tasks', {}, b);
  assert.equal(all.data.length, 2);
  assert.match(all.text, /Today \(1\)[\s\S]*Book the venue[\s\S]*Ongoing \(1\)[\s\S]*Brand guidelines v2/);
  assert.equal((await callTool('list_tasks', { list: 'ongoing' }, b)).data.length, 1);

  const id = add.data.id.slice(0, 8);   // a short id is enough
  const up = await callTool('update_task', { id, status: 'done', list: 'ongoing' }, b);
  assert.equal(up.data.status, 'done');
  assert.equal(up.data.list, 'ongoing');

  assert.equal((await callTool('search_tasks', { query: 'dana' }, b)).data.length, 1);   // in notes
  await callTool('delete_task', { id }, b);
  assert.equal((await callTool('list_tasks', {}, b)).data.length, 1);

  // The file is the app's own format.
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  assert.equal(file.schemaVersion, 1);
  assert.equal(file.tasks.filter((t) => t.deletedAt).length, 1);
});

test('tools: bad input is refused with a reason', async () => {
  const b = fileBackend(tmp());
  await assert.rejects(callTool('add_task', { text: '  ' }, b), /text is required/);
  await assert.rejects(callTool('add_task', { text: 'x', status: 'later' }, b), /status must be one of/);
  await assert.rejects(callTool('update_task', { id: 'nope' }, b), /no task with id/);
  await assert.rejects(callTool('frobnicate', {}, b), /unknown tool/);
  assert.deepEqual(TOOLS.map((t) => t.name), ['list_tasks', 'add_task', 'update_task', 'delete_task', 'search_tasks']);
});

test('bridge: the running app answers over its socket, and openBackend picks it', async () => {
  const dir = tmp();
  const sock = path.join(dir, 'clearday.sock');
  const tasks = [];
  let changes = 0;
  const stop = startBridge(sock, {
    list: () => tasks,
    create: (f) => { const t = { id: `t${tasks.length + 1}`, text: f.text, status: f.status || 'todo', list: f.list || 'today', priority: null, notes: '' }; tasks.push(t); changes++; return t; },
    update: (id, p) => { const t = tasks.find((x) => x.id === id); Object.assign(t, p); changes++; return t; },
    remove: (id) => { tasks.splice(tasks.findIndex((x) => x.id === id), 1); changes++; return {}; },
  });
  await new Promise((r) => setTimeout(r, 50));
  const b = await openBackend(dir);
  assert.equal(b.kind, 'app');
  await callTool('add_task', { text: 'From Claude' }, b);
  await callTool('update_task', { id: 't1', status: 'in_progress' }, b);
  assert.equal(tasks[0].status, 'in_progress');
  assert.equal(changes, 2);
  b.close();
  stop();
  assert.equal((await openBackend(dir)).kind, 'file');   // app gone: the file
});

test('server: speaks MCP over stdio', async () => {
  const dir = tmp();
  const proc = spawn(process.execPath, ['src/mcp/server.mjs'], { env: { ...process.env, CLEARDAY_USER_DATA: dir } });
  const replies = new Map();
  let buf = '';
  proc.stdout.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); }
  });
  const ask = async (id, method, params) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    for (let n = 0; n < 100 && !replies.has(id); n++) await new Promise((r) => setTimeout(r, 20));
    return replies.get(id);
  };
  const init = await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'clearday');
  assert.ok(init.result.capabilities.tools);
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await ask(2, 'tools/list', {});
  assert.equal(list.result.tools.length, 5);
  const add = await ask(3, 'tools/call', { name: 'add_task', arguments: { text: 'Ship 0.6.0' } });
  assert.match(add.result.content[0].text, /Ship 0\.6\.0/);
  const bad = await ask(4, 'tools/call', { name: 'add_task', arguments: {} });
  assert.equal(bad.result.isError, true);
  const nope = await ask(5, 'no/such', {});
  assert.equal(nope.error.code, -32601);
  proc.kill();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).tasks[0].text, 'Ship 0.6.0');
});
