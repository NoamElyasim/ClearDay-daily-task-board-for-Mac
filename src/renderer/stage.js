// The stage (see src/main/morph.mjs): draws a scene's starting shape, plays
// it when told to, and clears. One surface stretches from the widget's pill
// to the board or gathers back: the board unfolds inside it from the top
// and the + travels to the board's Add button.
import { ICONS } from './icons.js';

const s = window.stage;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';   // theme.css: --ease-out
const el = (id) => document.getElementById(id);
const shell = el('shell'), fold = el('fold'), board = el('board'), pill = el('pill'), mark = el('mark');
mark.innerHTML = ICONS.plus;
const plus = mark.firstElementChild;

let scene = null;
let running = [];

// Two frames on, what was set is on screen.
const drawn = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const px = (n) => `${n}px`;
const boxOf = (r) => ({ left: px(r.x), top: px(r.y), width: px(r.width), height: px(r.height) });
// The surface in a shape's place.
const shapeOf = ({ rect, radius }) => ({ ...boxOf(rect), borderRadius: px(radius) });
// Where the board's picture sits inside the surface, so that it stays put
// on the screen whatever shape the surface has.
const within = (b, { rect }) => ({ left: px(b.x - rect.x), top: px(b.y - rect.y) });
const share = (v) => ({ width: `${v * 100}%`, height: `${v * 100}%` });

const LOWERED = 'translateY(22px)', RESTING = 'translateY(0)';

function reset() {
  for (const a of running) a.cancel();
  running = [];
  for (const node of [shell, fold, board, pill, mark, plus]) node.removeAttribute('style');
  for (const node of [shell, fold, pill, mark]) node.hidden = true;
  board.removeAttribute('src');
  pill.removeAttribute('src');
}

// A picture, loaded and decoded before it is shown.
async function picture(img, src) {
  if (!src) return false;
  img.src = src;
  try { await img.decode(); return true; } catch (_) { return false; }
}

s.onScene(async (next) => {
  reset();
  scene = next;
  const { shell: sh, board: b, pill: p, mark: m } = scene;
  const [hasBoard, hasPill] = await Promise.all([picture(board, sh && b?.src), picture(pill, p?.src)]);
  if (sh) {
    Object.assign(shell.style, shapeOf(sh.from));
    shell.hidden = false;
  }
  scene.hasBoard = hasBoard;
  if (hasBoard) {
    Object.assign(fold.style, within(b.rect, sh.from), { width: px(b.rect.width), height: px(b.show === 'in' ? 0 : b.rect.height) });
    Object.assign(board.style, { width: px(b.rect.width), height: px(b.rect.height), transform: b.show === 'in' ? LOWERED : RESTING });
    fold.hidden = false;
  }
  if (hasPill) {
    Object.assign(pill.style, boxOf(p.rect), { opacity: p.show === 'in' ? '0' : '1' });
    pill.hidden = false;
  }
  if (m) {
    Object.assign(mark.style, boxOf(m.from));
    Object.assign(plus.style, share(m.iconFrom));
    mark.hidden = false;
  }
  await drawn();
  s.say('ready');
});

s.onGo(async () => {
  const { shell: sh, board: b, pill: p, mark: m, ms, hasBoard } = scene || {};
  const run = (node, frames, opts) => running.push(node.animate(frames, { easing: EASE, fill: 'both', ...opts }));
  if (sh) {
    run(shell, [shapeOf(sh.from), shapeOf(sh.to)], { duration: ms });
    if (hasBoard) {
      run(fold, [within(b.rect, sh.from), within(b.rect, sh.to)], { duration: ms });
      // The board unfolds from the top a moment after the surface starts to
      // grow, and folds away at once when it gathers back.
      const full = px(b.rect.height);
      if (b.show === 'in') {
        run(fold, { height: ['0px', full] }, { duration: 420, delay: 130 });
        run(board, { transform: [LOWERED, RESTING] }, { duration: 520, delay: 130 });
      } else {
        run(fold, { height: [full, '0px'] }, { duration: 420 });
        run(board, { transform: [RESTING, LOWERED] }, { duration: 520 });
      }
    }
    // The widget's own face goes as the surface leaves it, and is back as
    // the surface settles into it.
    if (!pill.hidden && p.show === 'out') run(pill, { opacity: [1, 0] }, { duration: 160, easing: 'ease' });
    if (!pill.hidden && p.show === 'in') run(pill, { opacity: [0, 1] }, { duration: 260, delay: Math.max(0, ms - 320), easing: 'ease' });
    if (m) {
      run(mark, [boxOf(m.from), boxOf(m.to)], { duration: ms });
      // Its plus sign is a different share of the button at each end.
      run(plus, [share(m.iconFrom), share(m.iconTo)], { duration: ms });
    }
  }
  await Promise.all(running.map((a) => a.finished.catch(() => {})));
  s.say('done');
});

s.onClear(async () => {
  reset();
  scene = null;
  await drawn();
  s.say('clear');
});
