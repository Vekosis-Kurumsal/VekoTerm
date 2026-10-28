import type { IMarker, Terminal } from '@xterm/xterm';

// xterm's screen can extend above the clipped comfort viewport. Take over a
// plain text drag at the visible edge, retaining its original buffer anchor.
export function terminalSelection(term: Terminal, viewport: HTMLElement, beginReading: () => void) {
  const screen = term.element!.querySelector<HTMLElement>('.xterm-screen')!;
  const doc = viewport.ownerDocument, win = doc.defaultView!;
  let anchor: IMarker | undefined, anchorColumn = 0;
  let owned = false, frame = 0, lastScroll = 0, x = 0, y = 0, originY = 0;
  const enabled = () => term.buffer.active.type === 'normal' && term.modes.mouseTrackingMode === 'none';
  const stop = () => {
    win.cancelAnimationFrame(frame); frame = 0; owned = false;
    anchor?.dispose(); anchor = undefined;
  };
  const point = () => {
    const rect = screen.getBoundingClientRect();
    const row = term.buffer.active.viewportY + Math.max(0, Math.min(term.rows - 1, Math.ceil((y - rect.top) / (rect.height / term.rows)) - 1));
    let column = Math.max(0, Math.min(term.cols, Math.ceil((x - rect.left) / (rect.width / term.cols) + 0.5) - 1));
    if (term.buffer.active.getLine(row)?.getCell(column)?.getWidth() === 0) column = Math.min(term.cols, column + 1);
    return { row, column };
  };
  const direction = () => {
    const rect = viewport.getBoundingClientRect();
    const edge = Math.min(12, screen.clientHeight / term.rows / 2);
    if (y < rect.top + edge) return -Math.min(8, 1 + Math.floor((rect.top + edge - y) / 12));
    if (y > rect.bottom - edge) return Math.min(8, 1 + Math.floor((y - rect.bottom + edge) / 12));
    return 0;
  };
  const extend = () => {
    if (!anchor || anchor.isDisposed) { stop(); return; }
    const end = point(), dir = direction();
    if (dir < 0) end.column = 0;
    if (dir > 0) end.column = term.cols;
    const startIndex = anchor.line * term.cols + anchorColumn;
    const endIndex = end.row * term.cols + end.column;
    const first = Math.min(startIndex, endIndex);
    // Public select also stops xterm's native drag timer; this controller owns
    // both directions and subsequent moves until release, blur or resize.
    term.select(first % term.cols, Math.floor(first / term.cols), Math.abs(endIndex - startIndex));
  };
  const tick = (now: number) => {
    frame = 0;
    if (!anchor || anchor.isDisposed || !enabled() || !viewport.clientHeight) { stop(); return; }
    const dir = direction();
    if (dir && now - lastScroll >= 50) {
      lastScroll = now; term.scrollLines(dir); extend();
    }
    if (anchor) frame = win.requestAnimationFrame(tick);
  };
  const down = (event: MouseEvent) => {
    stop();
    // Keep word/line, column and modified selections in xterm's own handler.
    if (event.button !== 0 || event.detail !== 1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !enabled() || !screen.contains(event.target as Node)) return;
    x = event.clientX; y = event.clientY; originY = y;
    const start = point(); anchorColumn = start.column;
    anchor = term.registerMarker(start.row - term.buffer.active.baseY - term.buffer.active.cursorY);
  };
  const move = (event: MouseEvent) => {
    if (!anchor) return;
    if (!(event.buttons & 1) || !enabled()) { stop(); return; }
    x = event.clientX; y = event.clientY;
    if (!owned) {
      const dir = direction();
      // Selecting horizontally on the first/last row must not start scrolling,
      // including when fractional cell sizes round the pointer into the edge.
      if (!dir || (dir < 0 ? y > originY - 4 : y < originY + 4)) return;
      owned = true; beginReading(); lastScroll = 0;
      frame = win.requestAnimationFrame(tick);
    }
    event.preventDefault(); event.stopPropagation(); extend();
  };
  const up = (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (owned) { x = event.clientX; y = event.clientY; extend(); }
    stop();
  };
  const visibility = () => { if (doc.hidden) stop(); };
  const events = [term.onResize(stop), term.buffer.onBufferChange(stop)];
  viewport.addEventListener('mousedown', down, true);
  doc.addEventListener('mousemove', move, true); doc.addEventListener('mouseup', up, true);
  doc.addEventListener('visibilitychange', visibility); win.addEventListener('blur', stop);
  return { dispose() {
    stop(); events.forEach(event => event.dispose());
    viewport.removeEventListener('mousedown', down, true);
    doc.removeEventListener('mousemove', move, true); doc.removeEventListener('mouseup', up, true);
    doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('blur', stop);
  } };
}
