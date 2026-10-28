import type { Terminal } from '@xterm/xterm';

// Scroll the terminal view past its last row without changing the PTY geometry,
// inserting output, or reserving unusable rows inside the terminal buffer.
export function terminalComfort(term: Terminal, viewport: HTMLElement, tail: HTMLElement) {
  let frame = 0, reading = false, disposed = false;
  const cellHeight = () => (term.element?.querySelector('.xterm-screen')?.clientHeight || 0) / term.rows;
  const enabled = () => term.buffer.active.type === 'normal' && term.modes.mouseTrackingMode === 'none';
  const targetOffset = () => {
    const height = viewport.clientHeight, cell = cellHeight();
    if (!height || !cell || !enabled()) return 0;
    const margin = Math.min(cell * 10, height * 0.28);
    return Math.max(0, Math.ceil(((term.buffer.active.cursorY + 1) * cell - height + margin) / cell) * cell);
  };
  const move = (offset: number) => {
    const height = `${offset}px`;
    if (tail.style.height !== height) tail.style.height = height;
    if (viewport.scrollTop !== offset) viewport.scrollTop = offset;
  };
  const refresh = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const buffer = term.buffer.active;
      if (!enabled() || buffer.viewportY < buffer.baseY) { move(0); return; }
      if (!reading && !term.hasSelection()) move(targetOffset());
    });
  };
  const followInput = () => { reading = false; refresh(); };
  const wheel = (event: WheelEvent) => {
    if (!enabled() || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY) return;
    const cell = cellHeight();
    if (!cell) return;
    event.preventDefault(); event.stopPropagation();
    let delta = event.deltaY * (event.deltaMode === 1 ? cell : event.deltaMode === 2 ? viewport.clientHeight : 1);
    const buffer = term.buffer.active;
    if (delta < 0) {
      reading = true;
      const previous = viewport.scrollTop, next = Math.max(0, previous + delta);
      move(next); delta += previous - next;
      if (delta < 0) term.scrollLines(-Math.ceil(-delta / cell));
    } else {
      if (buffer.viewportY < buffer.baseY) {
        term.scrollLines(Math.ceil(delta / cell));
        if (term.buffer.active.viewportY < term.buffer.active.baseY) { move(0); return; }
      }
      const target = targetOffset(), next = Math.min(target, viewport.scrollTop + delta);
      move(next); reading = next < target;
    }
  };
  const pointerDown = (event: PointerEvent) => {
    if ((event.target as HTMLElement).closest('.scrollbar')) reading = false;
    if (event.target === tail) { event.preventDefault(); term.focus(); }
  };
  const events = [term.onRender(refresh), term.onCursorMove(refresh), term.onWriteParsed(refresh), term.onScroll(refresh), term.onResize(refresh), term.buffer.onBufferChange(() => { reading = false; move(0); refresh(); })];
  viewport.addEventListener('wheel', wheel, { capture: true, passive: false });
  viewport.addEventListener('pointerdown', pointerDown);
  refresh();
  return { refresh, followInput, beginReading() { reading = true; move(0); }, dispose() {
    disposed = true; cancelAnimationFrame(frame);
    events.forEach(event => event.dispose());
    viewport.removeEventListener('wheel', wheel, true); viewport.removeEventListener('pointerdown', pointerDown);
  } };
}
