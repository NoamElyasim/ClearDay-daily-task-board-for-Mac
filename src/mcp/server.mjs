#!/usr/bin/env node
// ClearDay's MCP server: lets Claude (Claude Code, Claude Desktop) read and
// change the task board. Speaks MCP over stdio (newline-delimited JSON-RPC).
//
// Run by Claude, as ClearDay's own binary in Node mode, so nothing else
// needs installing:
//   ELECTRON_RUN_AS_NODE=1 /Applications/ClearDay.app/Contents/MacOS/ClearDay \
//     /Applications/ClearDay.app/Contents/Resources/app.asar.unpacked/src/mcp/server.mjs
// Preferences → Claude sets this up.
import readline from 'node:readline';
import { TOOLS, callTool } from './tools.mjs';
import { openBackend } from './backend.mjs';

const VERSION = '1';
const INSTRUCTIONS = 'ClearDay is the user\'s daily task board on their Mac. "today" is the day\'s board (To Do, In Progress, Awaiting Approval, On Hold, Done); "ongoing" holds long-term projects with the same statuses. Call list_tasks before changing tasks so you have their ids.';

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle(msg) {
  const { id, method, params = {} } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'clearday', title: 'ClearDay', version: VERSION },
        instructions: INSTRUCTIONS,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call': {
      const backend = await openBackend();
      try {
        const { text, data } = await callTool(params.name, params.arguments || {}, backend);
        return { content: [{ type: 'text', text }], structuredContent: { result: data } };
      } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
      } finally {
        backend.close();
      }
    }
    default:
      if (id === undefined) return undefined;   // a notification we don't need
      throw Object.assign(new Error(`method not found: ${method}`), { code: -32601 });
  }
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch (_) {
    send({ id: null, error: { code: -32700, message: 'parse error' } });
    return;
  }
  try {
    const result = await handle(msg);
    if (msg.id !== undefined && result !== undefined) send({ id: msg.id, result });
  } catch (e) {
    if (msg.id !== undefined) send({ id: msg.id, error: { code: e.code || -32603, message: e.message } });
  }
});
