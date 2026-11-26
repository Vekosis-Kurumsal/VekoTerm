import { useEffect, useMemo, useState } from 'react';
import { FileText, Play, RefreshCw, RotateCw, Search, Square, TerminalSquare, X, XOctagon } from 'lucide-react';
import { api } from './api';
import type { ContainerRow, ProcessRow, ServiceRow, Session } from './types';

type Tab = 'services' | 'processes' | 'docker';
// A change waiting for confirmation; "force" is offered only when ending a process.
type Pending = { text: string; label: string; danger: boolean; run: (force: boolean) => Promise<unknown>; force?: boolean };
const SUDO = /sudo parola soruyor/;
const decimal = (n: number, digits: number) => n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const megabytes = (bytes: number) => `${decimal(bytes / 1048576, bytes < 104857600 ? 1 : 0)} MB`;
// Docker reports "0.52%" and "12.4MiB / 1.9GiB"; shown the Turkish way like the process list.
const dockerCpu = (text: string) => { const n = parseFloat(text); return Number.isFinite(n) ? `%${decimal(n, n < 10 ? 2 : 1)} CPU` : '–'; };
const dockerMemory = (text: string) => { const m = /^([\d.]+)\s*([A-Za-z]+)/.exec(text.split('/')[0].trim()); return m ? `${decimal(parseFloat(m[1]), 1)} ${m[2]}` : (text.split('/')[0].trim() || '–'); };
const verb = { start: 'Başlat', stop: 'Durdur', restart: 'Yeniden başlat' } as const;
const serviceRank = (s: ServiceRow) => s.active === 'failed' ? 0 : s.active === 'active' ? 1 : 2;

// systemd services with their journal, processes and Docker containers of the server behind an SSH tab.
export function OpsDialog({ session, close, typeInTerminal }: { session: Session; close: () => void; typeInTerminal?: (command: string) => void }) {
  const [tab, setTab] = useState<Tab>('services'), [filter, setFilter] = useState(''), [state, setState] = useState<'all' | 'running' | 'failed' | 'stopped'>('all');
  const [services, setServices] = useState<ServiceRow[]>([]), [processes, setProcesses] = useState<ProcessRow[]>([]), [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [sudo, setSudo] = useState('');
  const [log, setLog] = useState<{ title: string; text: string } | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const load = async (which: Tab = tab) => {
    setLoading(true); setError(''); setSudo('');
    try {
      if (which === 'services') setServices(await api.ops(session.id, 'services'));
      if (which === 'processes') setProcesses(await api.ops(session.id, 'processes'));
      if (which === 'docker') setContainers(await api.ops(session.id, 'docker'));
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { setFilter(''); setLog(null); setPending(null); setNotice(''); void load(tab); }, [tab, session.id]);
  const act = async (task: () => Promise<unknown>, done: string, sudoCommand: string) => {
    setLoading(true); setError(''); setNotice(''); setSudo('');
    try { await task(); setNotice(done); await load(); }
    catch (e: any) { setError(e.message); if (SUDO.test(e.message)) setSudo(sudoCommand); }
    finally { setLoading(false); }
  };
  const showLog = async (title: string, action: 'serviceLog' | 'dockerLogs', name: string, sudoCommand: string) => {
    setLoading(true); setError(''); setSudo('');
    try { setLog({ title, text: (await api.ops(session.id, action, name, 200)) || 'Günlük boş.' }); }
    catch (e: any) { setError(e.message); if (SUDO.test(e.message)) setSudo(sudoCommand); }
    finally { setLoading(false); }
  };
  const q = filter.trim().toLocaleLowerCase('tr');
  const shownServices = useMemo(() => services
    .filter(s => state === 'all' || (state === 'running' && s.active === 'active') || (state === 'failed' && s.active === 'failed') || (state === 'stopped' && s.active === 'inactive'))
    .filter(s => !q || `${s.unit} ${s.description}`.toLocaleLowerCase('tr').includes(q))
    .sort((a, b) => serviceRank(a) - serviceRank(b) || a.unit.localeCompare(b.unit)), [services, q, state]);
  const shownProcesses = useMemo(() => processes.filter(p => !q || `${p.pid} ${p.user} ${p.command}`.toLocaleLowerCase('tr').includes(q)), [processes, q]);
  const shownContainers = useMemo(() => containers.filter(c => !q || `${c.name} ${c.image} ${c.id}`.toLocaleLowerCase('tr').includes(q)), [containers, q]);
  const serviceAction = (s: ServiceRow, action: 'start' | 'stop' | 'restart') => {
    const run = () => act(() => api.ops(session.id, 'serviceAction', s.unit, action), `${s.unit}: ${verb[action].toLocaleLowerCase('tr')} komutu gönderildi.`, `sudo systemctl ${action} ${s.unit}`);
    if (action === 'start') void run(); else setPending({ text: `${s.unit} ${action === 'stop' ? 'durdurulsun' : 'yeniden başlatılsın'} mı?`, label: verb[action], danger: action === 'stop', run });
  };
  const dockerAction = (c: ContainerRow, action: 'start' | 'stop' | 'restart') => {
    const run = () => act(() => api.ops(session.id, 'dockerAction', c.name || c.id, action), `${c.name}: ${verb[action].toLocaleLowerCase('tr')} komutu gönderildi.`, `sudo docker ${action} ${c.name || c.id}`);
    if (action === 'start') void run(); else setPending({ text: `${c.name} konteyneri ${action === 'stop' ? 'durdurulsun' : 'yeniden başlatılsın'} mı?`, label: verb[action], danger: action === 'stop', run });
  };
  const kill = (p: ProcessRow) => setPending({ text: `${p.pid} numaralı süreç (${p.command.slice(0, 60)}) sonlandırılsın mı?`, label: 'Sonlandır', danger: true, force: false,
    run: force => act(() => api.ops(session.id, 'kill', p.pid, force), `${p.pid} numaralı sürece ${force ? 'KILL' : 'TERM'} sinyali gönderildi.`, `sudo kill -s ${force ? 'KILL' : 'TERM'} ${p.pid}`) });
  const confirm = () => { if (!pending) return; const current = pending; setPending(null); void current.run(!!current.force); };
  const placeholder = { services: 'Servis ara', processes: 'Süreç, kullanıcı veya PID ara', docker: 'Konteyner veya imaj ara' }[tab];
  return <div className="modal-backdrop"><section className="small-dialog ops-dialog" role="dialog" aria-modal="true" aria-label="Sunucu işlemleri">
    <header className="dialog-header"><h2>Sunucu işlemleri <small>{session.name} · {session.username ? session.username + '@' : ''}{session.host}</small></h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <div className="ops-toolbar">
      <div className="ops-tabs" role="tablist">{(['services', 'processes', 'docker'] as Tab[]).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{{ services: 'Servisler', processes: 'Süreçler', docker: 'Docker' }[t]}</button>)}</div>
      <div className="history-search ops-search"><Search size={14}/><input value={filter} onChange={e => setFilter(e.target.value)} placeholder={placeholder} aria-label={placeholder}/></div>
      {tab === 'services' && <select className="ops-state" aria-label="Servis durumu" value={state} onChange={e => setState(e.target.value as typeof state)}><option value="all">Tümü</option><option value="running">Çalışanlar</option><option value="failed">Hatalılar</option><option value="stopped">Durmuş olanlar</option></select>}
      <button className="icon-button" title="Yenile" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? 'spin' : ''}/></button>
    </div>
    <div className="dialog-body ops-body">
      {error && <div className="error-message" role="alert">{error}{sudo && <div className="ops-sudo"><code>{sudo}</code>{typeInTerminal && <button className="button secondary" onClick={() => { typeInTerminal(sudo); close(); }}><TerminalSquare size={14}/>Terminalde sudo ile çalıştır</button>}</div>}</div>}
      {notice && !error && <div className="ops-notice" role="status">{notice}</div>}
      <div className="ops-table" role="table" aria-label={{ services: 'Servisler', processes: 'Süreçler', docker: 'Konteynerler' }[tab]}>
        {tab === 'services' && shownServices.map(s => <div className="ops-row" role="row" key={s.unit}>
          <span className="ops-main"><strong>{s.unit.replace(/\.service$/, '')}</strong><small>{s.description}</small></span>
          <span className={`ops-pill ${s.active}`}>{s.active === 'active' ? (s.sub === 'running' ? 'Çalışıyor' : 'Etkin') : s.active === 'failed' ? 'Hata' : s.active === 'inactive' ? 'Durmuş' : s.active}</span>
          <span className="ops-actions">
            <button title="Son 200 günlük satırı" aria-label={`${s.unit} günlüğü`} onClick={() => void showLog(`${s.unit} · son 200 satır`, 'serviceLog', s.unit, `sudo journalctl -u ${s.unit} -n 200 --no-pager`)}><FileText size={14}/></button>
            {s.active !== 'active' && <button title="Başlat" aria-label={`${s.unit} başlat`} onClick={() => serviceAction(s, 'start')}><Play size={14}/></button>}
            <button title="Yeniden başlat" aria-label={`${s.unit} yeniden başlat`} onClick={() => serviceAction(s, 'restart')}><RotateCw size={14}/></button>
            {s.active === 'active' && <button title="Durdur" aria-label={`${s.unit} durdur`} onClick={() => serviceAction(s, 'stop')}><Square size={14}/></button>}
          </span>
        </div>)}
        {tab === 'processes' && shownProcesses.map(p => <div className="ops-row" role="row" key={p.pid}>
          <span className="ops-main"><strong>{p.command}</strong><small>PID {p.pid} · {p.user} · {p.elapsed}</small></span>
          <span className="ops-metric">%{decimal(p.cpu, 1)} CPU</span><span className="ops-metric">{megabytes(p.rss)}</span>
          <span className="ops-actions"><button title="Sonlandır" aria-label={`${p.pid} sonlandır`} onClick={() => kill(p)}><XOctagon size={14}/></button></span>
        </div>)}
        {tab === 'docker' && shownContainers.map(c => <div className="ops-row" role="row" key={c.id}>
          <span className="ops-main"><strong>{c.name}</strong><small>{c.image}{c.ports ? ` · ${c.ports}` : ''}</small></span>
          <span className={`ops-pill ${c.state === 'running' ? 'active' : c.state === 'exited' ? 'inactive' : 'failed'}`}>{c.state === 'running' ? 'Çalışıyor' : c.state === 'exited' ? 'Durmuş' : c.state}</span>
          <span className="ops-metric">{c.cpu ? dockerCpu(c.cpu) : '–'}</span><span className="ops-metric">{c.memory ? dockerMemory(c.memory) : '–'}</span>
          <span className="ops-actions">
            <button title="Son 200 günlük satırı" aria-label={`${c.name} günlüğü`} onClick={() => void showLog(`${c.name} · son 200 satır`, 'dockerLogs', c.name || c.id, `sudo docker logs --tail 200 ${c.name || c.id}`)}><FileText size={14}/></button>
            {c.state !== 'running' && <button title="Başlat" aria-label={`${c.name} başlat`} onClick={() => dockerAction(c, 'start')}><Play size={14}/></button>}
            <button title="Yeniden başlat" aria-label={`${c.name} yeniden başlat`} onClick={() => dockerAction(c, 'restart')}><RotateCw size={14}/></button>
            {c.state === 'running' && <button title="Durdur" aria-label={`${c.name} durdur`} onClick={() => dockerAction(c, 'stop')}><Square size={14}/></button>}
          </span>
        </div>)}
        {!loading && !error && { services: shownServices, processes: shownProcesses, docker: shownContainers }[tab].length === 0 && <p className="field-hint history-empty">{tab === 'docker' && !containers.length ? 'Bu sunucuda konteyner yok.' : 'Gösterilecek kayıt yok.'}</p>}
      </div>
      {log && <div className="ops-log"><header><strong>{log.title}</strong><button className="icon-button" title="Günlüğü kapat" onClick={() => setLog(null)}><X size={14}/></button></header><pre>{log.text}</pre></div>}
    </div>
    {pending && <footer className="dialog-footer ops-confirm">
      <span>{pending.text}</span>
      {pending.force !== undefined && <label className="check"><input type="checkbox" checked={pending.force} onChange={e => setPending({ ...pending, force: e.target.checked })}/>Zorla (KILL)</label>}
      <button className="button secondary" onClick={() => setPending(null)}>Vazgeç</button>
      <button className={`button ${pending.danger ? 'danger' : 'primary'}`} onClick={confirm}>{pending.label}</button>
    </footer>}
  </section></div>;
}
