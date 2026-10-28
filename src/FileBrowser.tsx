import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowRight, RefreshCw, Upload, Download, Folder, FolderOpen, FolderPlus, FolderUp, FilePlus, FileText, Search, Pencil, Trash2, MoreHorizontal, Copy, Shield, X } from 'lucide-react';
import { api } from './api';
import type { FileEntry, Listing, Session } from './types';
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
type Question = { title: string; label: string; value: string; danger?: boolean; action: (value: string) => Promise<unknown> };

export function FileBrowser({ session, edit, notify }: { session?: Session; edit: (file: FileEntry) => void; notify: (text: string, error?: boolean) => void }) {
  const [listing, setListing] = useState<Listing|null>(null), [path, setPath] = useState(''), [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [follow, setFollow] = useState(false);
  const location = useRef(''); location.current = listing?.path || '';
  const [menu, setMenu] = useState<{x: number; y: number}|null>(null), [drop, setDrop] = useState(false);
  const [question, setQuestion] = useState<Question|null>(null), [answer, setAnswer] = useState(''), [dialogError, setDialogError] = useState('');
  const sequence = useRef(0), anchor = useRef(''), menuRef = useRef<HTMLDivElement>(null);
  const available = session?.status === 'connected' && ['ssh','sftp','local','ftp','ftps'].includes(session.type);
  const files = listing?.files.filter(f => f.name.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'))) || [];
  const selection = listing?.files.filter(f => selected.includes(f.path)) || [], one = selection.length === 1 ? selection[0] : undefined;
  const browse = useCallback(async (dir: string) => {
    if (!session || !available) return;
    const request = ++sequence.current; setBusy(true); setError(''); setMenu(null);
    try { const next = await api.list(session.id, dir); if (request === sequence.current) { setListing(next); setPath(next.path); setSelected([]); } }
    catch (e: any) { if (request === sequence.current) setError(e.message); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [session?.id, available]);
  useEffect(() => { setListing(null); setSelected([]); setPath(''); setError(''); if (available) void browse(session!.home || ''); return () => { sequence.current++; }; }, [browse]);
  useEffect(() => {
    if (!follow || !available || !session || busy) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const track = async () => { try { const dir = await api.currentDirectory(session.id); if (!stopped && dir && dir !== location.current) await browse(dir); } catch {} finally { if (!stopped) timer = setTimeout(track, 2000); } };
    void track(); return () => { stopped = true; clearTimeout(timer); };
  }, [follow, available, session?.id, browse, busy]);
  useEffect(() => {
    if (!menu) return;
    const click = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', click); document.addEventListener('keydown', key);
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [menu]);
  const act = async (action: () => Promise<unknown>, success?: string, refresh = true) => {
    setMenu(null); setBusy(true);
    try { const result = await action(); if (result !== false && success) notify(success); if (refresh && listing) await browse(listing.path); }
    catch (e: any) { notify(e.message, true); if (refresh && listing) await browse(listing.path); }
    finally { setBusy(false); }
  };
  const ask = (value: Question) => { setMenu(null); setQuestion(value); setAnswer(value.value); setDialogError(''); };
  const create = (directory: boolean) => listing && session && ask({ title: directory ? 'Yeni klasör' : 'Yeni dosya', label: directory ? 'Klasör adı' : 'Dosya adı', value: '', action: name => directory ? api.mkdir(session.id, listing.path, name) : api.createFile(session.id, listing.path, name) });
  const rename = () => one && session && ask({ title: 'Yeniden adlandır', label: 'Yeni ad', value: one.name, action: name => api.rename(session.id, one.path, name) });
  const remove = () => selection.length && session && listing && ask({ title: 'Seçilenleri sil', label: `${selection.length} öğe ve varsa alt klasörleri kalıcı olarak silinecek.\n${selection.slice(0, 5).map(f => f.name).join(', ')}${selection.length > 5 ? '…' : ''}`, value: '', danger: true, action: () => api.removeFiles(session.id, listing.path, selection.map(f => f.name)) });
  const permissions = () => one && session && ask({ title: 'Dosya izinleri', label: `${one.name} · İzinler (ör. 644 veya 755)`, value: ((one.mode || (one.directory ? 0o755 : 0o644)) & 0o7777).toString(8), action: mode => api.permissions(session.id, one.path, mode) });
  const download = () => session && selection.length && act(async () => {
    if (selection.length > 1) return api.downloadMany(session.id, selection);
    const result = await api.download(session.id, selection[0].path, selection[0].directory);
    return result || false;
  }, 'İndirme tamamlandı.', false);
  const open = (file: FileEntry) => { setMenu(null); file.directory ? void browse(file.path) : edit(file); };
  const choose = (file: FileEntry, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    if (event.shiftKey && anchor.current) {
      const a = files.findIndex(f => f.path === anchor.current), b = files.findIndex(f => f.path === file.path);
      setSelected(files.slice(Math.max(0, Math.min(a, b)), Math.max(a, b) + 1).map(f => f.path));
    } else if (event.ctrlKey || event.metaKey) { setSelected(previous => previous.includes(file.path) ? previous.filter(p => p !== file.path) : [...previous, file.path]); anchor.current = file.path; }
    else { setSelected([file.path]); anchor.current = file.path; }
  };
  return <div className={`file-browser ${drop ? 'file-drop-target' : ''}`} onDragOver={e => { if (available && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDrop(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node|null)) setDrop(false); }} onDrop={e => {
    e.preventDefault(); setDrop(false); const uploads = Array.from(e.dataTransfer.files);
    if (session && listing && !busy && uploads.length) void act(() => api.uploadDropped(session.id, listing.path, uploads), 'Yükleme tamamlandı.');
  }}>
    <div className="file-context"><span className={`dot ${available ? '' : 'muted'}`}/><strong>{session?.name || 'Dosya gezgini'}</strong><small>{session?.type === 'local' ? 'YEREL' : ['ftp','ftps'].includes(session?.type || '') ? session?.type.toUpperCase() : 'SFTP'}</small></div>
    <form className="file-path" onSubmit={e => { e.preventDefault(); void browse(path); }}><FolderOpen size={14}/><input aria-label="Dosya yolu" value={path} onChange={e => setPath(e.target.value)} placeholder="Klasör yolu" disabled={!available}/><button title="Yola git" disabled={!available}><ArrowRight size={14}/></button></form>
    <div className="file-toolbar"><button title="Üst klasör" disabled={!listing || busy} onClick={() => listing && browse(listing.parent)}><ArrowUp size={15}/></button><button title="Yenile" disabled={!available || busy} onClick={() => browse(listing?.path || session?.home || '')}><RefreshCw size={14} className={busy ? 'spin' : ''}/></button><span/><button title="Yeni klasör" disabled={!listing || busy} onClick={() => create(true)}><FolderPlus size={15}/></button><button title="Dosya yükle" disabled={!listing || busy} onClick={() => session && listing && act(() => api.upload(session.id, listing.path), 'Yükleme tamamlandı.')}><Upload size={15}/></button><button title="Klasör yükle" disabled={!listing || busy} onClick={() => session && listing && act(() => api.uploadFolder(session.id, listing.path), 'Klasör yüklendi.')}><FolderUp size={15}/></button><button title={selection.length > 1 ? 'Seçilenleri indir' : one?.directory ? 'Seçili klasörü indir' : 'Seçili dosyayı indir'} disabled={!selection.length || busy || !available} onClick={download}><Download size={15}/></button><button title="Dosya işlemleri" disabled={!listing || busy} onClick={e => { const box = e.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.bottom }); }}><MoreHorizontal size={15}/></button></div>
    <div className="sidebar-search file-filter"><Search size={13}/><input aria-label="Dosyalarda filtrele" placeholder="Dosyalarda filtrele…" value={filter} onChange={e => setFilter(e.target.value)}/></div>
    {error && <div className="file-error" role="alert">{error}</div>}
    <div className="file-list" tabIndex={0} aria-label="Dosyalar" onScroll={() => setMenu(null)} onKeyDown={e => {
      if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(files.map(f => f.path)); }
      if (busy || !available) return;
      if (e.key === 'Delete') { e.preventDefault(); remove(); }
      if (e.key === 'F2') { e.preventDefault(); rename(); }
      if (e.key === 'Enter' && one) { e.preventDefault(); open(one); }
    }} onContextMenu={e => { e.preventDefault(); if (available && listing) setMenu({ x: e.clientX, y: e.clientY }); }}>
      {listing && <div className="file-list-heading"><span>Ad</span><span>Boyut</span></div>}
      {files.map(file => <div key={file.path} className={`file-row ${selected.includes(file.path) ? 'selected' : ''}`} tabIndex={0} onClick={e => choose(file, e)} onDoubleClick={() => open(file)} onContextMenu={() => { if (!selected.includes(file.path)) setSelected([file.path]); }}>
        <span className={file.directory ? 'folder-glyph' : 'file-glyph'}>{file.directory ? <Folder size={15}/> : <FileText size={14}/>}</span><span className="filename" title={file.name}>{file.name}{file.link ? ' ↗' : ''}</span><small>{file.directory ? '' : size(file.size)}</small>
      </div>)}
      {!listing && !busy && <div className="sidebar-empty"><FolderOpen size={28}/><strong>Dosyaların burada</strong><p>SSH, SFTP veya yerel terminal açtığında dosyalar burada görünür.</p></div>}
      {listing && !files.length && !busy && <div className="sidebar-empty"><FolderOpen size={25}/><p>{filter ? 'Filtreyle eşleşen dosya yok.' : 'Bu klasör boş.'}</p></div>}
    </div>
    {selection.length > 0 && <div className="file-selection"><span>{one ? one.name : `${selection.length} öğe seçili`}</span><button title="Yeniden adlandır" disabled={!one || busy} onClick={rename}><Pencil size={13}/></button><button title="Seçilenleri sil" disabled={busy} onClick={remove}><Trash2 size={13}/></button></div>}
    {session?.type === 'ssh' && <label className="file-follow"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)}/>Terminal klasörünü izle</label>}
    <div className="file-bottom"><span>{listing ? `${listing.files.length} öğe` : 'Bağlantı bekleniyor'}</span><span>Ctrl / Shift ile çoklu seçim</span></div>
    {drop && <div className="file-drop-note"><Upload size={23}/><strong>Bu klasöre yüklemek için bırak</strong></div>}
    {menu && <div ref={menuRef} className="file-context-menu" role="menu" aria-label="Dosya işlemleri" style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 225)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 390)) }}>
      <button role="menuitem" disabled={!one} onClick={() => one && open(one)}><FolderOpen size={14}/>{one?.directory ? 'Klasörü aç' : 'Düzenle'}</button>
      <button role="menuitem" disabled={!selection.length} onClick={download}><Download size={14}/>İndir</button>
      <button role="menuitem" onClick={() => create(false)}><FilePlus size={14}/>Yeni dosya</button><button role="menuitem" onClick={() => create(true)}><FolderPlus size={14}/>Yeni klasör</button>
      <button role="menuitem" disabled={!one} onClick={rename}><Pencil size={14}/>Yeniden adlandır <small>F2</small></button>
      <button role="menuitem" disabled={!one || session?.type === 'local'} onClick={permissions}><Shield size={14}/>Dosya izinleri</button>
      <button role="menuitem" disabled={!selection.length} onClick={() => act(() => api.writeClipboard(selection.map(f => f.path).join('\n')), 'Dosya yolu kopyalandı.', false)}><Copy size={14}/>Yolu kopyala</button>
      <button role="menuitem" onClick={() => { setSelected(files.map(f => f.path)); setMenu(null); }}><Copy size={14}/>Tümünü seç <small>Ctrl A</small></button>
      <button role="menuitem" className="text-danger" disabled={!selection.length} onClick={remove}><Trash2 size={14}/>Sil <small>Del</small></button>
    </div>}
    {question && <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={question.title}><header className="dialog-header"><h2>{question.title}</h2><button className="icon-button" title="Kapat" disabled={busy} onClick={() => setQuestion(null)}><X size={18}/></button></header><form onSubmit={async e => { e.preventDefault(); setBusy(true); setDialogError(''); try { await question.action(answer.trim()); setQuestion(null); notify('Dosya işlemi tamamlandı.'); if (listing) await browse(listing.path); } catch (e: any) { setDialogError(e.message); } finally { setBusy(false); } }}><div className="dialog-body">{question.danger ? <p className="file-delete-note">{question.label}</p> : <label>{question.label}<input autoFocus value={answer} onChange={e => setAnswer(e.target.value)}/></label>}{dialogError && <div role="alert" className="error-message">{dialogError}</div>}</div><footer className="dialog-footer"><button type="button" className="text-button" disabled={busy} onClick={() => setQuestion(null)}>Vazgeç</button><button className={`button ${question.danger ? 'danger' : 'primary'}`} disabled={busy || (!question.danger && !answer.trim())}>{busy ? 'İşleniyor…' : question.danger ? 'Sil' : 'Kaydet'}</button></footer></form></section></div>}
  </div>;
}
