export function queueActivityPresented(snapshot) {
  const { viewport, main, title, close, focused } = snapshot;
  if (!focused || !viewport || !main || !title || !close) return false;
  const top = Math.max(0, main.top),
    left = Math.max(0, main.left),
    bottom = Math.min(viewport.height, main.bottom),
    right = Math.min(viewport.width, main.right);
  return [title, close].every(
    (rect) =>
      [rect.top, rect.left, rect.bottom, rect.right].every(Number.isFinite) &&
      rect.bottom > rect.top &&
      rect.right > rect.left &&
      rect.top >= top &&
      rect.left >= left &&
      rect.bottom <= bottom &&
      rect.right <= right,
  );
}
