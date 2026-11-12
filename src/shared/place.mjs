// Where ClearDay's shapes form. The board and the widget's capsule take
// each other's place: the capsule forms with its expand arrows under the
// board's shrink button, and the board forms with its shrink button under
// the capsule's arrows. The pointer that pressed one is already on the
// other, and nothing jumps back to where it last was.

// The capsule's pill inside its window, in CSS px before the text-size zoom
// (widget.css): the room around it for its shadow, and the centre of its
// expand arrows.
export const CAPSULE = { margin: 20, width: 92, height: 52, arrowsX: 67, arrowsY: 26 };

const clamp = (v, min, max) => Math.round(Math.min(Math.max(min, max), Math.max(min, v)));

// The capsule's window, so that its expand arrows are centred on point.
export function capsuleWindowAt(point, zoom = 1) {
  return {
    x: Math.round(point.x - (CAPSULE.margin + CAPSULE.arrowsX) * zoom),
    y: Math.round(point.y - (CAPSULE.margin + CAPSULE.arrowsY) * zoom),
  };
}

// The board's window, so that its shrink button (centred at `button`,
// measured from the window's corner) is on point, kept inside the screen's
// work area. size: { width, height }.
export function boardWindowAt(point, button, size, area) {
  return {
    x: clamp(point.x - button.x, area.x, area.x + area.width - size.width),
    y: clamp(point.y - button.y, area.y, area.y + area.height - size.height),
    width: size.width,
    height: size.height,
  };
}
