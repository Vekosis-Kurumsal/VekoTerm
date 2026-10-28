import { useEffect, useState } from 'react';
import { Play, Save, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { SavedWorkspace, Session } from './types';
export function WorkspacesDialog({ sessions, layout, targets, active, restored, close }: { sessions: Session[]; layout: string; targets: string[]; active: string; restored: (value: Awaited<ReturnType<typeof api.openWorkspace>>) => void; close: () => void }) {
  const [items, setItems] = useState<SavedWorkspace[]>([]), [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => setItems(await api.workspaceList());
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="Çalışma alanları"><header className="dialog-header"><h2>Çalışma alanları</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header><div className="dialog-body">
    <p className="field-hint">Sekmelerin sırası ve bölme düzeni kaydedilir. Yeniden açtığınızda yeni bağlantılar kurulur; terminalde çalışan işlemler geri yüklenmez.</p>
    <div className="saved-tool-list">{items.map(item => <div key={item.id}><span className="workspace-name"><strong>{item.name}</strong><small>{item.entries.length} oturum · {({ single: 'Tek', columns: 'Yan yana', rows: 'Alt alta', grid: 'Dört bölme' })[item.layout]}</small></span><button disabled={busy} title={`${item.name} çalışma alanını aç`} onClick={() => run(async () => { const result = await api.openWorkspace(item.id); restored(result); if (result.errors.length) setError(result.errors.join('\n')); else close(); })}><Play size={15}/></button><button disabled={busy} title={`${item.name} çalışma alanını sil`} onClick={() => run(async () => { await api.removeWorkspace(item.id); await refresh(); })}><Trash2 size={15}/></button></div>)}</div>
    {!items.length && <p className="field-hint">Henüz kayıtlı çalışma alanı yok.</p>}
    <label>Yeni çalışma alanının adı<input value={name} onChange={e => setName(e.target.value)} placeholder="Örn. Sabah kontrolleri"/></label>
    <p className="field-hint">Şu anda açık olan {sessions.length} sekme kaydedilecek. Parolalar çalışma alanına kopyalanmaz.</p>
    {error && <div className="error-message" role="alert" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
  </div><footer className="dialog-footer"><button className="button primary" disabled={busy || !name.trim() || !sessions.length} onClick={() => run(async () => { await api.saveWorkspace({ name, sessionIds: sessions.map(s => s.id), layout, targets, active }); setName(''); await refresh(); })}><Save size={14}/>{busy ? 'Hazırlanıyor…' : 'Mevcut düzeni kaydet'}</button></footer></section></div>;
}
