import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexCandidates, findCodex, codexHome, hasClearday, withClearday, codexStatus, connectCodex } from '../src/main/codex.mjs';

const HOME = '/Users/a';
const CHATGPT_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const LAUNCH = {
  command: '/Applications/ClearDay.app/Contents/MacOS/ClearDay',
  args: ['/x/server.mjs'],
  env: { ELECTRON_RUN_AS_NODE: '1' },
};
const BLOCK = [
  '[mcp_servers.clearday]',
  'command = "/Applications/ClearDay.app/Contents/MacOS/ClearDay"',
  'args = ["/x/server.mjs"]',
  '',
  '[mcp_servers.clearday.env]',
  'ELECTRON_RUN_AS_NODE = "1"',
  '',
].join('\n');

// A Mac in memory: files, executables, folders, and what was run.
function fakeIo({ files = {}, executables = [], dirs = [], env = {}, result = { code: 0, stdout: '', stderr: '' } } = {}) {
  const io = {
    home: HOME,
    env,
    files: { ...files },
    dirs: new Set(dirs),
    runs: [], writes: [], copies: [], mkdirs: [],
    isExecutable: (p) => executables.includes(p),
    exists: (p) => p in io.files || io.dirs.has(p),
    readFile: (p) => (p in io.files ? io.files[p] : null),
    writeFile: (p, text) => { io.writes.push(p); io.files[p] = text; },
    copyFile: (from, to) => { io.copies.push([from, to]); io.files[to] = io.files[from]; },
    mkdir: (d) => { io.mkdirs.push(d); io.dirs.add(d); },
    run: async (file, args, opts) => { io.runs.push({ file, args, opts }); return result; },
  };
  return io;
}

test('the lookup order is the CLI first, then the ChatGPT app\'s copy', () => {
  assert.deepEqual(codexCandidates(HOME), [
    `${HOME}/.local/bin/codex`,
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    `${HOME}/.npm-global/bin/codex`,
    CHATGPT_CODEX,
    `${HOME}/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`,
  ]);
});

test('findCodex prefers the CLI over the ChatGPT app\'s copy', () => {
  const both = [`${HOME}/.local/bin/codex`, CHATGPT_CODEX];
  assert.equal(findCodex({ home: HOME, isExecutable: (p) => both.includes(p) }), `${HOME}/.local/bin/codex`);
  assert.equal(findCodex({ home: HOME, isExecutable: (p) => p === CHATGPT_CODEX }), CHATGPT_CODEX);
  assert.equal(findCodex({ home: HOME, isExecutable: () => false }), null);
});

test('codexHome uses CODEX_HOME, else ~/.codex', () => {
  assert.equal(codexHome({ env: { CODEX_HOME: '/tmp/ch' }, home: HOME }), '/tmp/ch');
  assert.equal(codexHome({ env: {}, home: HOME }), `${HOME}/.codex`);
});

test('hasClearday finds the plain and the quoted header', () => {
  assert.equal(hasClearday('[mcp_servers.clearday]\ncommand = "x"\n'), true);
  assert.equal(hasClearday('a = 1\n  [mcp_servers."clearday"]\n'), true);
  assert.equal(hasClearday('[mcp_servers.claredayx]\n'), false);
  assert.equal(hasClearday('[mcp_servers.cleardayx]\n'), false);
  assert.equal(hasClearday('# [mcp_servers.clearday]\n'), false);
  assert.equal(hasClearday(''), false);
});

test('withClearday replaces only ClearDay\'s tables', () => {
  const before = [
    '# my settings',
    'model = "gpt-6.1-sol"',
    '',
    '[mcp_servers.other]',
    'command = "x"',
    '',
    '[mcp_servers.clearday]',
    'command = "/old/ClearDay"',
    'args = ["/old/server.mjs"]',
    '',
    '[mcp_servers.clearday.env]',
    'ELECTRON_RUN_AS_NODE = "1"',
    '',
    '[plugins."a@b"]',
    'enabled = true',
    '',
  ].join('\n');
  const after = withClearday(before, LAUNCH);
  const lines = after.split('\n');
  const order = ['# my settings', 'model = "gpt-6.1-sol"', '[mcp_servers.other]', 'command = "x"', '[plugins."a@b"]', 'enabled = true']
    .map((l) => lines.indexOf(l));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), `kept in order: ${order}`);
  assert.equal(after.match(/^\[mcp_servers\.clearday\]$/gm).length, 1);
  assert.ok(!after.includes('/old/'));
  assert.ok(after.endsWith('\n\n' + BLOCK), after);
});

test('withClearday on an empty file writes the block alone', () => {
  assert.equal(withClearday('', LAUNCH), BLOCK);
});

test('paths with spaces and quotes survive', async () => {
  const odd = { ...LAUNCH, command: '/Users/a/My "Apps"/ClearDay.app/Contents/MacOS/ClearDay' };
  assert.ok(withClearday('', odd).includes('command = "/Users/a/My \\"Apps\\"/ClearDay.app/Contents/MacOS/ClearDay"'));
  const io = fakeIo({ executables: [CHATGPT_CODEX] });
  await connectCodex(odd, io);
  assert.ok(io.runs[0].args.includes(odd.command));
});

test('connectCodex runs codex mcp add when a command is found', async () => {
  const io = fakeIo({ executables: [CHATGPT_CODEX], env: { PATH: '/usr/bin' } });
  const r = await connectCodex(LAUNCH, io);
  assert.deepEqual(r, { ok: true, via: 'codex' });
  assert.equal(io.runs.length, 1);
  assert.equal(io.runs[0].file, CHATGPT_CODEX);
  assert.deepEqual(io.runs[0].args, ['mcp', 'add', 'clearday', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', LAUNCH.command, '/x/server.mjs']);
  assert.equal(io.runs[0].opts.timeout, 15000);
  assert.deepEqual(io.writes, []);
});

test('the codex command runs with a PATH that finds node', async () => {
  // An app opened from the Dock gets only the system PATH, and an npm-installed
  // codex is a script that runs `env node`.
  const io = fakeIo({ executables: ['/opt/homebrew/bin/codex'], env: { PATH: '/usr/bin:/bin', LANG: 'he_IL.UTF-8' } });
  await connectCodex(LAUNCH, io);
  const env = io.runs[0].opts.env;
  assert.equal(env.LANG, 'he_IL.UTF-8');
  assert.deepEqual(env.PATH.split(':').slice(0, 3), ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']);
  assert.ok(env.PATH.endsWith('/usr/bin:/bin'));
  assert.equal(io.env.PATH, '/usr/bin:/bin');
});

test('a codex that cannot start falls through to the next one', async () => {
  const io = fakeIo({ executables: ['/opt/homebrew/bin/codex', CHATGPT_CODEX] });
  const answers = [{ code: 127, stdout: '', stderr: 'env: node: No such file or directory\n' }, { code: 0, stdout: '', stderr: '' }];
  io.run = async (file, args, opts) => { io.runs.push({ file, args, opts }); return answers.shift(); };
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: true, via: 'codex' });
  assert.deepEqual(io.runs.map((r) => r.file), ['/opt/homebrew/bin/codex', CHATGPT_CODEX]);
});

test('when every codex fails to start, the last one\'s words are reported', async () => {
  const io = fakeIo({ executables: ['/opt/homebrew/bin/codex'], result: { code: 127, stdout: '', stderr: 'env: node: No such file or directory\n' } });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'codex', error: 'env: node: No such file or directory' });
  assert.deepEqual(io.writes, []);
});

test('connectCodex reports a failing codex command and writes nothing', async () => {
  const io = fakeIo({ executables: [CHATGPT_CODEX], dirs: [`${HOME}/.codex`], result: { code: 1, stdout: '', stderr: 'Starting\nError: not logged in\n' } });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'codex', error: 'Error: not logged in' });
  assert.deepEqual(io.writes, []);
});

test('a codex command that says nothing still gets a reason', async () => {
  const io = fakeIo({ executables: [CHATGPT_CODEX], result: { code: 3, stdout: '', stderr: '' } });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'codex', error: 'codex exited with code 3' });
});

test('a codex command that takes too long is reported', async () => {
  const io = fakeIo({ executables: [CHATGPT_CODEX], result: { code: null, timedOut: true, stdout: '', stderr: '' } });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'codex', error: 'Codex took too long to answer' });
});

test('fallback writes config.toml with a backup when no command is found', async () => {
  const cfg = `${HOME}/.codex/config.toml`;
  const old = '[mcp_servers.other]\ncommand = "x"\n';
  const io = fakeIo({ files: { [cfg]: old }, dirs: [`${HOME}/.codex`] });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: true, via: 'file' });
  assert.deepEqual(io.copies, [[cfg, `${cfg}.before-clearday`]]);
  assert.equal(io.files[`${cfg}.before-clearday`], old);
  assert.equal(io.files[cfg], withClearday(old, LAUNCH));
  assert.deepEqual(io.runs, []);
});

test('fallback creates config.toml when there is none', async () => {
  const io = fakeIo({ dirs: [`${HOME}/.codex`] });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: true, via: 'file' });
  assert.deepEqual(io.mkdirs, [`${HOME}/.codex`]);
  assert.deepEqual(io.copies, []);
  assert.equal(io.files[`${HOME}/.codex/config.toml`], BLOCK);
});

test('without Codex at all, nothing is written', async () => {
  const io = fakeIo();
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: null, error: 'Codex is not installed' });
  assert.deepEqual(io.writes, []);
});

test('CODEX_HOME is honoured', async () => {
  const io = fakeIo({ env: { CODEX_HOME: '/tmp/ch' }, dirs: ['/tmp/ch'] });
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: true, via: 'file' });
  assert.ok('/tmp/ch/config.toml' in io.files);
  assert.ok(!(`${HOME}/.codex/config.toml` in io.files));
  assert.deepEqual(codexStatus(io), { connected: true, available: true });
});

test('codexStatus says whether Codex is there and connected', () => {
  assert.deepEqual(codexStatus(fakeIo()), { connected: false, available: false });
  assert.deepEqual(codexStatus(fakeIo({ dirs: [`${HOME}/.codex`] })), { connected: false, available: true });
  assert.deepEqual(codexStatus(fakeIo({ executables: [CHATGPT_CODEX] })), { connected: false, available: true });
  assert.deepEqual(codexStatus(fakeIo({ dirs: [`${HOME}/.codex`], files: { [`${HOME}/.codex/config.toml`]: BLOCK } })), { connected: true, available: true });
});

test('a quoted table name with a bracket is kept', () => {
  const before = '[mcp_servers.clearday]\ncommand = "/old"\n\n[projects."/Users/a/[old] work"]\ntrust_level = "trusted"\n';
  const after = withClearday(before, LAUNCH);
  assert.ok(after.includes('[projects."/Users/a/[old] work"]\ntrust_level = "trusted"'), after);
  assert.ok(!after.includes('/old"'));
});

test('a multi-line string that looks like a header is left alone', () => {
  const before = 'notes = """\n[mcp_servers.clearday]\nnot a table\n"""\nmodel = "x"\n';
  assert.equal(hasClearday(before), false);
  const after = withClearday(before, LAUNCH);
  assert.ok(after.startsWith(before.trimEnd()), after);
  assert.ok(after.endsWith(BLOCK));
});

test('a fallback that cannot write says why and changes nothing else', async () => {
  const cfg = `${HOME}/.codex/config.toml`;
  const io = fakeIo({ files: { [cfg]: 'model = "x"\n' }, dirs: [`${HOME}/.codex`] });
  io.writeFile = () => { throw new Error("EACCES: permission denied, open '/Users/a/.codex/config.toml'"); };
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'file', error: "EACCES: permission denied, open '/Users/a/.codex/config.toml'" });
});

test('an unreadable config.toml is never overwritten', async () => {
  const io = fakeIo({ dirs: [`${HOME}/.codex`] });
  io.readFile = () => { throw new Error('EACCES: permission denied'); };
  assert.deepEqual(await connectCodex(LAUNCH, io), { ok: false, via: 'file', error: 'EACCES: permission denied' });
  assert.deepEqual(io.writes, []);
  assert.deepEqual(io.copies, []);
});

test('codexStatus never throws, even on an unreadable config.toml', () => {
  const io = fakeIo({ dirs: [`${HOME}/.codex`] });
  io.readFile = () => { throw new Error('EACCES: permission denied'); };
  assert.deepEqual(codexStatus(io), { connected: false, available: true });
});
