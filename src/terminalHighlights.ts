import type { IDecoration, IMarker, Terminal } from '@xterm/xterm';
import { terminalColors, terminalTokens } from './terminalTokens';

type Span = { x: number; width: number; color: string };
type Row = { signature: string; marker: IMarker; decorations: IDecoration[] };
type Cell = { row: number; x: number; width: number; start: number; eligible: boolean };

// Decorations affect only presentation. The buffer, input, clipboard and logs
// retain the original text and terminal control sequences.
export function terminalHighlights(term: Terminal, initial = true) {
  const rows = new Map<number, Row>();
  let enabled = initial, frame = 0, disposed = false;
  const remove = (row: Row) => { row.decorations.forEach(item => item.dispose()); row.marker.dispose(); };
  const clear = () => { rows.forEach(remove); rows.clear(); };
  const paint = () => {
    frame = 0;
    const buffer = term.buffer.active;
    if (!enabled || !term.element?.offsetWidth || buffer.type !== 'normal' || term.modes.mouseTrackingMode !== 'none') { clear(); return; }
    const first = buffer.viewportY, end = Math.min(buffer.length, first + term.rows);
    const desired = new Map<number, Span[]>();
    let lineIndex = first, preceding = 0;
    while (lineIndex > 0 && buffer.getLine(lineIndex)?.isWrapped && preceding++ < 16) lineIndex--;
    while (lineIndex < end) {
      let text = '', wrapped = 0;
      const cells: Cell[] = [];
      do {
        const line = buffer.getLine(lineIndex);
        if (!line) break;
        const nextWrapped = buffer.getLine(lineIndex + 1)?.isWrapped;
        for (let x = 0; x < term.cols; x++) {
          const cell = line.getCell(x);
          if (!cell || cell.getWidth() === 0) continue;
          const start = text.length;
          text += cell.getChars() || ' ';
          cells.push({ row: lineIndex, x, width: cell.getWidth(), start,
            eligible: cell.isFgDefault() && cell.isBgDefault() && !cell.isInverse() && !cell.isInvisible() && !cell.isDim() });
        }
        // Trailing blank cells do not separate a soft-wrapped command.
        if (!nextWrapped) text = text.trimEnd();
        lineIndex++;
        if (!nextWrapped || text.length >= 16000) break;
      } while (++wrapped < 32);
      const colors: (string | undefined)[] = new Array(text.length);
      for (const token of terminalTokens(text)) {
        for (let i = token.start; i < token.end; i++) colors[i] ||= terminalColors[token.kind];
      }
      for (const cell of cells) {
        if (cell.row < first || cell.row >= end || !cell.eligible) continue;
        const color = colors[cell.start];
        if (!color) continue;
        const spans = desired.get(cell.row) || [];
        const last = spans.at(-1);
        if (last?.color === color && last.x + last.width === cell.x) last.width += cell.width;
        else if (spans.length < 64) spans.push({ x: cell.x, width: cell.width, color });
        desired.set(cell.row, spans);
      }
    }
    for (const [index, row] of rows) {
      if (!desired.has(index) || row.marker.isDisposed || row.marker.line !== index) { remove(row); rows.delete(index); }
    }
    for (const [index, spans] of desired) {
      const signature = spans.map(s => `${s.x}:${s.width}:${s.color}`).join(',');
      const previous = rows.get(index);
      if (previous?.signature === signature) continue;
      if (previous) { remove(previous); rows.delete(index); }
      const marker = term.registerMarker(index - buffer.baseY - buffer.cursorY);
      if (!marker) continue;
      const decorations = spans.map(span => term.registerDecoration({ marker, x: span.x, width: span.width, foregroundColor: span.color, layer: 'bottom' })).filter((item): item is IDecoration => !!item);
      rows.set(index, { signature, marker, decorations });
    }
  };
  const refresh = () => { if (!disposed && !frame) frame = requestAnimationFrame(paint); };
  const events = [term.onWriteParsed(refresh), term.onScroll(refresh), term.onResize(() => { clear(); refresh(); }), term.onRender(refresh), term.buffer.onBufferChange(() => { clear(); refresh(); })];
  refresh();
  return { refresh, setEnabled(value: boolean) { enabled = value; if (!enabled) clear(); refresh(); }, dispose() {
    disposed = true; cancelAnimationFrame(frame); events.forEach(event => event.dispose()); clear();
  } };
}
