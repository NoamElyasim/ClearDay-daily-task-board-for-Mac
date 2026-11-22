# Due dates (ClearDay 0.13)

## Why
Priority says how much a task matters, but not when it is due. The user wants
an optional deadline on any task, set from a small calendar on the row, so the
board shows when things are due as well.

## Goals
- Any task, on today's board or in Ongoing, can have a due date, or none.
- A task with no date looks the same as it does now.
- A date shows on the row and speaks up as it nears: Today stands out, and a
  late task stands out more.
- Claude and Codex can set, change, clear and read dates.

## Non-goals (maybe later)
- Sorting by due date, and reminders or notifications.
- Times of day: a due date is a day.
- Dates in quick add (⌘⌘) and the widget.
- The phone app (parked until the Apple Developer Program).

## Anti-goals
- Rows that feel busier: nothing new on a row without a date until the pointer
  is over it.
- New colours beyond the one red for a late date.

## Constraints
- No runtime dependencies; vanilla JS ES modules, Electron 44.
- Light and dark, Preferences → Text size, and the compact (narrow) layout.
- The task model stays sync-ready (shared, pure functions in `src/shared/model.mjs`).

## Approaches
1. **The calendar built by hand as one of the app's popovers**, like the
   status and priority pickers. Chosen: it is the only way to match the
   approved drawing.
2. The browser's built-in date picker (`<input type="date">`). Dropped: it
   can't be styled to look like the app.
3. A calendar library. Dropped: ClearDay's first runtime dependency, and it
   would still need restyling.

The date is stored as a plain day (`"2026-11-27"`), not a moment in time, so
it never shifts by a day in another time zone.

## What the user decided
Drawings: `due-dates/index.html` (scratchpad), shown on the canvas and approved.

- **Icon: C, "Days on the page"**: a calendar with a header line and five dots
  for days, on the 16-point grid at the app's 1.5 line weight:
  ```
  <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2.6"/>
  <path d="M5.5 1.9v2.6M10.5 1.9v2.6M2.6 6.8h10.8"/>
  <g fill="currentColor" stroke="none"><circle cx="5.4" cy="9.3" r=".75"/><circle cx="8" cy="9.3" r=".75"/>
  <circle cx="10.6" cy="9.3" r=".75"/><circle cx="5.4" cy="11.7" r=".75"/><circle cx="8" cy="11.7" r=".75"/></g>
  ```
- **The look: 3, "Red when late"**: the label is the icon plus a word, in the
  row's ink.
  - Further off: dimmed (about 70%).
  - Today: full ink, semibold.
  - Late: red (`--danger`) on a light pill (`#FBF8EE`), semibold, in both modes.
- **The calendar**, a popover under the label or icon:
  - Today, Tomorrow and In a week at the top, one click each.
  - The month below with ‹ ›, weekday initials, and the week starting on the
    Mac region's first day (Sunday here).
  - Today has a ring, the chosen day is filled with the accent, the day under
    the pointer or arrow keys gets the menus' soft hover, and past days are
    dimmed but can still be picked.
  - A footer with the chosen date ("Fri 27 Nov") and "Remove date", shown only
    when a date is set.
  - Arrow keys move, Enter picks, Esc or a click outside closes.
- **The label's words**: Today, Tomorrow, the day's short name for the rest of
  the coming week ("Fri"), then the date ("4 Dec"), with the year only when it
  isn't this year ("3 Jan 2027"). Late: Yesterday, then the date.
- **Where it sits**: no date, and the icon fades in with Bold and Delete when
  the pointer is over the row. With a date, the label stays on the row just
  before the priority bookmark, and clicking it opens the calendar.
- **Done tasks**: the label is hidden, as the bookmark is; the date is kept.
- **Ongoing tasks** can have dates too.
- **Narrow window**: the row's ⋯ menu gets "Set due date…" (or "Change due
  date…"), opening the same calendar.
- **Claude and Codex**: `add_task` and `update_task` take `due`.

## My calls (correct any)
- `due` is `"YYYY-MM-DD"` or `null`, validated in `createTask`, `applyPatch`
  and `validateTask`. A string that isn't a real date is dropped. Older tasks
  read as `null`. The schema version stays 1, since the field is only added.
- The label and the month grid come from pure functions in the shared model
  (`dueLabel(due, today)` → `{ text, state: 'later' | 'today' | 'late' }`,
  plus a month-grid helper), so they are unit-tested and a phone app can reuse
  them.
- Labels update at midnight: the row's redraw signature includes today's date,
  and the existing midnight timer redraws the board.
- The calendar opens on the month of the set date, or on this month.
- In "In a week", a week means today + 7 days.
- MCP: `due` takes `"YYYY-MM-DD"`, and `"none"` clears it on update.
  `list_tasks` lines add `· due 2026-11-27 (Fri)`, or `(late)`, and the list
  starts with today's date so Claude can turn "Friday" into a day.
- Search results are unchanged: no date label.
- Export already writes whole tasks, so dates are included.

## Left to the builder
- Making room in the row: the hover tools sit left of a date label when one
  is showing.
- How the label shrinks in the compact layout, provided the text stays
  readable.
- Reading the Mac's first weekday (for example `app.getSystemLocale()` with
  `Intl.Locale` week info), falling back to Sunday.

## Done when
- Unit tests for the model and MCP changes. e2e: set a date from the calendar,
  see the label, change and remove it, and see Today and late with the clock
  shifted.
- Screenshots in light and dark: rows with dates, a hovered row with no date,
  and the open calendar, checked by eye.
- README section and CHANGELOG entry; released as 0.13.0 the usual way, after
  the user tries it.
