# Connect ClearDay to Codex — short design

## Intent

ClearDay already lets Claude read and change the board (Preferences → Claude: Claude Desktop,
Claude Code). The user works in Codex too and wants the same there: Codex can list, add, update,
move, search and delete tasks on either board.

OpenAI's dot was asked for as well and is out of scope for now. Dots run in OpenAI's cloud, and
OpenAI documents no way to give a dot a custom MCP server. The only possible route is a ClearDay
plugin in the ChatGPT desktop app, and whether a dot can use it is undocumented. That can be
tested later on its own.

## Goals

- A one-click **Connect** for Codex in Preferences. One entry covers the `codex` command and Codex
  inside the ChatGPT desktop app, since both read `~/.codex/config.toml`.
- Preferences shows whether Codex is connected, as it does for Claude.
- Pressing it again refreshes the entry (for example if ClearDay moved).

## Non-goals

- Dots.
- A disconnect button (Claude has none either).
- Any change to the MCP server's tools. Codex speaks the same protocol.

## Anti-goals

- ClearDay hand-editing Codex's settings when Codex can write them itself.
- Breaking or losing any other Codex setting.

## Approaches

1. **Codex adds ClearDay itself (picked).** ClearDay finds a `codex` command and runs
   `codex mcp add clearday --env ELECTRON_RUN_AS_NODE=1 -- <ClearDay binary> <server.mjs>`.
   Codex writes its own file. Checked against a scratch `CODEX_HOME`: it writes
   `[mcp_servers.clearday]` plus its `.env` table, keeps other servers, and running it again
   replaces the entry.
2. **ClearDay edits `config.toml` directly**, with a backup. Works with no `codex` command around,
   but edits a file that holds the user's other settings without a TOML parser. Kept only as the
   fallback for option 1.
3. **Copy a Terminal command**, like the Claude Code button. Safest, but an extra step most
   ChatGPT-app users never take.

The user picked option 1.

## How

**Finding Codex** (main process, new `src/main/codex.mjs`). The first executable found among:
1. the Codex CLI: `~/.local/bin/codex`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`,
   `~/.npm-global/bin/codex`;
2. the copy bundled in the ChatGPT app:
   `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, or the same under
   `~/Applications`.

The CLI comes first because it is usually the newer one. Both write the same file. A GUI app
does not get the shell's `PATH`, hence the fixed list.

**Connecting.** Run option 1's command with `execFile` and a 15 s timeout. If no `codex` command
is found, fall back to writing the entry into `$CODEX_HOME/config.toml` (default `~/.codex`):
- copy the file to `config.toml.before-clearday`;
- drop any existing `[mcp_servers.clearday]` and `[mcp_servers.clearday.env]` tables;
- append the same three lines Codex writes.

The text rewrite is a pure function, unit-tested.

**Status.** Connected when `config.toml` has a `[mcp_servers.clearday]` table. Codex counts as
present when a `codex` command is found or `~/.codex` exists. Otherwise the button is disabled
with a hint to install Codex or the ChatGPT app.

**Failure.** The button says "Couldn't connect", and the note under it shows Codex's own last
line of output.

**Preferences** (my call; the user can change it):
- The section is headed **Claude & Codex**.
- Intro: "Let Claude or Codex read and update your board: add tasks, change their status, search
  them."
- A third row, **Codex**, with Connect / Connected ✓ and the hint "The Codex app and the codex
  command. Restart Codex after connecting".

**Elsewhere:**
- The MCP server's comments and the README say "Claude or Codex" where they mean any assistant.
- The README's Claude section gains a short Codex part, with the manual command.
- The Claude demo film stays as it is.
- The README film's Customize beat shows this Preferences section, so it is captured and
  rendered again with the new section. Its timing does not change.

**Tests:**
- Unit: finding Codex (injected file checks), the `config.toml` rewrite, status parsing.
- e2e: the Codex row's states (absent, connect, connected, failed) through stubbed IPC.

**Real check.** On the packaged build: press Connect, then confirm `codex mcp get clearday`
shows the entry. Then ask Codex once (`codex exec`, which uses the user's Codex account, so only
with their OK) to list today's tasks.

**Release.** 0.12.0, after the user tries it. It also carries the fix that stops tracking
`.agent-grid/`.

## Left to the builder

The exact wording of the failure note, and the order of the rows in the section.
