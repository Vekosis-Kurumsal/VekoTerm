import { useEffect, useState } from 'react';
import { Server, Cpu, MemoryStick, ArrowUp, ArrowDown, Clock, HardDrive, X } from 'lucide-react';
import { api } from './api';
import type { RemoteStats, Session } from './types';
const bytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`;
// Small usage bar; colour changes at 70% and 90%.
const Meter = ({ percent }: { percent: number }) => { const value = Math.max(0, Math.min(100, percent)); return <span className={`usage-meter ${value >= 90 ? 'critical' : value >= 70 ? 'warning' : ''}`} aria-hidden="true"><i style={{ width: `${value}%` }}/></span>; };
export function RemoteMonitor({ session, close }: { session: Session; close: () => void }) {
  const [stats, setStats] = useState<RemoteStats|null>(null), [error, setError] = useState('');
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try { const data = await api.monitor(session.id); if (!stopped) { setStats(data); setError(''); } }
      catch (e: any) { if (!stopped) setError(e.message); }
      finally { if (!stopped) timer = setTimeout(update, 3000); }
    };
    void update(); return () => { stopped = true; clearTimeout(timer); };
  }, [session.id]);
  return <div className="remote-monitor" aria-label="Sunucu izleme"><span className="monitor-host" title={session.name}><Server size={13}/>{session.type === 'local' ? 'Bu bilgisayar' : session.name}</span>
    {error ? <span className="monitor-error" title={error}>Sistem bilgileri okunamadı</span> : stats ? <>
      <span title="CPU kullanımı"><Cpu size={13}/>{stats.cpu === null ? '—' : `${stats.cpu.toFixed(0)}%`}{stats.cpu !== null && <Meter percent={stats.cpu}/>}</span>
      <span title="Kullanılan / toplam bellek"><MemoryStick size={13}/>{bytes(stats.memoryUsed)} / {bytes(stats.memoryTotal)}{stats.memoryTotal > 0 && <Meter percent={stats.memoryUsed * 100 / stats.memoryTotal}/>}</span>
      <span title="Giden ağ trafiği"><ArrowUp size={13}/>{bytes(stats.tx)}/s</span><span title="Gelen ağ trafiği"><ArrowDown size={13}/>{bytes(stats.rx)}/s</span>
      <span title="Çalışma süresi"><Clock size={13}/>{Math.floor(stats.uptime / 86400)} gün {Math.floor(stats.uptime / 3600) % 24} sa</span>
      {stats.disks.map(disk => <span key={disk.mount} title={`${bytes(disk.used)} / ${bytes(disk.total)}`}><HardDrive size={13}/>{disk.mount}: {disk.percent}%<Meter percent={disk.percent}/></span>)}
    </> : <span>Bilgiler alınıyor…</span>}
    <button className="monitor-close" title="Sunucu izlemeyi kapat" aria-label="Sunucu izlemeyi kapat" onClick={close}><X size={13}/></button>
  </div>;
}
