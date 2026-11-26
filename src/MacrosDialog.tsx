import { useEffect, useState } from 'react';
import { Play, Plus, Save, Square, Trash2, X } from 'lucide-react';
import { api } from './api';
import type { Macro, MacroRun, Session } from './types';
import { MacroRunDialog } from './MacroRunDialog';
import { macroVariables } from './macroVariables';

const blank = (): Macro => ({ id: '', name: '', commands: '', delayMs: 150, shortcut: 0 });
export function MacrosDialog({ sessions, active, draft, jobs, close }: { sessions: Session[]; active: string; draft?: string; jobs: MacroRun[]; close: () => void }) {
  const [items, setItems] = useState<Macro[]>([]), [form, setForm] = useState<Macro>({ ...blank(), commands: draft || '' });
  const [targets, setTargets] = useState<string[]>([active]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<{ macro: Macro; targets: string[] } | null>(null);
  const terminals = sessions.filter(s => s.status === 'connected' && ['ssh', 'local', 'telnet','serial'].includes(s.type));
  const refresh = async () => setItems(await api.macroList());
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const save = async (start: boolean) => {
    const saved = await api.saveMacro(form); setForm(saved); await refresh(); if (!start) return;
    const chosen = targets.filter(id => terminals.some(s => s.id === id));
    if (macroVariables(saved.commands).length) setAsk({ macro: saved, targets: chosen }); else await api.startMacro(saved.id, chosen);
  };
  const variables = macroVariables(form.commands);
  return <div className="modal-backdrop"><section className="small-dialog macros-dialog" role="dialog" aria-modal="true" aria-label="Makrolar">
    <header className="dialog-header"><h2>Makrolar</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <div className="dialog-body">
      <div className="saved-tool-list">{items.map(item => <div key={item.id}><button className={item.id === form.id ? 'selected' : ''} onClick={() => setForm(item)}>{item.name}{item.shortcut ? <> <small className="shortcut-badge">Alt+{item.shortcut}</small></> : null}</button><button title={`${item.name} makrosunu sil`} disabled={busy} onClick={() => run(async () => { await api.removeMacro(item.id); if (form.id === item.id) setForm(blank()); await refresh(); })}><Trash2 size={14}/></button></div>)}</div>
      <button className="text-accent" onClick={() => setForm(blank())}><Plus size={14}/>Yeni makro</button>
      <label>Makro adı<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
      <label>Komutlar<textarea className="commands-input" rows={8} spellCheck={false} value={form.commands} onChange={e => setForm({ ...form, commands: e.target.value })} placeholder={'pwd\nls -la'}/></label>
      <p className="field-hint">Her satır Enter ile gönderilir. Komutların bitmesi beklenmez. Değişken için <code>{'{servis}'}</code> gibi süslü parantez içinde bir ad yazın; değeri çalıştırırken sorulur. Parola ve tek kullanımlık kodları makroya ya da değişkenlere yazmayın.</p>
      {variables.length > 0 && <p className="field-hint">Değişkenler: {variables.map(v => `{${v}}`).join(', ')}</p>}
      <label>Kısayol<select value={form.shortcut || 0} onChange={e => setForm({ ...form, shortcut: Number(e.target.value) })}><option value={0}>Yok</option>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => { const owner = items.find(m => m.shortcut === n && m.id !== form.id); return <option key={n} value={n}>Alt+{n}{owner ? ` (şu an “${owner.name}”)` : ''}</option>; })}</select></label>
      <p className="field-hint">Etkin terminalde Alt ile seçilen rakama basınca makro o terminalde çalışır. Kısayolu olmayan Alt+rakam terminale gider.</p>
      <label>Satırlar arası bekleme (ms)<input type="number" min="0" max="10000" step="50" value={form.delayMs} onChange={e => setForm({ ...form, delayMs: Number(e.target.value) })}/></label>
      <fieldset className="target-picker"><legend>Çalıştırılacak terminaller</legend>{terminals.length ? terminals.map(s => <label className="check" key={s.id}><input type="checkbox" checked={targets.includes(s.id)} onChange={e => setTargets(ids => e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id))}/>{s.name}<small>{s.host || 'Yerel'}</small></label>) : <p className="field-hint">Önce bir terminal bağlantısı açın.</p>}</fieldset>
      {jobs.filter(j => j.status === 'running').map(j => <div className="macro-running" key={j.id}><span>{j.name} çalışıyor</span><button className="button secondary" onClick={() => run(() => api.stopMacro(j.id))}><Square size={13}/>Durdur</button></div>)}
      {error && <div className="error-message" role="alert">{error}</div>}
    </div>
    <footer className="dialog-footer"><button className="button secondary" disabled={busy || !form.name.trim() || !form.commands.trim()} onClick={() => run(() => save(false))}><Save size={14}/>Kaydet</button><button className="button primary" disabled={busy || !form.name.trim() || !form.commands.trim() || !targets.some(id => terminals.some(s => s.id === id))} onClick={() => run(() => save(true))}><Play size={14}/>Kaydet ve çalıştır</button></footer>
  </section>{ask && <MacroRunDialog macro={ask.macro} where={`${ask.targets.length} terminal`} close={() => setAsk(null)} start={values => api.startMacro(ask.macro.id, ask.targets, values)}/>}</div>;
}
