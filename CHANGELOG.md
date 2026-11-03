# Changelog

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
