import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';

export type MenuEntry = { label: string; icon?: ComponentType<{ size?: number }>; shortcut?: string; action: () => void; disabled?: boolean; danger?: boolean; checked?: boolean } | 'separator';
export type Menu = { id: string; label: string; items: MenuEntry[] };

// Classic menu bar: click opens a menu, hovering moves between open menus, arrows and Escape work from the keyboard.
export function MenuBar({ menus, note }: { menus: Menu[]; note?: ReactNode }) {
  const [open, setOpen] = useState(''), bar = useRef<HTMLDivElement>(null);
  const close = () => setOpen('');
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!bar.current?.contains(e.target as Node)) close(); };
    window.addEventListener('mousedown', outside); window.addEventListener('blur', close); window.addEventListener('resize', close);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [open]);
  const focusItem = (index: number) => { const items = [...(bar.current?.querySelectorAll<HTMLButtonElement>('.menu-popup [role=menuitem]:not(:disabled)') || [])]; if (items.length) items[(index + items.length) % items.length].focus(); };
  const openMenu = (id: string, focusFirst = false) => { setOpen(id); if (focusFirst) requestAnimationFrame(() => focusItem(0)); };
  const step = (direction: number) => { const index = menus.findIndex(m => m.id === open); const next = menus[(index + direction + menus.length) % menus.length]; openMenu(next.id, true); bar.current?.querySelector<HTMLButtonElement>(`[data-menu="${next.id}"]`)?.focus(); };
  return <div className="menubar" role="menubar" aria-label="Menü" ref={bar} onKeyDown={e => {
    if (e.key === 'Escape' && open) { e.stopPropagation(); const id = open; close(); bar.current?.querySelector<HTMLButtonElement>(`[data-menu="${id}"]`)?.focus(); }
    if (!open) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...(bar.current?.querySelectorAll<HTMLButtonElement>('.menu-popup [role=menuitem]:not(:disabled)') || [])], index = items.indexOf(document.activeElement as HTMLButtonElement);
      focusItem(index < 0 ? 0 : index + (e.key === 'ArrowDown' ? 1 : -1));
    }
  }}>
    {menus.map(menu => <div className="menu-root" key={menu.id}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open === menu.id} data-menu={menu.id}
        onClick={() => open === menu.id ? close() : openMenu(menu.id)} onMouseEnter={() => { if (open && open !== menu.id) openMenu(menu.id); }}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(menu.id, true); } }}>{menu.label}</button>
      {open === menu.id && <div className="menu-popup" role="menu" aria-label={menu.label}>
        {menu.items.map((item, index) => item === 'separator' ? <hr key={'s' + index}/> :
          <button key={item.label} role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => { close(); item.action(); }}>
            <span className="menu-icon">{item.icon && <item.icon size={15}/>}{item.checked && !item.icon && '✓'}</span><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>)}
      </div>}
    </div>)}
    {note && <span className="menu-note">{note}</span>}
  </div>;
}
