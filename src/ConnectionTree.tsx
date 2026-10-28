import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Search, Folder, FolderOpen, FolderPlus, FolderInput, ChevronDown, ChevronRight, ChevronsDownUp, Plus, Pencil, Trash2, Star, Play, Terminal, Monitor, Radio, Import } from 'lucide-react';
import type { Profile } from './types';

const icons = { ssh: Terminal, sftp: FolderOpen, local: Terminal, rdp: Monitor, vnc: Radio, telnet: Terminal, serial: Terminal, ftp: FolderOpen, ftps: FolderOpen };
const dragType = 'application/x-vekoterm-connection';
export type ConnectionTreeState = { query: string; favorites: boolean; collapsed: string[] };
type MenuState = { x: number; y: number } & ({ profile: Profile; folder?: undefined } | { folder: string; profile?: undefined });

export function ConnectionTree({ profiles, folders, selectedFolder, selectFolder, selected, select, connect, edit, add, move, moveTo, remove, toggleFavorite, createFolder, renameFolder, removeFolder, importMoba, state, updateState }: {
  state: ConnectionTreeState; updateState: Dispatch<SetStateAction<ConnectionTreeState>>;
  profiles: Profile[]; folders: string[]; selectedFolder: string; selectFolder: (folder: string) => void;
  selected: string; select: (id: string) => void; connect: (p: Profile) => void; edit: (p: Profile) => void;
  add: (folder?: string) => void; move: (p: Profile) => void; createFolder: () => void; importMoba: () => void;
  moveTo: (p: Profile, folder: string) => void; remove: (p: Profile) => void; toggleFavorite: (p: Profile) => void;
  renameFolder: (folder: string) => void; removeFolder: (folder: string) => void;
}) {
  const { query, favorites, collapsed } = state;
  const [draggingId, setDraggingId] = useState(''), [dropFolder, setDropFolder] = useState('');
  const [menu, setMenu] = useState<MenuState|null>(null);
  const menuRef = useRef<HTMLDivElement>(null), treeRef = useRef<HTMLDivElement>(null);
  const dragSource = useRef('');
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = () => setMenu(null), key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } };
    window.addEventListener('mousedown', close); window.addEventListener('blur', close); window.addEventListener('resize', close); document.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); document.removeEventListener('keydown', key, true); };
  }, [menu]);
  const setQuery = (query: string) => updateState(previous => ({ ...previous, query }));
  const setFavorites = (favorites: boolean) => updateState(previous => ({ ...previous, favorites }));
  const setCollapsed = (change: (previous: string[]) => string[]) => updateState(previous => ({ ...previous, collapsed: change(previous.collapsed) }));
  const search = query.trim().toLocaleLowerCase('tr');
  const matching = profiles.filter(p => (!favorites || p.favorite) && `${p.name} ${p.host} ${p.folder}`.toLocaleLowerCase('tr').includes(search));
  const visibleFolders = folders.filter(folder => !(search || favorites) || matching.some(p => p.folder === folder) || (!favorites && folder.toLocaleLowerCase('tr').includes(search)));
  const allCollapsed = folders.length > 0 && folders.every(folder => collapsed.includes(folder));
  const openProfileMenu = (profile: Profile, x: number, y: number) => { select(profile.id); setMenu({ profile, x, y }); };
  const run = (action: () => void) => () => { setMenu(null); action(); };
  const focusRow = (from: HTMLElement, step: number) => {
    const rows = [...(treeRef.current?.querySelectorAll<HTMLElement>('.session-row') || [])], next = rows[rows.indexOf(from) + step];
    if (next) { next.focus(); select(next.dataset.id || ''); }
  };
  return <div className="connection-panel">
    <div className="panel-head">
      <strong>Bağlantılar</strong>
      <button className="panel-icon" title="Yeni oturum" aria-label="Yeni oturum" onClick={() => add()}><Plus size={15}/></button>
      <button className="panel-icon" title="Yeni bağlantı klasörü" aria-label="Yeni bağlantı klasörü" onClick={createFolder}><FolderPlus size={15}/></button>
      <button className="panel-icon" title="MobaXterm'den al" aria-label="MobaXterm'den bağlantı al" onClick={importMoba}><Import size={15}/></button>
      <button className={`panel-icon ${favorites ? 'selected' : ''}`} title={favorites ? 'Tüm bağlantıları göster' : 'Yalnız favorileri göster'} aria-label="Favoriler" aria-pressed={favorites} onClick={() => setFavorites(!favorites)}><Star size={15}/></button>
      <button className="panel-icon" title={allCollapsed ? 'Tüm klasörleri aç' : 'Tüm klasörleri kapat'} aria-label={allCollapsed ? 'Tüm klasörleri aç' : 'Tüm klasörleri kapat'} onClick={() => setCollapsed(() => allCollapsed ? [] : [...folders])}><ChevronsDownUp size={15}/></button>
    </div>
    <label className="panel-search"><Search size={14}/><input aria-label="Bağlantılarda ara" placeholder="Bağlantı veya klasör ara" value={query} onChange={e => setQuery(e.target.value)}/></label>
    <div className="session-tree" role="tree" aria-label="Bağlantılar" ref={treeRef}>
      <button className={`tree-root ${!selectedFolder && !selected ? 'selected' : ''}`} onClick={() => selectFolder('')} title="Kayıtlı tüm bağlantılar"><Star size={14}/><span>Kullanıcı oturumları</span><small>{profiles.length}</small></button>
      {visibleFolders.map(folder => {
        const entries = matching.filter(p => p.folder === folder), count = profiles.filter(p => p.folder === folder).length, expanded = !!search || favorites || !collapsed.includes(folder);
        return <section className={`tree-folder ${dropFolder === folder ? 'drop-target' : ''}`} key={folder} aria-label={`${folder} klasörü`}
          onDragOver={e => { const dragged = profiles.find(p => p.id === dragSource.current); if (dragged && dragged.folder !== folder && e.dataTransfer.types.includes(dragType)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropFolder(folder); } }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropFolder(previous => previous === folder ? '' : previous); }}
          onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData(dragType), dragged = profiles.find(p => p.id === dragSource.current); dragSource.current = ''; setDropFolder(''); setDraggingId(''); if (dragged && dragged.id === id && dragged.folder !== folder) moveTo(dragged, folder); }}>
          <div className={`customer-heading ${selectedFolder === folder ? 'selected' : ''}`} onContextMenu={e => { e.preventDefault(); selectFolder(folder); setMenu({ folder, x: e.clientX, y: e.clientY }); }}>
            <button className="folder-heading" aria-expanded={expanded} title={folder} onClick={() => { selectFolder(folder); setCollapsed(prev => prev.includes(folder) ? prev.filter(f => f !== folder) : [...prev, folder]); }}>{expanded ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}{expanded ? <FolderOpen size={15} className="folder-icon"/> : <Folder size={15} className="folder-icon"/>}<span>{folder}</span><small>{count}</small></button>
            <div className="folder-actions"><button title={`${folder} klasörüne bağlantı ekle`} aria-label={`${folder} klasörüne bağlantı ekle`} onClick={() => add(folder)}><Plus size={13}/></button><button title={`${folder} klasörünü yeniden adlandır`} aria-label={`${folder} klasörünü yeniden adlandır`} onClick={() => renameFolder(folder)}><Pencil size={12}/></button>{count === 0 && <button title={`${folder} boş klasörünü sil`} aria-label={`${folder} boş klasörünü sil`} onClick={() => removeFolder(folder)}><Trash2 size={12}/></button>}</div>
          </div>
          {expanded && <div className="folder-connections" role="group">{entries.map(p => { const Icon = icons[p.type]; return <div key={p.id} data-id={p.id} role="treeitem" aria-selected={selected === p.id} className={`session-row ${selected === p.id ? 'selected' : ''} ${draggingId === p.id ? 'dragging' : ''}`} draggable
            title={p.type === 'local' ? p.name : `${p.username ? p.username + '@' : ''}${p.host}:${p.port}`}
            onDragStart={e => { e.dataTransfer.setData(dragType, p.id); e.dataTransfer.effectAllowed = 'move'; dragSource.current = p.id; setDraggingId(p.id); select(p.id); }}
            onDragEnd={() => { dragSource.current = ''; setDraggingId(''); setDropFolder(''); }}
            onClick={() => select(p.id)} onDoubleClick={() => connect(p)} tabIndex={0}
            onContextMenu={e => { e.preventDefault(); openProfileMenu(p, e.clientX, e.clientY); }}
            onKeyDown={e => {
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter') connect(p);
              if (e.key === 'Delete') { e.preventDefault(); remove(p); }
              if (e.key === 'F2') { e.preventDefault(); edit(p); }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); focusRow(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1); }
              if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); openProfileMenu(p, r.left + 24, r.bottom); }
            }}>
            <Icon size={15} className={`protocol-icon protocol-${p.type}`}/><span className="session-name">{p.name}</span>{p.favorite && <Star size={11} className="favorite-mark" aria-label="Favori"/>}<small className="session-host">{p.type === 'local' ? 'Bu bilgisayar' : p.host}</small>
            <div className="row-actions" onDoubleClick={e => e.stopPropagation()}>
              <button title="Bağlan" aria-label="Bağlan" onClick={e => { e.stopPropagation(); connect(p); }}><Play size={13}/></button>
              <button className="move-connection" title="Klasöre taşı" aria-label="Klasöre taşı" onClick={e => { e.stopPropagation(); move(p); }}><FolderInput size={13}/></button>
              <button title="Oturumu düzenle" aria-label="Oturumu düzenle" onClick={e => { e.stopPropagation(); edit(p); }}><Pencil size={12}/></button>
              <button className="delete-connection" title="Bağlantıyı sil (Del)" aria-label="Bağlantıyı sil" onClick={e => { e.stopPropagation(); remove(p); }}><Trash2 size={12}/></button>
            </div>
          </div>; })}{!entries.length && !search && !favorites && <button className="empty-customer" onClick={() => add(folder)}><Plus size={13}/>Bu klasöre bağlantı ekle</button>}</div>}
        </section>;
      })}
      {!visibleFolders.length && <div className="sidebar-empty"><FolderOpen size={27}/><strong>{favorites ? 'Favori bağlantı bulunamadı' : 'Bağlantı bulunamadı'}</strong><p>{folders.length ? 'Aramayı değiştirebilir veya favori süzgecini kapatabilirsin.' : 'Yeni oturum ekle veya MobaXterm’den al.'}</p></div>}
      <p className="tree-hint">Çift tık: bağlan · Sağ tık: menü · Del: sil · F2: düzenle · Sürükle: klasöre taşı</p>
    </div>
    {menu?.profile && <div ref={menuRef} className="tree-context-menu" role="menu" aria-label={`${menu.profile.name} işlemleri`} style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 234)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 230)) }} onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      <span className="menu-title">{menu.profile.name}</span>
      <button role="menuitem" onClick={run(() => connect(menu.profile))}><Play size={14}/>Bağlan<kbd>Enter</kbd></button>
      <button role="menuitem" onClick={run(() => edit(menu.profile))}><Pencil size={14}/>Düzenle<kbd>F2</kbd></button>
      <button role="menuitem" onClick={run(() => move(menu.profile))}><FolderInput size={14}/>Klasöre taşı…</button>
      <button role="menuitem" onClick={run(() => toggleFavorite(menu.profile))}><Star size={14}/>{menu.profile.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}</button>
      <hr/>
      <button role="menuitem" className="danger" onClick={run(() => remove(menu.profile))}><Trash2 size={14}/>Sil<kbd>Del</kbd></button>
    </div>}
    {menu?.folder !== undefined && <div ref={menuRef} className="tree-context-menu" role="menu" aria-label={`${menu.folder} klasörü işlemleri`} style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 234)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 170)) }} onMouseDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
      <span className="menu-title">{menu.folder}</span>
      <button role="menuitem" onClick={run(() => add(menu.folder))}><Plus size={14}/>Bu klasöre bağlantı ekle</button>
      <button role="menuitem" onClick={run(() => renameFolder(menu.folder))}><Pencil size={14}/>Yeniden adlandır</button>
      <hr/>
      <button role="menuitem" className="danger" disabled={profiles.some(p => p.folder === menu.folder)} title={profiles.some(p => p.folder === menu.folder) ? 'Önce içindeki bağlantıları taşıyın veya silin.' : undefined} onClick={run(() => removeFolder(menu.folder))}><Trash2 size={14}/>Klasörü sil</button>
    </div>}
  </div>;
}
