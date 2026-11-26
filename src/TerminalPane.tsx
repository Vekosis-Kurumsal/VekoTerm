import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Search, X, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from './api';
import { TerminalMenu } from './TerminalMenu';
import { terminalComfort } from './terminalComfort';
import { terminalHighlights } from './terminalHighlights';
import { terminalSelection } from './terminalSelection';
import type { Session } from './types';
import '@xterm/xterm/css/xterm.css';

// Terminal colours per theme; the Zümrüt theme uses an obsidian background and an emerald cursor.
const PALETTES = {
  default: { background: '#000000', foreground: '#d2dae5', cursor: '#6ed0b6', selectionBackground: '#35524e' },
  emerald: { background: '#060908', foreground: '#d6e5dd', cursor: '#34d399', selectionBackground: '#1d4a3a' }
};
export function TerminalPane({ session, visible, fontSize, fontFamily = 'Cascadia Code', highlight = true, broadcast, peers, copyOnSelect, order = 0, showLabel = false, isActive = false, activate, palette = 'default' }: { palette?: keyof typeof PALETTES; fontFamily?: string; highlight?: boolean; order?: number; showLabel?: boolean; isActive?: boolean; activate?: () => void; session: Session; visible: boolean; fontSize: number; broadcast: boolean; peers: string[]; copyOnSelect: boolean }) {
  const container = useRef<HTMLDivElement>(null), terminal = useRef<Terminal|null>(null), fit = useRef<FitAddon|null>(null), search = useRef<SearchAddon|null>(null);
  const viewport = useRef<HTMLDivElement>(null), tail = useRef<HTMLDivElement>(null);
  const highlighter = useRef<ReturnType<typeof terminalHighlights> | null>(null);
  const output = useRef({ broadcast, peers, copyOnSelect, status: session.status }), [find, setFind] = useState(false), [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; selection: string }|null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean }|null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  output.current = { broadcast, peers, copyOnSelect, status: session.status };
  const notify = useCallback((text: string, error = false) => {
    if (!terminal.current) return;
    setNotice({ text, error });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), error ? 5000 : 1600);
  }, []);
  const copy = useCallback(async (selection: string) => {
    if (!selection) return;
    try { await api.writeClipboard(selection); notify('Kopyalandı'); }
    catch (error) { notify(error instanceof Error ? error.message : 'Metin kopyalanamadı.', true); }
  }, [notify]);
  const paste = useCallback(async () => {
    const term = terminal.current;
    if (!term || output.current.status !== 'connected') return;
    try {
      const text = await api.readClipboard();
      if (terminal.current !== term || output.current.status !== 'connected') return;
      if (text.length > 1024 * 1024 - 12) { notify('Metin çok büyük. Daha küçük bir bölüm yapıştırın.', true); return; }
      term.paste(text); term.focus();
    } catch (error) { notify(error instanceof Error ? error.message : 'Metin yapıştırılamadı.', true); }
  }, [notify]);
  // Answers a password question with the connection's password; the main process writes it, the renderer never sees it.
  const sendPassword = useCallback(async () => {
    if (!['ssh', 'local'].includes(session.type) || output.current.status !== 'connected') return;
    try { await api.sendSavedPassword(session.id); notify('Parola gönderildi'); terminal.current?.focus(); }
    catch (error) { notify(error instanceof Error ? error.message : 'Parola gönderilemedi.', true); }
  }, [notify, session.id, session.type]);
  const closeMenu = useCallback((restoreFocus: boolean) => { setMenu(null); if (restoreFocus) terminal.current?.focus(); }, []);
  useEffect(() => {
    if (!container.current || !viewport.current || !tail.current) return;
    const term = new Terminal({ cursorBlink: true, cursorStyle: 'bar', fontSize, fontFamily: `"${fontFamily}", Consolas, monospace`, lineHeight: 1.2, scrollback: 10000, allowProposedApi: true, convertEol: false, theme: { background: '#000000', foreground: '#d2dae5', cursor: '#6ed0b6', selectionBackground: '#35524e' } });
    terminal.current = term; const addon = new FitAddon(); fit.current = addon; const finder = new SearchAddon(); search.current = finder;
    term.loadAddon(addon); term.loadAddon(finder); term.open(container.current);
    const comfort = terminalComfort(term, viewport.current, tail.current);
    const selectionScroll = terminalSelection(term, viewport.current, comfort.beginReading);
    const highlights = terminalHighlights(term, highlight); highlighter.current = highlights;
    const resized = term.onResize(({ cols, rows }) => { api.resize(session.id, cols, rows).catch(() => {}); });
    const fitTerminal = () => { if (container.current?.offsetWidth) addon.fit(); };
    const observer = new ResizeObserver(fitTerminal); observer.observe(container.current); fitTerminal();
    api.resize(session.id, term.cols, term.rows).catch(() => {});
    term.write(session.buffer || '');
    const data = term.onData(value => { comfort.followInput(); const targets = output.current.broadcast ? output.current.peers : [session.id]; for (const id of targets) api.input(id, value).catch(() => {}); });
    const unsub = api.onEvent(e => { if (e.type === 'data' && e.id === session.id) term.write(e.data || ''); });
    const surface = viewport.current;
    let selecting = false, selectionTimer: ReturnType<typeof setTimeout>|undefined;
    const mouseDown = (e: MouseEvent) => {
      if (e.button === 0) selecting = true;
      // Keep xterm's right-click handler from replacing the selected text.
      if (e.button === 2) { e.preventDefault(); e.stopPropagation(); }
    };
    const mouseUp = (e: MouseEvent) => {
      if (e.button !== 0 || !selecting) return;
      selecting = false;
      clearTimeout(selectionTimer);
      // xterm finalizes its selection in its document mouseup listener.
      selectionTimer = setTimeout(() => { if (output.current.copyOnSelect) void copy(term.getSelection()); }, 0);
    };
    const contextMenu = (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, selection: term.getSelection() });
    };
    const cancelSelection = () => { selecting = false; };
    surface.addEventListener('mousedown', mouseDown, true);
    surface.addEventListener('contextmenu', contextMenu, true);
    document.addEventListener('mouseup', mouseUp, true);
    window.addEventListener('blur', cancelSelection);
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown' || e.altKey || e.metaKey) return true;
      const handled = () => { e.preventDefault(); e.stopPropagation(); return false; };
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { setFind(true); return handled(); }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') { term.selectAll(); return handled(); }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') { void sendPassword(); return handled(); }
      if (e.ctrlKey && ((e.code === 'KeyC' && (e.shiftKey || term.hasSelection())) || e.code === 'Insert')) { void copy(term.getSelection()); return handled(); }
      if ((e.ctrlKey && e.code === 'KeyV') || (e.shiftKey && !e.ctrlKey && e.code === 'Insert')) { void paste(); return handled(); }
      if (e.code === 'ContextMenu' || (e.shiftKey && e.code === 'F10')) {
        const rect = surface.getBoundingClientRect();
        setMenu({ x: rect.left + 20, y: rect.top + 20, selection: term.getSelection() }); return handled();
      }
      return true;
    });
    return () => {
      clearTimeout(selectionTimer); if (noticeTimer.current) clearTimeout(noticeTimer.current);
      surface.removeEventListener('mousedown', mouseDown, true); surface.removeEventListener('contextmenu', contextMenu, true);
      document.removeEventListener('mouseup', mouseUp, true); window.removeEventListener('blur', cancelSelection);
      unsub(); data.dispose(); resized.dispose(); observer.disconnect(); selectionScroll.dispose(); comfort.dispose(); highlights.dispose(); highlighter.current = null; term.dispose(); terminal.current = null;
    };
  }, [session.id]);
  useEffect(() => {
    if (!terminal.current) return;
    terminal.current.options.fontSize = fontSize;
    terminal.current.options.fontFamily = `"${fontFamily}", Consolas, monospace`;
    const frame = requestAnimationFrame(() => fit.current?.fit());
    return () => cancelAnimationFrame(frame);
  }, [fontSize, fontFamily]);
  useEffect(() => { highlighter.current?.setEnabled(highlight); }, [highlight]);
  useEffect(() => { if (terminal.current) terminal.current.options.theme = PALETTES[palette] || PALETTES.default; }, [palette, session.id]);
  useEffect(() => { if (visible) requestAnimationFrame(() => { fit.current?.fit(); highlighter.current?.refresh(); if (isActive) terminal.current?.focus(); }); }, [visible, isActive, order]);
  useEffect(() => { if (!visible) setMenu(null); }, [visible]);
  return <div className="terminal-pane" onFocusCapture={() => { if (!isActive) activate?.(); }} style={{ display: visible ? 'flex' : 'none', order }}>
    {showLabel && <button className="pane-label" onClick={activate}>{session.name}<span>{session.host || 'Yerel'}</span></button>}
    {find && <div className="terminal-find"><Search size={14}/><input autoFocus aria-label="Terminalde ara" placeholder="Terminalde ara…" value={query} onChange={e => { setQuery(e.target.value); search.current?.findNext(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter') search.current?.findNext(query); if (e.key === 'Escape') setFind(false); }}/><button title="Önceki sonuç" onClick={() => search.current?.findPrevious(query)}><ArrowUp size={14}/></button><button title="Sonraki sonuç" onClick={() => search.current?.findNext(query)}><ArrowDown size={14}/></button><button title="Aramayı kapat" onClick={() => setFind(false)}><X size={14}/></button></div>}
    <div ref={viewport} className="terminal-view"><div ref={container} className="terminal-surface"/><div ref={tail} className="terminal-tail" aria-hidden="true"/></div>
    {notice && <div className={`terminal-feedback ${notice.error ? 'error' : ''}`} role="status">{notice.text}</div>}
    {visible && menu && <TerminalMenu x={menu.x} y={menu.y} canCopy={!!menu.selection} canPaste={session.status === 'connected'} canPassword={['ssh', 'local'].includes(session.type) && session.status === 'connected'} close={closeMenu} action={action => {
      closeMenu(true);
      if (action === 'copy') void copy(menu.selection);
      if (action === 'paste') void paste();
      if (action === 'password') void sendPassword();
      if (action === 'selectAll') terminal.current?.selectAll();
      if (action === 'copyAll') { terminal.current?.selectAll(); void copy(terminal.current?.getSelection() || ''); }
    }}/>}
  </div>;
}
