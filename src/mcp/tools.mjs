// The tools ClearDay offers Claude over MCP, independent of transport and
// storage: each takes its arguments and a backend with list / create /
// update / remove, and returns text for Claude plus the data behind it.
import { STATUSES, STATUS_LABELS, LISTS } from '../shared/model.mjs';

const PRIORITY_IN = { high: 'high', medium: 'medium', none: null };
const LIST_NAMES = { today: 'Today', ongoing: 'Ongoing' };

export const TOOLS = [
  {
    name: 'list_tasks',
    description: 'List the tasks on the ClearDay board. "today" is the daily board (To Do, In Progress, Awaiting Approval, On Hold; done tasks show in the Done tab); "ongoing" is the long-term project list. Each task has an id to use with update_task and delete_task.',
    inputSchema: {
      type: 'object',
      properties: {
        list: { type: 'string', enum: ['today', 'ongoing', 'all'], description: 'Which list (default: all)' },
        status: { type: 'string', enum: STATUSES, description: 'Only tasks with this status' },
      },
    },
  },
  {
    name: 'add_task',
    description: 'Add a task to ClearDay. It lands in To Do unless a status is given.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The task, one line' },
        list: { type: 'string', enum: LISTS, description: 'today (default) or ongoing' },
        status: { type: 'string', enum: STATUSES, description: 'Default: todo' },
        priority: { type: 'string', enum: ['none', 'medium', 'high'], description: 'Default: none' },
        notes: { type: 'string', description: 'Notes shown under the task' },
      },
      required: ['text'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a task: its text, status, priority, list (move between today and ongoing) or notes. Give only what changes.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id (the first 8 characters are enough)' },
        text: { type: 'string' },
        status: { type: 'string', enum: STATUSES },
        priority: { type: 'string', enum: ['none', 'medium', 'high'] },
        list: { type: 'string', enum: LISTS },
        notes: { type: 'string', description: 'Replaces the notes. Images and files attached to them (shown as [image: name] / [file: name]) are kept.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task. It can be restored from ClearDay\'s undo while the app is open.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The task id (the first 8 characters are enough)' } },
      required: ['id'],
    },
  },
  {
    name: 'search_tasks',
    description: 'Find tasks whose text or notes contain the query (case-insensitive), in both lists.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
];

const brief = (t) => ({
  id: t.id, text: t.text, list: t.list || 'today', status: t.status,
  priority: t.priority || 'none', notes: t.notes || '',
});

const line = (t) => `- [${t.id.slice(0, 8)}] ${t.text} · ${STATUS_LABELS[t.status]}${t.priority ? ` · ${t.priority} priority` : ''}${t.notes ? ' · has notes' : ''}`;

function find(tasks, id) {
  const key = String(id || '').trim();
  if (!key) throw new Error('id is required');
  const exact = tasks.find((t) => t.id === key);
  if (exact) return exact;
  const prefixed = tasks.filter((t) => t.id.startsWith(key));
  if (prefixed.length === 1) return prefixed[0];
  throw new Error(prefixed.length ? `id "${key}" matches more than one task` : `no task with id "${key}"`);
}

function check(field, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
}

export async function callTool(name, args = {}, backend) {
  switch (name) {
    case 'list_tasks': {
      const which = args.list || 'all';
      check('list', which, ['today', 'ongoing', 'all']);
      check('status', args.status, STATUSES);
      const tasks = (await backend.list())
        .filter((t) => which === 'all' || (t.list || 'today') === which)
        .filter((t) => !args.status || t.status === args.status);
      const lists = which === 'all' ? LISTS : [which];
      const parts = [];
      for (const l of lists) {
        const mine = tasks.filter((t) => (t.list || 'today') === l);
        parts.push(`${LIST_NAMES[l]} (${mine.length})`);
        for (const s of STATUSES) for (const t of mine.filter((x) => x.status === s)) parts.push(line(t));
      }
      return { text: tasks.length ? parts.join('\n') : 'No tasks.', data: tasks.map(brief) };
    }
    case 'add_task': {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('text is required');
      check('list', args.list, LISTS);
      check('status', args.status, STATUSES);
      check('priority', args.priority, Object.keys(PRIORITY_IN));
      const t = await backend.create({
        text, list: args.list || 'today', status: args.status || 'todo',
        priority: PRIORITY_IN[args.priority || 'none'],
      });
      const done = args.notes ? await backend.update(t.id, { notes: String(args.notes) }) : t;
      return { text: `Added to ${LIST_NAMES[done.list]}:\n${line(done)}`, data: brief(done) };
    }
    case 'update_task': {
      const t = find(await backend.list(), args.id);
      check('status', args.status, STATUSES);
      check('priority', args.priority, Object.keys(PRIORITY_IN));
      check('list', args.list, LISTS);
      const patch = {};
      if (args.text !== undefined) {
        const text = String(args.text).trim();
        if (!text) throw new Error('text cannot be empty');
        if (text !== t.text) { patch.text = text; patch.bold = []; }
      }
      if (args.status !== undefined) patch.status = args.status;
      if (args.priority !== undefined) patch.priority = PRIORITY_IN[args.priority];
      if (args.list !== undefined) patch.list = args.list;
      if (args.notes !== undefined) patch.notes = String(args.notes);
      if (!Object.keys(patch).length) return { text: `Nothing to change:\n${line(t)}`, data: brief(t) };
      const n = await backend.update(t.id, patch);
      return { text: `Updated:\n${line(n)}${n.list !== t.list ? ` (moved to ${LIST_NAMES[n.list]})` : ''}`, data: brief(n) };
    }
    case 'delete_task': {
      const t = find(await backend.list(), args.id);
      await backend.remove(t.id);
      return { text: `Deleted: ${t.text}`, data: { id: t.id } };
    }
    case 'search_tasks': {
      const q = String(args.query || '').trim().toLowerCase();
      if (!q) throw new Error('query is required');
      const hits = (await backend.list()).filter((t) => t.text.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q));
      return {
        text: hits.length ? hits.map((t) => `${line(t)} · ${LIST_NAMES[t.list || 'today']}`).join('\n') : `No tasks match "${args.query}".`,
        data: hits.map(brief),
      };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
