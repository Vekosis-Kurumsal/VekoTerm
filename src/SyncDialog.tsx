import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Folder, FolderOpen, GitCompare, Minus, Monitor, Search, Server, X } from 'lucide-react';
import { api } from './api';
import type { Session, SyncComparison, SyncResult, SyncRow, SyncStatus } from './types';

type Direction = 'upload' | 'download' | 'skip';
type Mode = 'both' | 'upload' | 'download';
const SHOWN = 1000;
const STATUS: Record<SyncStatus, string> = {
  same: 'Aynı', local: 'Yalnız bilgisayarda', remote: 'Yalnız sunucuda', 'local-newer': 'Bilgisayardaki daha yeni',
  'remote-newer': 'Sunucudaki daha yeni', different: 'Farklı, saat aynı', conflict: 'Dosya / klasör çakışması'
};
const ORDER: SyncStatus[] = ['local', 'local-newer', 'remote', 'remote-newer', 'different', 'conflict', 'same'];
const number = (n: number, digits = 0) => n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const size = (n: number) => n < 1024 ? `${number(n)} B` : n < 1048576 ? `${number(n / 1024, 1)} KB` : n < 1073741824 ? `${number(n / 1048576, 1)} MB` : `${number(n / 1073741824, 2)} GB`;
const when = (ms: number) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const side = (value: SyncRow['local']) => !value ? <span className="sync-none">—</span> : value.directory ? <span>Klasör</span> : <><span>{size(value.size || 0)}</span><small>{when(value.modified || 0)}</small></>;
// The direction a row gets unless the user changes it.
function suggested(row: SyncRow, mode: Mode): Direction {
  const up = row.status === 'local' || row.status === 'local-newer', down = row.status === 'remote' || row.status === 'remote-newer';
  if (mode === 'upload') return up ? 'upload' : 'skip';
  if (mode === 'download') return down ? 'download' : 'skip';
  return up ? 'upload' : down ? 'download' : 'skip';
}
const allowed = (row: SyncRow, direction: Direction) => direction === 'skip' || (row.status !== 'conflict' && (direction === 'upload' ? !!row.local : !!row.remote));

// Two folders side by side, this computer and the server behind an SSH/SFTP tab; copies only what the user picks.
export function SyncDialog({ session, initialRemote, close }: { session: Session; initialRemote: string; close: () => void }) {
  const [local, setLocal] = useState(''), [remote, setRemote] = useState(initialRemote || session.home || ''), [exclude, setExclude] = useState('');
  const [result, setResult] = useState<SyncComparison | null>(null), [mode, setMode] = useState<Mode>('both'), [chosen, setChosen] = useState<Record<string, Direction>>({});
  const [showSame, setShowSame] = useState(false), [status, setStatus] = useState<SyncStatus | ''>(''), [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [done, setDone] = useState<SyncResult | null>(null), [confirming, setConfirming] = useState(false);
  useEffect(() => { void api.syncPair(session.id).then(pair => { if (!pair) return; setLocal(pair.local); setExclude(pair.exclude || ''); if (!initialRemote) setRemote(pair.remote); }).catch(() => {}); }, [session.id]);
  const compare = async (keepResult = false) => {
    if (!local) { setError('Önce bilgisayardaki klasörü seçin.'); return; }
    setBusy('Karşılaştırılıyor…'); setError(''); setConfirming(false); if (!keepResult) setDone(null);
    try { const next = await api.syncCompare(session.id, local, remote, exclude); setResult(next); setLocal(next.local); setRemote(next.remote); setChosen({}); }
    catch (e: any) { setError(e.message); } finally { setBusy(''); }
  };
  const pick = async () => { const folder = await api.syncPickLocal(); if (folder) { setLocal(folder); setResult(null); setDone(null); } };
  const direction = (row: SyncRow) => chosen[row.path] ?? suggested(row, mode);
  const rows = result?.rows || [];
  const counts = useMemo(() => { const c = {} as Record<SyncStatus, number>; for (const r of rows) c[r.status] = (c[r.status] || 0) + 1; return c; }, [rows]);
  const q = filter.trim().toLocaleLowerCase('tr');
  const visible = useMemo(() => rows.filter(r => (status ? r.status === status : showSame || r.status !== 'same') && (!q || r.path.toLocaleLowerCase('tr').includes(q))), [rows, status, showSame, q]);
  const plan = useMemo(() => rows.map(r => ({ row: r, direction: direction(r) })).filter(p => p.direction !== 'skip'), [rows, chosen, mode]);
  const uploads = plan.filter(p => p.direction === 'upload'), downloads = plan.filter(p => p.direction === 'download');
  const bytes = plan.reduce((sum, p) => sum + ((p.direction === 'upload' ? p.row.local?.size : p.row.remote?.size) || 0), 0);
  const overwrites = plan.filter(p => p.direction === 'upload' ? !!p.row.remote : !!p.row.local).length;
  const files = (list: typeof plan) => list.filter(p => !p.row.directory).length;
  const setDirection = (row: SyncRow, value: Direction) => { if (allowed(row, value)) { setChosen(previous => ({ ...previous, [row.path]: value })); setConfirming(false); } };
  const start = async () => {
    if (overwrites && !confirming) { setConfirming(true); return; }
    setConfirming(false); setBusy('Eşitleniyor… İlerlemeyi dosya aktarımları panelinden izleyebilirsiniz.'); setError('');
    try {
      const outcome = await api.syncRun(session.id, local, remote, plan.map(p => ({ path: p.row.path, direction: p.direction as 'upload' | 'download', size: (p.direction === 'upload' ? p.row.local?.size : p.row.remote?.size) || 0 })));
      setDone(outcome); await compare(true);
    } catch (e: any) { setError(e.message); setBusy(''); }
  };
  const doneText = done && [done.uploaded && `${number(done.uploaded)} dosya sunucuya yüklendi`, done.downloaded && `${number(done.downloaded)} dosya bilgisayara indirildi`, done.folders && `${number(done.folders)} klasör oluşturuldu`, done.skipped.length && `${number(done.skipped.length)} öğe atlandı`, done.failed.length && `${number(done.failed.length)} öğe aktarılamadı`].filter(Boolean).join(' · ');

  return <div className="modal-backdrop"><section className="small-dialog sync-dialog" role="dialog" aria-modal="true" aria-label="Klasör eşitleme">
    <header className="dialog-header"><h2>Klasör eşitleme <small>{session.name} · {session.username ? session.username + '@' : ''}{session.host}</small></h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <div className="sync-sides">
      <div className="sync-side"><span className="sync-side-label"><Monitor size={14}/>Bu bilgisayar</span><div className="sync-path"><span title={local}>{local || 'Klasör seçilmedi'}</span><button className="button secondary" disabled={!!busy} onClick={() => void pick()}><FolderOpen size={14}/>Seç…</button></div></div>
      <div className="sync-side"><span className="sync-side-label"><Server size={14}/>Sunucu</span><div className="sync-path"><input value={remote} disabled={!!busy} onChange={e => { setRemote(e.target.value); setResult(null); }} onKeyDown={e => { if (e.key === 'Enter') void compare(); }} aria-label="Sunucudaki klasör" spellCheck={false}/></div></div>
    </div>
    <div className="sync-options">
      <label>Hariç tut<input value={exclude} disabled={!!busy} onChange={e => setExclude(e.target.value)} placeholder="örnek: .git, node_modules, *.log" spellCheck={false}/></label>
      <label>Yön<select className="ops-state" value={mode} disabled={!!busy} onChange={e => { setMode(e.target.value as Mode); setChosen({}); setConfirming(false); }}><option value="both">İki yönlü: yeni olan kazanır</option><option value="upload">Yalnız sunucuya gönder</option><option value="download">Yalnız bilgisayara al</option></select></label>
      <button className="button primary" disabled={!!busy || !local} onClick={() => void compare()}><GitCompare size={14}/>Karşılaştır</button>
    </div>
    <div className="dialog-body sync-body">
      {error && <div className="error-message" role="alert">{error}</div>}
      {done && !error && <div className={done.failed.length ? 'error-message' : 'ops-notice'} role="status">{doneText || 'Aktarılacak değişiklik yoktu.'}{done.cancelled ? ' · Eşitleme iptal edildi.' : ''}
        {(done.skipped.length > 0 || done.failed.length > 0) && <ul className="sync-issues">{[...done.failed.map(f => `${f.path}: ${f.error}`), ...done.skipped.map(s => `${s.path}: ${s.reason}`)].slice(0, 8).map(text => <li key={text}>{text}</li>)}</ul>}
      </div>}
      {!result && !busy && !error && <p className="field-hint sync-intro">Bilgisayardaki klasörü seçip sunucudaki klasörün yolunu yazın, sonra Karşılaştır’a basın. Eşitleme yalnız sizin seçtiğiniz dosyaları kopyalar; hiçbir dosyayı silmez, hedefte daha yeni olan bir dosyanın da üzerine yazmaz.</p>}
      {busy && <p className="field-hint sync-intro">{busy}</p>}
      {result && <>
        <div className="sync-summary">
          <button className={!status ? 'selected' : ''} onClick={() => setStatus('')}>Değişenler <b>{number(rows.length - (counts.same || 0))}</b></button>
          {ORDER.filter(s => counts[s]).map(s => <button key={s} className={`${status === s ? 'selected' : ''} tone-${s}`} onClick={() => setStatus(status === s ? '' : s)}>{STATUS[s]} <b>{number(counts[s])}</b></button>)}
          <div className="history-search sync-filter"><Search size={13}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Dosya ara" aria-label="Dosya ara"/></div>
          {!status && <label className="check"><input type="checkbox" checked={showSame} onChange={e => setShowSame(e.target.checked)}/>Aynı olanlar da görünsün</label>}
        </div>
        <div className="sync-table" role="table" aria-label="Karşılaştırma sonucu">
          <div className="sync-row sync-head" role="row"><span>Dosya</span><span>Bilgisayar</span><span className="sync-dir-head">Yön</span><span>Sunucu</span></div>
          {visible.slice(0, SHOWN).map(row => { const d = direction(row); return <div className={`sync-row status-${row.status}`} role="row" key={row.path}>
            <span className="sync-name" title={row.path}>{row.directory && <Folder size={13}/>}<strong>{row.path}</strong><small>{STATUS[row.status]}</small></span>
            <span className="sync-side-cell">{side(row.local)}</span>
            <span className="sync-direction" role="radiogroup" aria-label={`${row.path} yönü`}>
              <button role="radio" aria-checked={d === 'download'} title="Sunucudan bilgisayara" disabled={!allowed(row, 'download')} className={d === 'download' ? 'selected' : ''} onClick={() => setDirection(row, 'download')}><ArrowLeft size={13}/></button>
              <button role="radio" aria-checked={d === 'skip'} title="Dokunma" className={d === 'skip' ? 'selected' : ''} onClick={() => setDirection(row, 'skip')}><Minus size={13}/></button>
              <button role="radio" aria-checked={d === 'upload'} title="Bilgisayardan sunucuya" disabled={!allowed(row, 'upload')} className={d === 'upload' ? 'selected' : ''} onClick={() => setDirection(row, 'upload')}><ArrowRight size={13}/></button>
            </span>
            <span className="sync-side-cell">{side(row.remote)}</span>
          </div>; })}
          {!visible.length && <p className="field-hint history-empty">{!rows.length ? 'İki klasör de boş.' : !status && !q && rows.every(r => r.status === 'same') ? 'İki klasör eşit; değişen dosya yok.' : 'Gösterilecek satır yok.'}</p>}
          {visible.length > SHOWN && <p className="field-hint history-empty">İlk {number(SHOWN)} satır gösteriliyor ({number(visible.length)} satır var). Dosya aramasıyla daraltabilirsiniz; seçilen yönler bütün satırlara uygulanır.</p>}
        </div>
        {(result.skipped.local > 0 || result.skipped.remote > 0) && <p className="field-hint">Bağlantı ve özel dosyalar karşılaştırılmadı: bilgisayarda {number(result.skipped.local)}, sunucuda {number(result.skipped.remote)}.</p>}
      </>}
    </div>
    {result && <footer className="dialog-footer sync-footer">
      <span>{confirming
        ? <><strong>{number(overwrites)} dosyanın üzerine yazılacak.</strong> Hedefte daha yeni olanlar atlanır. Devam edilsin mi?</>
        : plan.length ? <><ArrowRight size={13}/> {number(files(uploads))} dosya sunucuya · <ArrowLeft size={13}/> {number(files(downloads))} dosya bilgisayara · {size(bytes)}</> : 'Eşitlenecek dosya seçilmedi.'}</span>
      {confirming && <button className="button secondary" onClick={() => setConfirming(false)}>Vazgeç</button>}
      <button className="button primary" disabled={!!busy || !plan.length} onClick={() => void start()}>{confirming ? 'Üzerine yaz ve eşitle' : 'Eşitle'}</button>
    </footer>}
  </section></div>;
}
