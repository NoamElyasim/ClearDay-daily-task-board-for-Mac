# Changelog

## v0.10.0 — 2026-11-12

- **Work and Personal.** Two separate boards. A Work | Personal switch
  beside Add and Search flips the whole window: To Do, the sections,
  Ongoing and Done. Your existing tasks are on Work. Search covers both,
  and a task moves between them from its status picker. Claude can list,
  add to and move between both.
- **The widget.** The shrink button in the header turns ClearDay into a
  small pill for adding tasks: a field, Work or Personal, To Do or Ongoing,
  and the number of tasks left today. Drag it anywhere. Its arrows button
  brings the board back.
- **Hide ClearDay.** The eye button in the header hides the window and the
  Dock icon. ClearDay's icon in the menu bar brings it back, and so does
  opening ClearDay again.
- **Tips on the header's buttons.** Rest the pointer on one for two seconds
  and a tip says what it does. It stays until you move away.
- **Quick add keeps its permission.** Updates no longer make ⌘⌘ go silent.
  After this update macOS asks for Input Monitoring one last time: open
  Preferences → Quick task shortcut and press **Ask macOS again**. That
  button also undoes a Deny pressed by mistake.
- Quick add has a briefcase/house button for Work or Personal.
- In the Done tab, the Ongoing tag sits before the task's text, where the
  row's tools no longer cover it.
- The Ongoing tab's To Do group is headed "Ongoing To Do".

## v0.9.0 — 2026-11-11

- **To Do comes first.** The board always shows today, top to bottom: To
  Do, In Progress, Awaiting Approval, On Hold.
- **Ongoing | Done.** The side panel's tabs are now Ongoing, every ongoing
  project grouped by status, and Done, the finished tasks from both lists,
  the latest first. A finished ongoing project carries an Ongoing tag, and
  **Clear done** deletes them all with one Undo. Drag a task onto the Done
  tab to finish it.
- **Add to To Do or Ongoing.** The open Add bar has a To Do | Ongoing
  switch, like quick add's, on To Do each time it opens.
- **Size the side panel.** Drag the edge between the board and the panel;
  past its narrowest it folds away, and a double-click on the edge brings
  back the default width. The width is remembered.
- **Images, files and links in notes.** Paste or drop an image and it shows
  in the note; drop any other file and it becomes a chip, or attach one with
  the paperclip. ClearDay keeps its own copy, so it opens even after the
  original moves. Web addresses become links as you type them, and ⌘K links
  the selected words. Claude sees attachments as [image: name] and
  [file: name], and keeps them when it rewrites a note.
- **Updates tell you.** ClearDay checks GitHub for a new release soon
  after it starts and twice a day. When there is one, a notice says so:
  What's new, Update or Later. Update installs it and restarts ClearDay in
  about a minute, your board kept. Preferences → About has the same
  button, and a Check for updates.
- **Install in one line.** Paste one `curl … | bash` line (see Install in
  the README) into Terminal: it downloads the latest release for your Mac,
  puts ClearDay in Applications and opens it, with no "can't verify"
  warning to click through. Run it again to update.
- **The DMG shows the way.** Its window has an arrow from ClearDay to
  Applications, and a note for the first launch: System Settings → Privacy
  & Security → Open Anyway, or skip that with the one-line install.
- Notarization is wired into the build and switched off until there's an
  Apple Developer account; docs/notarize.md says how to turn it on.

## v0.8.1 — 2026-11-08

- **A new app icon:** three task rows stacked like the board. In Progress
  at the back with a High priority bookmark hanging from its top edge, On
  Hold in the middle, and Done in front with its check.
- **A new film and README.** The film now plays in the app's own dark look,
  and the README shows the features as cards, with a section on talking to
  your board through Claude.

## v0.8.0 — 2026-11-05

- **Pick quick add's shortcut.** ⌘ twice is the default; Preferences →
  Quick task shortcut shows it as keycaps. Click them, then press any key
  twice (⌥, F5, A…) or any combination (⌃T, ⌘⇧K, even ⌘Q). Keys light up
  as you press them and the pill grows to fit; Esc keeps the old one.
- A combination works without the Input Monitoring permission, and is taken
  over from other apps while it's set: ⌘Q opens the bar instead of quitting.
- **One click is enough** when another app is in front: the click that
  brings ClearDay forward also presses the button, ticks the task or opens
  Preferences, instead of only focusing the window.
- **Hover works while another app is active:** buttons and rows light up
  under the pointer even before you click into ClearDay, and only where
  ClearDay is in front: never through another app's window covering it.
- With the side panel hidden, its button sits at the end of the Add | Search
  row, so tasks no longer scroll underneath it.

## v0.7.1 — 2026-11-04

- **Collapse / Expand:** one button, level with the first section
  heading, folds every section, and unfolds them all once they are folded.
- **Select:** beside it, picks several tasks to delete together. Rows show a
  tick circle and a click anywhere on a row picks it; ⌘A picks every task in
  view. Delete removes them with one Undo toast ("3 tasks deleted"), and ⌘Z
  brings them all back. Cancel or Esc leaves selecting.
- The README film shows both: Collapse / Expand, and Select → Delete 2.

## v0.7.0 — 2026-11-04

- **Rich notes:** bold, underline, strikethrough and four text sizes from a
  small menu at the note's side, which folds away to an arrow. Type "- " to
  start a bulleted list; Enter continues it, Backspace on an empty bullet
  ends it.
- The notes card takes the row's rounded shape, without the coloured edge.
- **To Do | Ongoing is a switch** with a sliding knob, like the quick-add bar.
- The side panel button sits beside the tabs, and clears the first row when
  the panel is hidden.
- No pencil button: double-click a task to edit it. Sections fold only from
  their chevron.
- The header fits every width: the weekday gives way first.
- Dark mode: Done's check sits on a dark disc again; grey control tracks.
- **A new README film** showing the new features: the Add button, rich
  notes, cream Light mode and quick add with ⌘⌘.

## v0.6.0 — 2026-11-04

- **Quick add from anywhere:** press ⌘ twice in any app. A rounded bar rises
  above the Dock, in the app's colours, with a priority bookmark and a
  To Do / Ongoing switch. Enter adds the task and the bar fades away;
  ClearDay doesn't come forward. Needs Input Monitoring (asked once).
- **Claude (MCP):** Claude Code and Claude Desktop can read and change the
  board. Connect from Preferences → Claude.
- **Add and Search are buttons** that open into fields with the caret ready.
  Search shows results as you type and jumps to the task.
- **Hide or show the side panel** from a new header button.
- **Light mode is cream** (`#F5F0E0`); **Dark mode has new status colours:**
  mustard, steel blue, terracotta and green.
- Open notes and the unselected side tab sit on a lighter grey than the
  side card in Dark mode.
- Header icons match the light/dark switch; Done's check sits on a white
  disc in Light mode.

## v0.5.0 — 2026-11-03

- **New app icon:** a clear sky with a sun whose centre is a checkmark. The
  icon is now an SVG source (`build/icon.svg`), rendered by `npm run make-icon`.
- **A short film** at the top of the README shows ClearDay at work: add a
  task, start it, prioritize it, fold a section, switch to Light.
- Downloads for both Apple Silicon and Intel Macs.

## v0.4.1 — 2026-11-03

- Done tasks show no priority bookmark.
- The narrow layout's "…" menu drops its Priority section; the bookmark
  already sets it.

## v0.4.0 — 2026-11-03

- **New status colours,** the same in Light and Dark: yellow In Progress,
  blue Awaiting Approval, orange On Hold, green Done. Each has dark text in
  a deeper shade of its own colour.
- **Priority bookmarks.** The ring and the flag button are gone. A red (High)
  or amber (Medium) bookmark hangs from the top of the row; click it to
  change the priority.
- **Ongoing works like today.** With the Ongoing tab open, the board shows
  your ongoing projects by status, and the side keeps their To Do.
- **Fold sections** with the chevron on their heading. Folds are remembered.
- **Light/dark switch** in the header.
- **Move the window from any empty space,** not just the header.
- **Notes:** one open at a time, and a click anywhere else closes it.
- A solid gear icon, and buttons that invert when you point at them.
- **Narrow layout:** the To Do and Ongoing tabs sit on the bottom edge, in the
  same gray, clear of the rows.
- **Fixed:** a selected row's outline was cut off at the panel's edge.

## v0.3.0 — 2026-11-03

- **New look.** The design is flatter, softer and more modern:
  - flat soft-pill rows, with no gloss, inner glow or drop shadows
  - Poppins, bundled with the app
  - a black-and-white interface with pill controls
  - per-mode status palettes: pastels with dark text in Dark mode, earthy
    tones with white text in Light mode
  - edit tools appear over the row on hover, so the text keeps its full
    width
  - priority rings get a solid centre, so they read on any fill
- **Solid background.** White in Light mode and charcoal (`#272727`) in Dark.
  The background opacity and blur settings are gone.
- **Fixed:** the top of the add field and the header buttons (+, sort, gear)
  ignored clicks and hover. The closed Preferences sheet left an invisible
  window-drag area over them. The end-to-end test now checks for that.

## v0.2.1 — 2026-10-27

- **The blur behind the window actually shows.** macOS only blurs behind a
  frameless window that keeps a hidden title bar, so the window now uses one.
  Before this fix the background was see-through but never blurred.
- **Blur style** in Preferences: Subtle, Frosted (the default) or Vivid.
- **Lower default background opacity** (Light 35%, Dark 45%), so the blur can
  be seen. Opacity you set yourself is kept.
- **Plain text in Light mode:** black headings with no white highlight under
  them. In Dark mode the glow behind text is gone.
- Window corners match macOS's own.

## v0.2.0 — 2026-10-27

- **Preferences**, from the gear or ⌘,:
  - Appearance: theme, background opacity (separate for Light and Dark),
    blur behind the window, text size, weekday.
  - Behavior: always on top, Dock or menu bar only, launch at login, sort,
    spell checking in notes.
  - Data: show the data folder, export tasks, reset the window position.
  - A list of keyboard shortcuts.
- **Ongoing list** for long-term projects, in a tab beside To Do (and its own
  edge tab in the narrow layout).
  - Ongoing tasks keep their statuses and stay off today's board.
  - Move tasks between Today and Ongoing from the status picker or by
    dragging them.
- **New status: Awaiting Approval** (light blue). It sits between In
  Progress and On Hold.
- **Notes:**
  - The ≡ button now closes notes as well as opening them, so the X is gone.
  - Right-clicking in a note offers spelling suggestions, Look Up, speech,
    and writing direction (kept per note).
- **The live glass is gone, and with it the Screen Recording prompt.** The
  window now uses the system blur under a background you set yourself.

## v0.1.0 — 2026-10-26

First release.

- Liquid-glass window with Light, Dark and Follow System themes. It uses the
  token widget's refraction shader, with the system blur until Screen
  Recording is allowed.
- Date header in dd/mm/yyyy that rolls over at midnight.
- Tasks with four statuses:
  - the status fills the whole row
  - To Do sits in its own panel
  - In Progress, On Hold and Done are board sections
- High and Medium priority as glowing rings.
- Partial bold (⌘B), edit in place, delete with undo.
- A notes panel under each task: autosaved, resizable, closed by its X.
- Expanded and compact layouts.
- Sorting: by status, priority or creation time, or manual. Drag and drop
  within and between sections.
- Launch at login, always on top, and Dock or menu-bar-only modes.
