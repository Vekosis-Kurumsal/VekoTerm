import { useEffect, useState } from 'react';
import { Network, X, Play, Square, Pencil, Trash2, Plus } from 'lucide-react';
import { api } from './api';
import type { Profile, Session, Tunnel } from './types';
export function TunnelDialog({ profiles, current, close }: { profiles: Profile[]; current?: Session; close: () => void }) {
  const connections = profiles.filter(p => p.type === 'ssh');
  const empty = (): Tunnel => ({ id: '', name: '', profileId: current?.profileId || connections[0]?.id || '', kind: 'local', listenPort: 8080, targetHost: '127.0.0.1', targetPort: 80 });
  const [form, setForm] = useState<Tunnel>(empty), [items, setItems] = useState<{saved: Tunnel[]; running: Tunnel[]}>({ saved: [], running: [] }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => setItems(await api.tunnelList());
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const field = (key: keyof Tunnel, value: string|number) => setForm(previous => ({ ...previous, [key]: value }));
  const save = async (start: boolean) => { const saved = await api.saveTunnel(form); setForm(saved); if (start) await api.startSavedTunnel(saved.id); };
  return <div className="modal-backdrop"><section className="small-dialog tunnel-dialog" role="dialog" aria-modal="true" aria-label="SSH tünelleri"><header className="dialog-header"><h2><Network size={18}/> SSH tünelleri</h2><button className="icon-button" title="Kapat" onClick={close}><X size={19}/></button></header><div className="dialog-body">
    <div className="tunnel-saved"><header><strong>Kayıtlı tüneller</strong><button className="text-accent" onClick={() => setForm(empty())}><Plus size={13}/>Yeni</button></header>{items.saved.map(tunnel => {
      const running = items.running.some(r => r.id === tunnel.id);
      return <div className="saved-tunnel" key={tunnel.id}><span className={`dot ${running ? '' : 'muted'}`}/><div><strong>{tunnel.name}</strong><small>{tunnel.kind === 'dynamic' ? 'SOCKS5' : tunnel.kind === 'remote' ? 'Uzak' : 'Yerel'} · :{tunnel.listenPort}{tunnel.kind !== 'dynamic' && ` → ${tunnel.targetHost}:${tunnel.targetPort}`}</small></div><button title={running ? 'Tüneli durdur' : 'Tüneli başlat'} disabled={busy} onClick={() => run(() => running ? api.stopTunnel(tunnel.id) : api.startSavedTunnel(tunnel.id))}>{running ? <Square size={14}/> : <Play size={14}/>}</button><button title="Tüneli düzenle" disabled={busy} onClick={() => setForm(tunnel)}><Pencil size={13}/></button><button title="Tünel kaydını sil" disabled={busy || running} onClick={() => run(() => api.removeTunnel(tunnel.id))}><Trash2 size={13}/></button></div>;
    })}{!items.saved.length && <p className="field-hint">Tünellerini kaydedip buradan başlatabilir ve durdurabilirsin.</p>}</div>
    <label>Tünel adı<input value={form.name} onChange={e => field('name', e.target.value)} placeholder="Örn. Veritabanı erişimi"/></label>
    <label>SSH bağlantısı<select value={form.profileId} onChange={e => field('profileId', e.target.value)}>{connections.map(p => <option key={p.id} value={p.id}>{p.folder} / {p.name}</option>)}</select></label>
    <label>Tünel türü<select value={form.kind} onChange={e => field('kind', e.target.value)}><option value="local">Yerel port yönlendirme</option><option value="remote">Uzak port yönlendirme</option><option value="dynamic">Dinamik SOCKS5 proxy</option></select></label>
    <div className="form-row"><label>{form.kind === 'remote' ? 'Sunucuda dinlenecek port' : 'Bu bilgisayarda dinlenecek port'}<input type="number" min="1" max="65535" value={form.listenPort} onChange={e => field('listenPort', Number(e.target.value))}/></label>{form.kind !== 'dynamic' && <label>Hedef port<input type="number" min="1" max="65535" value={form.targetPort} onChange={e => field('targetPort', Number(e.target.value))}/></label>}</div>
    {form.kind !== 'dynamic' && <label>{form.kind === 'remote' ? 'Bu bilgisayardan erişilecek hedef' : 'Sunucudan erişilecek hedef'}<input value={form.targetHost} onChange={e => field('targetHost', e.target.value)}/></label>}
    <p className="field-hint">{form.kind === 'dynamic' ? `Uygulamalarında SOCKS5 proxy adresi olarak 127.0.0.1:${form.listenPort} kullanabilirsin.` : 'Dinleme adresi 127.0.0.1 ile sınırlıdır.'} SSH sekmesi açık değilse tünel kendi bağlantısını açar.</p>
    {error && <div className="error-message" role="alert">{error}</div>}
  </div><footer className="dialog-footer"><button className="button secondary" disabled={busy || !form.profileId} onClick={() => run(() => save(false))}>Kaydet</button><button className="button primary" disabled={busy || !form.profileId} onClick={() => run(() => save(true))}>{busy ? 'Hazırlanıyor…' : 'Kaydet ve başlat'}</button></footer></section></div>;
}
