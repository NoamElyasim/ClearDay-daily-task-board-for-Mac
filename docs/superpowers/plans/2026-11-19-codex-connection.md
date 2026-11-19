# Connect ClearDay to Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click Connect in Preferences that adds ClearDay's MCP server to Codex (CLI and the ChatGPT app's Codex), with a Connected status.

**Architecture:** A new main-process module `src/main/codex.mjs` finds a `codex` command and runs `codex mcp add`. With no command, it rewrites `config.toml` itself. It keeps the file-touching parts injectable so unit tests run without Codex. `main.mjs` exposes it over the existing `mcp:*` IPC, and Preferences gets a Codex row in a section renamed "Claude & Codex".

**Tech Stack:** Electron 44 main process (ES modules), vanilla JS renderer, `node:test`, the e2e harness in `tools/e2e/main.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-19-codex-connection-design.md`

## Global Constraints

- No new dependencies (the app has none; no TOML library).
- Server entry name: `clearday`. Env: `ELECTRON_RUN_AS_NODE=1`. Launch: `mcpLaunch()` in `src/main/main.mjs` (command = ClearDay binary, args = [server.mjs]).
- Command run: `codex mcp add clearday --env ELECTRON_RUN_AS_NODE=1 -- <command> <args...>`, via `execFile` (no shell), timeout 15000 ms.
- Codex lookup order: `~/.local/bin/codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, `~/.npm-global/bin/codex`, `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, `~/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`.
- Codex home: `$CODEX_HOME`, else `~/.codex`. Backup name: `config.toml.before-clearday`.
- Copy:
  - Section heading `Claude & Codex`.
  - Intro: `Let Claude or Codex read and update your board: add tasks, change their status, search them.`
  - Row `Codex`, hint: `The Codex app and the codex command. Restart Codex after connecting`.
  - Button states `Connect`, `Connected ✓`, `Couldn't connect`.
- Persisted text (code, comments, docs, commits) in plain full sentences; commits end with the `Claude-Session:` line.

## Review Focus

1. The `codex` command exists but fails (not signed in, broken install, timeout): the button shows "Couldn't connect" with Codex's last output line. ClearDay does not also write the file. Owner: Task 1 (`connectCodex reports a failing codex command and writes nothing`) and Task 2 (e2e failed state).
2. `config.toml` is missing although `~/.codex` exists (fresh install): the fallback creates the file with only ClearDay's entry and makes no backup. Owner: Task 1 (`fallback creates config.toml when there is none`).
3. ClearDay's tables sit between other tables, with comments and other servers around them: the rewrite removes only `mcp_servers.clearday` and `mcp_servers.clearday.*`, and keeps every other line in order. Owner: Task 1 (`withClearday replaces only ClearDay's tables`).
4. ClearDay lives under a path with spaces or quotes: the command gets the path as one argument (array form), and the fallback TOML escapes it. Owner: Task 1 (`paths with spaces and quotes survive`).
5. `CODEX_HOME` is set: status and fallback both use it, not `~/.codex`. Owner: Task 1 (`CODEX_HOME is honoured`).

---

### Task 1: `src/main/codex.mjs`: find, connect, status

**Files:**
- Create: `src/main/codex.mjs`
- Test: `tests/codex.test.mjs`

**Interfaces:**
- Produces (all exported; `io` is injected, with defaults built from `node:fs`, `node:os` and `node:child_process`):
  - `codexCandidates(home: string) -> string[]`: the lookup order above.
  - `findCodex({ home, isExecutable }) -> string | null`.
  - `codexHome({ env, home }) -> string`.
  - `hasClearday(toml: string) -> boolean`: true for a `[mcp_servers.clearday]` or `[mcp_servers."clearday"]` header line.
  - `withClearday(toml: string, launch: { command, args, env }) -> string`.
  - `codexStatus(io?) -> { connected: boolean, available: boolean }`.
    - `available` = a command was found, or the Codex home exists.
  - `connectCodex(launch, io?) -> Promise<{ ok: boolean, via: 'codex' | 'file' | null, error?: string }>`.
- `io` shape: `{ home, env, isExecutable(path), exists(path), readFile(path) -> string|null, writeFile(path, text), copyFile(from, to), mkdir(dir), run(file, args, { env, timeout }) -> Promise<{ code, stdout, stderr }> }`.

- [ ] **Step 1: Write the failing tests** in `tests/codex.test.mjs`, with a fake `io` (an in-memory file map, a recorded `run`):
  - `findCodex prefers the CLI over the ChatGPT app's copy`: both executable → returns `<home>/.local/bin/codex`. Only the ChatGPT one → returns `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. None → `null`.
  - `codexHome uses CODEX_HOME, else ~/.codex`.
  - `hasClearday finds the plain and the quoted header`, and not `[mcp_servers.claredayx]` or a commented `# [mcp_servers.clearday]`.
  - `withClearday replaces only ClearDay's tables`:
    - Input: a comment, `[mcp_servers.other]` with `command = "x"`, an old `[mcp_servers.clearday]` and `[mcp_servers.clearday.env]` block, then `[plugins."a@b"]` with `enabled = true`.
    - Output keeps the comment, `other` and `plugins` lines in order, has exactly one `[mcp_servers.clearday]`, and ends with exactly:
      ```
      [mcp_servers.clearday]
      command = "/Applications/ClearDay.app/Contents/MacOS/ClearDay"
      args = ["/x/server.mjs"]

      [mcp_servers.clearday.env]
      ELECTRON_RUN_AS_NODE = "1"
      ```
  - `paths with spaces and quotes survive`:
    - `withClearday` with command `/Users/a/My "Apps"/ClearDay.app/Contents/MacOS/ClearDay` writes `command = "/Users/a/My \"Apps\"/ClearDay.app/Contents/MacOS/ClearDay"`.
    - `connectCodex` passes that path to `run` as a single array element.
  - `connectCodex runs codex mcp add when a command is found`:
    - `run` receives `(found, ['mcp', 'add', 'clearday', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', command, ...args], { timeout: 15000, env })`.
    - Result `{ ok: true, via: 'codex' }`.
    - No `writeFile` call.
  - `connectCodex reports a failing codex command and writes nothing`: `run` resolves `{ code: 1, stderr: 'Error: not logged in\n' }` → `{ ok: false, via: 'codex', error: 'Error: not logged in' }`, and no `writeFile`.
  - `fallback writes config.toml with a backup when no command is found`: an existing file → `copyFile(config, config + '.before-clearday')`, then `writeFile` with `withClearday(old, launch)` → `{ ok: true, via: 'file' }`.
  - `fallback creates config.toml when there is none`:
    - Codex home exists, file missing.
    - `mkdir`, then write the block alone.
    - No `copyFile`.
  - `CODEX_HOME is honoured`: `env.CODEX_HOME = '/tmp/ch'` → fallback writes `/tmp/ch/config.toml`; `codexStatus` reads it.
  - `codexStatus`:
    - `{ connected: false, available: false }` with no command and no home.
    - `available: true` with the home only.
    - `connected: true` when the file has the header.

- [ ] **Step 2: Run them to see them fail**

Run: `node --test tests/codex.test.mjs`
Expected: FAIL, `Cannot find module '../src/main/codex.mjs'`.

- [ ] **Step 3: Implement `src/main/codex.mjs`**
  - `withClearday` is line-based. A header line matches `^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$`. Normalize the name by removing quotes around `clearday`. Skip every line from a header named `mcp_servers.clearday` or `mcp_servers.clearday.*` up to the next header.
  - Trim trailing blank lines, then append one blank line and the block. Escape values with `JSON.stringify`.
  - `error` is the last non-empty line of `stderr`, else of `stdout`, else `codex exited with code N`. A timeout gives `Codex took too long to answer`.
  - With no command and no Codex home, `connectCodex` returns `{ ok: false, via: null, error: 'Codex is not installed' }`.
  - The header comment explains why a GUI app needs the fixed lookup list (no shell `PATH`).

- [ ] **Step 4: Run them to see them pass**

Run: `node --test tests/codex.test.mjs && npm test`
Expected: all pass (49 existing + the new ones).

- [ ] **Step 5: Commit**: `git add src/main/codex.mjs tests/codex.test.mjs` and commit with the message "Codex: find it, connect ClearDay to it, tell whether it is connected".

### Task 2: Preferences row and IPC

**Files:**
- Modify: `src/main/main.mjs` (the `// ─── Claude (MCP)` block: `mcp:status`, add `mcp:connect-codex`; rename the block comment to "Claude and Codex (MCP)")
- Modify: `src/preload.cjs` (`mcp.connectCodex`)
- Modify: `src/renderer/prefs.js` (Claude section)
- Modify: `tools/e2e/main.mjs`, `tools/shots/main.mjs` (stubs)

**Interfaces:**
- Consumes: `codexStatus()`, `connectCodex(launch)` from Task 1; `mcpLaunch()` in main.mjs.
- Produces:
  - `mcp:status` also returns `codex: boolean, codexAvailable: boolean`.
  - `mcp:connect-codex` returns `{ ok, via, error? }`.
  - Renderer `api.mcp.connectCodex()`.

- [ ] **Step 1: Write the failing e2e checks** in `tools/e2e/main.mjs`.
  - Stubs: make `mcp:status` read a mutable `codexStub = { codex: false, codexAvailable: true }`. `mcp:connect-codex` returns `codexResult` and sets `codexStub.codex = codexResult.ok`.
  - In the Preferences part:
    - `the Claude section is headed Claude & Codex and says what it does`: the section's `h3` text is `Claude & Codex`, and its intro is the exact copy.
    - `Codex shows Connect when it is not connected`: the row labelled `Codex` has an enabled button reading `Connect`, and hint `The Codex app and the codex command. Restart Codex after connecting`.
    - `Connect asks the app and then reads Connected ✓` (`codexResult = { ok: true, via: 'codex' }`).
    - `a failed connect says so, with Codex's own words`: with `codexResult = { ok: false, via: 'codex', error: 'Error: not logged in' }`, the button reads `Couldn't connect` and a note under the row shows `Error: not logged in`.
    - `without Codex the button is disabled`: `codexAvailable: false` → disabled, title `Install Codex or the ChatGPT app first`.

- [ ] **Step 2: Run to see them fail**

Run: `npm run e2e 2>&1 | grep -E "FAIL|check\(s\)"`
Expected: the five new checks FAIL.

- [ ] **Step 3: Implement**
  - In main.mjs: import from `./codex.mjs`, extend `mcp:status`, add `mcp:connect-codex` (`connectCodex(mcpLaunch())`).
  - In preload: add `connectCodex`.
  - In prefs.js:
    - Retitle the section and its intro.
    - Add `row('Codex', codexBtn, hint)` after Claude Code, with a hidden `pref-note` under it for errors.
    - `refreshClaude()` sets the Codex button from the status.
    - Add the same stub fields to `tools/shots/main.mjs`.

- [ ] **Step 4: Run e2e and shots**

Run: `npm run e2e 2>&1 | grep -E "FAIL|all checks"` → `all checks passed`.
Then run `npx electron tools/shots/main.mjs prefs-dark`, Read the PNG, and confirm the section reads Claude & Codex with three rows.

- [ ] **Step 5: Commit** with the message "Preferences: connect Codex in one click".

### Task 3: Words, version, film

**Files:**
- Modify: `src/mcp/server.mjs`, `src/mcp/tools.mjs` (header comments: "Claude or Codex")
- Modify: `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` (lines 3 and 9)
- Video (not in git): `Video/tools/capture-ui.mjs`, `Video/tools/build-app.mjs`, render

- [ ] **Step 1: Update the README.**
  - Retitle the Claude section to say Claude or Codex.
  - Change "Connect in one click: **Preferences → Claude**" to "Preferences → Claude & Codex", naming the Codex button.
  - Add the manual Codex command next to the Claude Code one:
    ```
    codex mcp add clearday --env ELECTRON_RUN_AS_NODE=1 -- \
      /Applications/ClearDay.app/Contents/MacOS/ClearDay \
      /Applications/ClearDay.app/Contents/Resources/app.asar.unpacked/src/mcp/server.mjs
    ```
  - The feature list's "Works with Claude" becomes "Works with Claude and Codex".
- [ ] **Step 2: Version and changelog.** Version 0.12.0. Add a CHANGELOG `## v0.12.0 — <date>` entry: Codex connects from Preferences in one click, covering the codex command and Codex in the ChatGPT app.
- [ ] **Step 3: Film.**
  - Re-run `npx electron Video/tools/capture-ui.mjs`.
  - Add a `mcp:status` stub with `codex: false, codexAvailable: true` there if missing.
  - Run `node Video/tools/scope-css.mjs` and `node Video/tools/build-app.mjs`, then `npx --yes hyperframes@0.9.8 check`.
  - Snapshot the Customize beat (`--at 28.6,29.8`) and confirm the section shows Claude & Codex.
  - Render `Video/renders/ClearDay-film-v10.mp4` and regenerate `docs/film.gif`. Update the README film link to `v0.12.0`.
- [ ] **Step 4: Verify**: run `npm test && npm run e2e`; both pass.
- [ ] **Step 5: Commit** with the message "ClearDay 0.12.0: Codex in the README, changelog and film".

### Task 4: Real check and release (needs the user)

- [ ] **Step 1:** Run `npm run dist:mac`. Check with `hdiutil`, `lipo`, and `codesign -dr -` (`certificate leaf`). Install a copy, then press Connect in its Preferences.
- [ ] **Step 2:** Run `codex mcp get clearday --json`. Expected: the stdio command is the installed ClearDay binary.
- [ ] **Step 3:** With the user's OK only, run `codex exec "List my ClearDay tasks for today"`. Expected: it calls `clearday` `list_tasks` and names real tasks.
- [ ] **Step 4:** With the user's OK only: fast-forward `main`, push, `gh release create v0.12.0 --latest`, attaching both DMGs and `ClearDay-film.mp4`.
