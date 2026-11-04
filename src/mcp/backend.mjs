// Where the MCP server reads and writes tasks. With ClearDay running, it asks
// the app over its local socket, so the board updates live and nothing is
// written twice. With the app closed, it edits tasks.json directly, the way
// the app itself does (validated through the shared model, written
// atomically); the app reads it on its next launch.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { migrate, createTask, applyPatch, nextOrder } from '../shared/model.mjs';

export function userDataDir() {
  return process.env.CLEARDAY_USER_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'ClearDay');
}

export const socketPath = (dir = userDataDir()) => path.join(dir, 'clearday.sock');

// ─── The running app ─────────────────────────────────────────────────────────
function connect(sock) {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(sock);
    c.once('connect', () => resolve(c));
    c.once('error', reject);
  });
}

export async function appBackend(sock = socketPath()) {
  const conn = await connect(sock);
  let seq = 0;
  let buf = '';
  const waiting = new Map();
  conn.setEncoding('utf8');
  conn.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      const w = waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error)); else w.resolve(msg.result);
    }
  });
  const fail = (e) => { for (const w of waiting.values()) w.reject(e); waiting.clear(); };
  conn.on('error', fail);
  conn.on('close', () => fail(new Error('ClearDay closed the connection')));
  const call = (method, ...params) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    conn.write(JSON.stringify({ id, method, params }) + '\n');
  });
  return {
    kind: 'app',
    list: () => call('list'),
    create: (fields) => call('create', fields),
    update: (id, patch) => call('update', id, patch),
    remove: (id) => call('remove', id),
    close: () => conn.end(),
  };
}

// ─── The file, with the app closed ───────────────────────────────────────────
export function fileBackend(dir = userDataDir()) {
  const file = path.join(dir, 'tasks.json');
  const read = () => {
    try { return migrate(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) {
      if (e.code === 'ENOENT') return migrate(null);
      throw new Error(`could not read ${file}: ${e.message}`);
    }
  };
  const write = (data) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.mcp-tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  };
  const change = (id, patch) => {
    const data = read();
    const i = data.tasks.findIndex((t) => t.id === id);
    if (i < 0) return null;
    data.tasks[i] = applyPatch(data.tasks[i], patch);
    write(data);
    return data.tasks[i];
  };
  return {
    kind: 'file',
    list: async () => read().tasks.filter((t) => !t.deletedAt),
    create: async (fields) => {
      const data = read();
      const t = createTask({ ...fields, order: nextOrder(data.tasks) });
      data.tasks.push(t);
      write(data);
      return t;
    },
    update: async (id, patch) => change(id, patch),
    remove: async (id) => change(id, { deletedAt: new Date().toISOString() }),
    close: () => {},
  };
}

// The app when it's running, else the file. Asked again for every call, so
// opening or quitting ClearDay mid-conversation just works.
export async function openBackend(dir = userDataDir()) {
  try { return await appBackend(socketPath(dir)); } catch (_) { return fileBackend(dir); }
}
