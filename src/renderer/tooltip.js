// Tooltips: every button says what it does. The tip shows a moment after the
// pointer arrives and stays for as long as it rests there, where the system's
// own tooltip (the title attribute) takes a second to show and then goes away.
//
// Any element with a title gets one: its title moves into data-tip, so the
// system tooltip never shows, and titles set later (a button whose meaning
// changes) follow. One tip element serves the whole window.
//
//   import './tooltip.js'      in each window's script
//   <html data-tip-side="above">  puts tips above their button (the quick-add
//                                 bar, with nothing but screen below it)
const DELAY_MS = 120;
const GAP = 7;      // between the button and its tip
const EDGE = 6;     // kept clear of the window's edge
const DRAG_PX = 4;  // a press that travels this far is a drag: the tip goes

let tip = null;
let target = null;   // the element the pointer rests on
let timer = null;
let shown = false;
let frame = 0;
let press = null;    // where a press began

// title → data-tip. A button with no text and no label keeps a name for
// screen readers.
function adopt(el) {
  const title = el.getAttribute('title');
  if (title == null) return;
  el.removeAttribute('title');
  if (!title) { delete el.dataset.tip; return; }
  el.dataset.tip = title;
  if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', title);
}

function tipEl() {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  return tip;
}

// Below the button, centred; above when there is no room below (or when the
// window asks for above); always inside the window.
function place() {
  const el = tipEl();
  const r = target.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const w = el.offsetWidth, h = el.offsetHeight;
  const above = r.top - GAP - h, below = r.bottom + GAP;
  const preferAbove = document.documentElement.dataset.tipSide === 'above';
  const fitsBelow = below + h <= innerHeight - EDGE, fitsAbove = above >= EDGE;
  const top = (preferAbove && fitsAbove) || !fitsBelow ? (fitsAbove ? above : Math.max(EDGE, innerHeight - EDGE - h)) : below;
  const left = Math.min(innerWidth - EDGE - w, Math.max(EDGE, r.left + r.width / 2 - w / 2));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.dataset.side = top < r.top ? 'above' : 'below';
  return true;
}

function show() {
  if (!target || !target.isConnected || !target.dataset.tip) { hide(); return; }
  const el = tipEl();
  el.textContent = target.dataset.tip;
  el.classList.add('show');
  shown = true;
  if (!place()) { hide(); return; }
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(follow);
}

// While it shows: follow the button if it moves (rows slide when the board
// changes), take a changed text, and go when the button does.
function follow() {
  if (!shown) return;
  if (!target || !target.isConnected || !target.dataset.tip || !target.matches(':hover')) { hide(); return; }
  if (tip.textContent !== target.dataset.tip) tip.textContent = target.dataset.tip;
  if (!place()) { hide(); return; }
  frame = requestAnimationFrame(follow);
}

function hide() {
  clearTimeout(timer);
  timer = null;
  cancelAnimationFrame(frame);
  shown = false;
  target = null;
  tip?.classList.remove('show');
}

const tipped = (node) => node?.closest?.('[title], [data-tip]') || null;

document.addEventListener('pointerover', (e) => {
  const el = tipped(e.target);
  if (el) adopt(el);
  if (el === target) return;   // moving about inside the same button
  hide();
  if (!el || !el.dataset.tip || e.pointerType === 'touch' || e.buttons) return;
  target = el;
  timer = setTimeout(show, DELAY_MS);
}, true);

document.addEventListener('pointerout', (e) => {
  if (!target) return;
  const to = e.relatedTarget;
  if (to && target.contains(to)) return;
  if (!to || tipped(to) !== target) hide();
}, true);

// A click keeps the tip (its text may have changed: the theme switch), unless
// the click opened something over it: a menu, Preferences.
document.addEventListener('click', () => {
  if (!target) return;
  requestAnimationFrame(() => {
    if (!target) return;
    if (document.querySelector('.popover, #prefs.open') && !target.closest('.popover, #prefs')) { hide(); return; }
    if (shown) show();
  });
}, true);

// A drag is not a hover.
document.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY }; }, true);
document.addEventListener('pointerup', () => { press = null; }, true);
document.addEventListener('pointermove', (e) => {
  if (press && e.buttons && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_PX) hide();
}, true);

document.addEventListener('scroll', hide, true);
document.addEventListener('keydown', hide, true);
window.addEventListener('blur', hide);
document.addEventListener('pointerleave', hide);

// Titles set while the page runs: adopted at once, so the system tooltip
// never gets a chance, and a tip that is showing takes the new text.
new MutationObserver((records) => {
  for (const r of records) if (r.target.hasAttribute('title')) adopt(r.target);
}).observe(document.documentElement, { attributes: true, attributeFilter: ['title'], subtree: true });
