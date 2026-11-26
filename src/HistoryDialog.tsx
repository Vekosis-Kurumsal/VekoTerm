import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CornerDownLeft, Play, Search, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { HistoryEntry, Session } from './types';

const clock = (d: Date) => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
function when(time: number) {
  const d = new Date(time), today = new Date(), yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `Bugün ${clock(d)}`;
  if (d.toDateString() === yesterday.toDateString()) return `Dün ${clock(d)}`;
  return `${d.toLocaleDateString('tr-TR')} ${clock(d)}`;
}
const place = (e: { type: string; username: string; host: string }) => e.type === 'local' ? 'Bu bilgisayar' : `${e.username ? e.username + '@' : ''}${e.host}`;
const sendable = (s: Session | null) => !!s && s.status === 'connected' && ['ssh', 'local', 'telnet', 'serial'].includes(s.type);

// Commands typed in terminals, newest first. Enter types the chosen one into the active terminal, Shift+Enter runs it.
export function HistoryDialog({ session, close, insert }: { session: Session | null; close: () => void; insert: (command: string, execute: boolean) => void }) {
  const [items, setItems] = useState<HistoryEntry[]>([]), [query, setQuery] = useState(''), [onlyHere, setOnlyHere] = useState(false);
  const [index, setIndex] = useState(0), [error, setError] = useState(''), [confirmClear, setConfirmClear] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const refresh = () => api.historyList().then(setItems).catch(e => setError(e.message));
  useEffect(() => { void refresh(); return api.onEvent(e => { if (e.type === 'history') void refresh(); }); }, []);
  const here = (e: HistoryEntry) => !!session && (session.type === 'local' ? e.type === 'local' : e.host === session.host && e.username === session.username);
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('tr');
    return items.filter(e => (!onlyHere || here(e)) && (!q || [e.command, e.name, place(e)].some(v => v.toLocaleLowerCase('tr').includes(q)))).slice(0, 500);
  }, [items, query, onlyHere, session]);
  useEffect(() => setIndex(0), [query, onlyHere]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);
  const canSend = sendable(session);
  const choose = (entry: HistoryEntry, execute: boolean) => { if (!canSend) return; insert(entry.command, execute); close(); };
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(Math.max(shown.length - 1, 0), i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && shown[index] && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); choose(shown[index], e.shiftKey); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  const remove = (entry: HistoryEntry) => api.historyRemove(entry.id).then(refresh).catch(e => setError(e.message));
  return <div className="modal-backdrop"><section className="small-dialog history-dialog" role="dialog" aria-modal="true" aria-label="Komut geçmişi" onKeyDown={keys}>
    <header className="dialog-header"><h2>Komut geçmişi</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <div className="dialog-body">
      <div className="history-search"><Search size={15}/><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Komut veya sunucu ara" aria-label="Komut geçmişinde ara"/></div>
      <label className="check"><input type="checkbox" checked={onlyHere} disabled={!session} onChange={e => setOnlyHere(e.target.checked)}/>{session?.type === 'local' ? 'Yalnız bu bilgisayar' : `Yalnız bu sunucu${session ? ` (${place(session)})` : ''}`}</label>
      <div className="history-list" ref={list} role="listbox" aria-label="Komutlar">
        {shown.map((entry, i) => <div key={entry.id} role="option" aria-selected={i === index} className={`history-row ${i === index ? 'selected' : ''}`} onMouseEnter={() => setIndex(i)} onDoubleClick={() => choose(entry, false)}>
          <span className="history-text"><code>{entry.command}</code><small>{[entry.name, place(entry)].filter((v, n, all) => v && all.indexOf(v) === n).join(' · ')} · {when(entry.time)}{entry.count > 1 ? ` · ${entry.count} kez` : ''}</small></span>
          <span className="history-actions">
            <button title="Terminale yaz (Enter)" aria-label={`${entry.command} komutunu terminale yaz`} disabled={!canSend} onClick={() => choose(entry, false)}><CornerDownLeft size={14}/></button>
            <button title="Çalıştır (Shift+Enter)" aria-label={`${entry.command} komutunu çalıştır`} disabled={!canSend} onClick={() => choose(entry, true)}><Play size={14}/></button>
            <button title="Geçmişten sil" aria-label={`${entry.command} komutunu geçmişten sil`} onClick={() => remove(entry)}><Trash2 size={14}/></button>
          </span>
        </div>)}
        {!shown.length && <p className="field-hint history-empty">{items.length ? 'Aramaya uyan komut yok.' : 'Henüz kayıtlı komut yok. Terminalde çalıştırdığınız komutlar burada görünür.'}</p>}
      </div>
      <p className="field-hint">↑/↓ ile seçin. Enter komutu terminale yazar, Shift+Enter çalıştırır. Parola sorularına yazılanlar, parola veya anahtar içeren komutlar ve başında boşluk olan komutlar kaydedilmez.</p>
      {!canSend && <p className="field-hint">Komut göndermek için açık bir terminal sekmesi seçin.</p>}
      {error && <div className="error-message" role="alert">{error}</div>}
    </div>
    <footer className="dialog-footer">{confirmClear
      ? <><span className="field-hint">Bütün komut geçmişi silinsin mi?</span><button className="button secondary" onClick={() => setConfirmClear(false)}>Vazgeç</button><button className="button danger" onClick={() => api.historyClear().then(() => { setConfirmClear(false); return refresh(); }).catch(e => setError(e.message))}><Trash2 size={14}/>Evet, temizle</button></>
      : <button className="button secondary" disabled={!items.length} onClick={() => setConfirmClear(true)}><Trash2 size={14}/>Geçmişi temizle</button>}</footer>
  </section></div>;
}
