// Where ClearDay's shapes form. The board and the widget grow out of one
// point, the +: the capsule forms with its + on the board's Add button, and
// the board forms with its Add button on the widget's +. Each shape is
// where the last one was, and nothing jumps back to where it last sat.

// The capsule's pill inside its window, in CSS px before the text-size zoom
// (widget.css): the room around it for its shadow, and the centre of its +.
export const CAPSULE = { margin: 20, width: 92, height: 52, plusX: 26, plusY: 26 };

const clamp = (v, min, max) => Math.round(Math.min(Math.max(min, max), Math.max(min, v)));

// The capsule's window, so that its + is centred on point.
export function capsuleWindowAt(point, zoom = 1) {
  return {
    x: Math.round(point.x - (CAPSULE.margin + CAPSULE.plusX) * zoom),
    y: Math.round(point.y - (CAPSULE.margin + CAPSULE.plusY) * zoom),
  };
}

// The board's window, so that its Add button (centred at `add`, measured
// from the window's corner) is on point, kept inside the screen's work
// area. size: { width, height }.
export function boardWindowAt(point, add, size, area) {
  return {
    x: clamp(point.x - add.x, area.x, area.x + area.width - size.width),
    y: clamp(point.y - add.y, area.y, area.y + area.height - size.height),
    width: size.width,
    height: size.height,
  };
}
