// Codex: connecting ClearDay's MCP server to it, and telling whether it is.
// One entry covers the codex command and Codex inside the ChatGPT desktop
// app: both read $CODEX_HOME/config.toml (~/.codex by default).
//
// Codex writes its own settings: ClearDay finds a codex command and runs
// `codex mcp add`, which also replaces an older entry. Only when there is no
// codex command does ClearDay write the entry itself, keeping a copy of the
// file as it was.
//
// A GUI app does not get the shell's PATH, so the command is looked for in
// the places Codex installs it: the CLI first (usually the newer one), then
// the copy inside the ChatGPT app.
//
// No Electron here, so the tests run in plain Node; everything that touches
// the disk or runs a program comes in through `io`.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'clearday';
const TIMEOUT_MS = 15000;
const BACKUP = '.before-clearday';

export function codexCandidates(home) {
  const inChatGPT = 'ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
  return [
    path.join(home, '.local/bin/codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(home, '.npm-global/bin/codex'),
    path.join('/Applications', inChatGPT),
    path.join(home, 'Applications', inChatGPT),
  ];
}

export function findCodex({ home, isExecutable }) {
  return codexCandidates(home).find((p) => isExecutable(p)) || null;
}

export function codexHome({ env, home }) {
  return env.CODEX_HOME || path.join(home, '.codex');
}

// A table header's name with the quotes around each key taken off, so that
// mcp_servers."clearday" reads as mcp_servers.clearday. Quoted keys may hold
// ] or # (a project path, say). null if the line is not a header.
const HEADER = /^\s*\[\[?\s*((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\]"'#])+?)\s*\]\]?\s*(#.*)?$/;
function headerName(line) {
  const m = line.match(HEADER);
  return m ? m[1].replace(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g, (_, d, q) => d ?? q).replace(/\s*\.\s*/g, '.') : null;
}

// Whether the next line starts inside a multi-line string ("""…""" or
// '''…'''), given whether this one did: a line in such a string is never
// a header, however it looks.
function stringAfter(line, open) {
  let state = open;
  let rest = line;
  for (;;) {
    if (state) {
      const end = rest.indexOf(state);
      if (end < 0) return state;
      rest = rest.slice(end + 3);
      state = null;
    } else {
      const d = rest.indexOf('"""'), q = rest.indexOf("'''");
      if (d < 0 && q < 0) return null;
      const at = d < 0 ? q : q < 0 ? d : Math.min(d, q);
      state = rest.slice(at, at + 3);
      rest = rest.slice(at + 3);
    }
  }
}

// Each line with the header it is (null when it is none).
function headers(toml) {
  let open = null;
  return toml.split('\n').map((line) => {
    const name = open ? null : headerName(line);
    open = stringAfter(line, open);
    return [line, name];
  });
}

const isOurs = (name) => name === `mcp_servers.${NAME}` || name?.startsWith(`mcp_servers.${NAME}.`);

export function hasClearday(toml) {
  return headers(toml).some(([, name]) => name === `mcp_servers.${NAME}`);
}

// The entry as `codex mcp add` writes it.
function block({ command, args, env }) {
  const q = (s) => JSON.stringify(String(s));
  const lines = [`[mcp_servers.${NAME}]`, `command = ${q(command)}`, `args = [${args.map(q).join(', ')}]`, ''];
  const vars = Object.entries(env || {});
  if (vars.length) lines.push(`[mcp_servers.${NAME}.env]`, ...vars.map(([k, v]) => `${k} = ${q(v)}`), '');
  return lines.join('\n');
}

// The file with ClearDay's tables (mcp_servers.clearday and any
// mcp_servers.clearday.*) taken out wherever they were, every other line
// kept in its place, and the entry added at the end.
export function withClearday(toml, launch) {
  let skipping = false;
  const kept = [];
  for (const [line, name] of headers(toml)) {
    if (name !== null) skipping = isOurs(name);
    if (!skipping) kept.push(line);
  }
  const rest = kept.join('\n').replace(/\s+$/, '');
  return rest ? `${rest}\n\n${block(launch)}` : block(launch);
}

const defaultIo = () => ({
  home: os.homedir(),
  env: process.env,
  isExecutable: (p) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch (_) { return false; } },
  exists: (p) => fs.existsSync(p),
  // null when there is no such file; any other failure throws.
  readFile: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
  writeFile: (p, text) => fs.writeFileSync(p, text),
  copyFile: (from, to) => fs.copyFileSync(from, to),
  mkdir: (d) => fs.mkdirSync(d, { recursive: true }),
  run: (file, args, { env, timeout }) => new Promise((resolve) => {
    execFile(file, args, { env, timeout }, (err, stdout, stderr) => resolve({
      // A program that could not start at all (ENOENT, EACCES) counts as 127,
      // as a shell would report it.
      code: err ? (typeof err.code === 'number' ? err.code : err.killed ? null : 127) : 0,
      timedOut: !!err?.killed,
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
    }));
  }),
});

const configOf = (io) => path.join(codexHome(io), 'config.toml');

// connected: Codex's settings have ClearDay. available: there is a Codex to
// connect to (a codex command, or Codex's settings folder).
export function codexStatus(io = defaultIo()) {
  let text = null;
  try { text = io.readFile(configOf(io)); } catch (_) { /* unreadable: not connected as far as ClearDay can tell */ }
  return {
    connected: !!text && hasClearday(text),
    available: !!findCodex(io) || io.exists(codexHome(io)),
  };
}

// The environment codex runs in. An app opened from the Dock gets only the
// system PATH, and an npm-installed codex is a script that runs `env node`:
// codex's own folder and the usual Homebrew ones come first.
function runEnv(codex, env) {
  const dirs = [path.dirname(codex), '/opt/homebrew/bin', '/usr/local/bin', ...String(env.PATH || '').split(':')].filter(Boolean);
  return { ...env, PATH: [...new Set(dirs)].join(':') };
}

const lastLine = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop();

// launch: { command, args, env }, as ClearDay's own mcpLaunch() gives it.
// → { ok, via: 'codex' | 'file' | null, error? }
export async function connectCodex(launch, io = defaultIo()) {
  const commands = codexCandidates(io.home).filter((p) => io.isExecutable(p));
  if (commands.length) {
    const envArgs = Object.entries(launch.env || {}).flatMap(([k, v]) => ['--env', `${k}=${v}`]);
    let r = null;
    for (const codex of commands) {
      r = await io.run(codex, ['mcp', 'add', NAME, ...envArgs, '--', launch.command, ...launch.args], { env: runEnv(codex, io.env), timeout: TIMEOUT_MS });
      if (r.code === 0) return { ok: true, via: 'codex' };
      // 127: this copy could not even start (no node for an npm script, say);
      // the next one may. Any other failure is Codex's answer.
      if (r.code !== 127) break;
    }
    const error = r.timedOut ? 'Codex took too long to answer'
      : lastLine(r.stderr) || lastLine(r.stdout) || `codex exited with code ${r.code}`;
    return { ok: false, via: 'codex', error };
  }
  const dir = codexHome(io);
  if (!io.exists(dir)) return { ok: false, via: null, error: 'Codex is not installed' };
  const file = configOf(io);
  try {
    const old = io.readFile(file);
    if (old === null) io.mkdir(dir);
    else io.copyFile(file, file + BACKUP);
    io.writeFile(file, withClearday(old || '', launch));
  } catch (e) {
    return { ok: false, via: 'file', error: e.message };
  }
  return { ok: true, via: 'file' };
}
