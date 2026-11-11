// Line icons, drawn on a 16px grid to sit with SF text. Static strings only;
// nothing user-supplied ever goes through innerHTML.
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

// Solid glyphs, for the gear and the theme switch.
const svgFill = (body) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  // A solid gear: eight teeth round a body with a round hole.
  gear: svgFill('<path d="M6.48 3.03L6.79 1.16L9.21 1.16L9.52 3.03ZM10.44 3.41L11.99 2.31L13.69 4.01L12.59 5.56ZM12.97 6.48L14.84 6.79L14.84 9.21L12.97 9.52ZM12.59 10.44L13.69 11.99L11.99 13.69L10.44 12.59ZM9.52 12.97L9.21 14.84L6.79 14.84L6.48 12.97ZM5.56 12.59L4.01 13.69L2.31 11.99L3.41 10.44ZM3.03 9.52L1.16 9.21L1.16 6.79L3.03 6.48ZM3.41 5.56L2.31 4.01L4.01 2.31L5.56 3.41Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path fill-rule="evenodd" d="M8 2.4a5.6 5.6 0 1 0 0 11.2a5.6 5.6 0 1 0 0-11.2ZM8 5.55a2.45 2.45 0 1 1 0 4.9a2.45 2.45 0 1 1 0-4.9Z"/>'),
  sort: svg('<path d="M5 3v10M2.8 5.2 5 3l2.2 2.2M11 13V3M8.8 10.8 11 13l2.2-2.2"/>'),
  pencil: svg('<path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 2.1L5.4 12.3l-2.9.8.8-2.9z"/><path d="m9.6 3.9 2.1 2.1"/>'),
  bold: svg('<path d="M4.5 2.8h4.1a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 8h4.8a2.6 2.6 0 0 1 0 5.2H4.5z" stroke-width="1.7"/>'),
  trash: svg('<path d="M2.8 4.3h10.4M6.4 4.3V2.8h3.2v1.5M4.2 4.3l.6 8.9h6.4l.6-8.9M6.7 6.8v4M9.3 6.8v4"/>'),
  notes: svg('<path d="M3 4.5h10M3 8h10M3 11.5h10"/>'),
  // A window with its side panel on the right; the chevron points the way
  // the panel will move.
  sidebar: svg('<rect x="1.75" y="2.25" width="12.5" height="11.5" rx="2.6"/><path d="M10.2 2.5v11"/><path class="chev" d="m5.4 5.9 2.1 2.1-2.1 2.1"/>'),
  search: svg('<circle cx="7" cy="7" r="4.4"/><path d="m10.3 10.3 3.2 3.2"/>', ' stroke-width="1.7"'),
  // Select: a ticked circle.
  select: svg('<circle cx="8" cy="8" r="5.7"/><path d="m5.5 8.2 1.7 1.7 3.3-3.5"/>'),
  chevron: svg('<path d="m4.5 6.2 3.5 3.6 3.5-3.6"/>', ' stroke-width="1.8"'),
  sun: svg('<circle cx="8" cy="8" r="2.4"/><path d="M8 1.6v1.5M8 12.9v1.5M14.4 8h-1.5M3.1 8H1.6M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1"/>'),
  moon: svgFill('<path d="M13.6 10.1A5.9 5.9 0 0 1 5.9 2.4a5.9 5.9 0 1 0 7.7 7.7Z"/>'),
  close: svg('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>'),
  more: svg('<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>'),
  // Shrink to the widget (arrows in), and back to the full board (arrows out).
  widget: svg('<path d="M9.3 6.7 13.6 2.4M9.3 3.6v3.1h3.1M6.7 9.3 2.4 13.6M6.7 12.4V9.3H3.6"/>'),
  expand: svg('<path d="M9.4 6.6 13.4 2.6M10.3 2.6h3.1v3.1M6.6 9.4 2.6 13.4M5.7 13.4H2.6v-3.1"/>'),
  // Hide ClearDay: an eye, struck through.
  hide: svg('<defs><mask id="cd-eye-cut"><rect width="16" height="16" fill="#fff"/><path d="M2.6 2.6l10.8 10.8" stroke="#000" stroke-width="3.6"/></mask></defs><g mask="url(#cd-eye-cut)"><path d="M1.6 8c1.5-2.8 3.7-4.4 6.4-4.4S12.9 5.2 14.4 8c-1.5 2.8-3.7 4.4-6.4 4.4S3.1 10.8 1.6 8Z"/><circle cx="8" cy="8" r="2" fill="currentColor"/></g><path d="M2.6 2.6l10.8 10.8"/>'),
  // The two boards: a briefcase for Work, a house for Personal.
  work: svg('<rect x="1.9" y="4.9" width="12.2" height="8.6" rx="2.1"/><path d="M5.9 4.9V3.7a1 1 0 0 1 1-1h2.2a1 1 0 0 1 1 1v1.2M7 8.8h2"/>'),
  personal: svg('<path d="M2.6 7.3a1 1 0 0 1 .37-.78L7.4 2.9a1 1 0 0 1 1.2 0l4.43 3.62a1 1 0 0 1 .37.78v5.2a1 1 0 0 1-1 1H3.6a1 1 0 0 1-1-1Z"/><path d="M6.6 13.5v-2.6a1.4 1.4 0 0 1 2.8 0v2.6"/>'),
  // Notes: attach a file, and link.
  paperclip: svg('<path d="M13.2 7.6 8.1 12.7a3.2 3.2 0 0 1-4.5-4.5l5.4-5.4a2.1 2.1 0 0 1 3 3L6.6 11.2a1 1 0 0 1-1.5-1.5l4.9-4.9"/>'),
  link: svg('<path d="M6.9 9.1a2.6 2.6 0 0 0 3.7 0l2.1-2.1a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.1 6.9a2.6 2.6 0 0 0-3.7 0L3.3 9a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>'),
  check: svg('<path d="m3.8 8.3 2.7 2.7 5.7-6"/>', ' stroke-width="2"'),
  grip: svg('<circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none"/>'),
};
