import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ClipboardPaste, TextSelect, KeyRound } from 'lucide-react';

export function TerminalMenu({ x, y, canCopy, canPaste, canPassword, action, close }: {
  x: number; y: number; canCopy: boolean; canPaste: boolean; canPassword: boolean;
  action: (action: 'copy'|'paste'|'password'|'selectAll'|'copyAll') => void; close: (restoreFocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    element.style.left = Math.max(8, Math.min(x, window.innerWidth - element.offsetWidth - 8)) + 'px';
    element.style.top = Math.max(8, Math.min(y, window.innerHeight - element.offsetHeight - 8)) + 'px';
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (e: PointerEvent) => { if (!element.contains(e.target as Node)) close(false); };
    const blur = () => close(false);
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => { document.removeEventListener('pointerdown', dismiss, true); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [x, y, close]);
  return createPortal(<div ref={menu} role="menu" aria-label="Terminal işlemleri" className="terminal-menu" style={{ left: x, top: y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
    const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close(true); }
  }}>
    <button role="menuitem" tabIndex={-1} disabled={!canCopy} onClick={() => action('copy')}><Copy size={15}/><span>Kopyala</span><kbd>Ctrl+Shift+C</kbd></button>
    <button role="menuitem" tabIndex={-1} disabled={!canPaste} onClick={() => action('paste')}><ClipboardPaste size={15}/><span>Yapıştır</span><kbd>Ctrl+Shift+V</kbd></button>
    {canPassword && <button role="menuitem" tabIndex={-1} title="Parola sorulduğunda kayıtlı parolayı yazıp Enter'a basar: kullanıcı@sunucu sorusunda o kayıtlı bağlantının, sudo sorusunda bu bağlantının parolası" onClick={() => action('password')}><KeyRound size={15}/><span>Kayıtlı parolayı yapıştır</span><kbd>Ctrl+Shift+P</kbd></button>}
    <div role="separator"/>
    <button role="menuitem" tabIndex={-1} onClick={() => action('selectAll')}><TextSelect size={15}/><span>Tümünü seç</span><kbd>Ctrl+Shift+A</kbd></button>
    <button role="menuitem" tabIndex={-1} onClick={() => action('copyAll')}><Copy size={15}/><span>Tümünü kopyala</span></button>
  </div>, document.body);
}
