import { useEffect, useState } from 'react';
import { Play, X } from 'lucide-react';
import { api } from './api';
import { fillMacro, macroVariables } from './macroVariables';
import type { Macro } from './types';

// Asks the values of a macro's {name} placeholders before it runs; the last values are offered again.
export function MacroRunDialog({ macro, where, close, start }: { macro: Macro; where: string; close: () => void; start: (values: Record<string, string>) => Promise<unknown> }) {
  const names = macroVariables(macro.commands);
  const [values, setValues] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.macroVariables().then(memory => setValues(Object.fromEntries(names.map(n => [n, memory[n] || ''])))).catch(() => {}); }, [macro.id]);
  const ready = names.every(n => (values[n] || '').trim());
  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true); setError('');
    try { await start(values); close(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section className="small-dialog macro-run-dialog" role="dialog" aria-modal="true" aria-label="Makro değişkenleri">
    <header className="dialog-header"><h2>{macro.name}</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <form className="dialog-body" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <p className="field-hint">{where} üzerinde çalışacak. Yazdığınız değerler komutlarda yerine konur.</p>
      {names.map((name, i) => <label key={name}>{`{${name}}`}<input autoFocus={i === 0} value={values[name] || ''} spellCheck={false} onChange={e => setValues(v => ({ ...v, [name]: e.target.value.replace(/[\r\n]/g, '') }))}/></label>)}
      <div className="macro-preview" aria-label="Gönderilecek komutlar"><pre>{fillMacro(macro.commands, values)}</pre></div>
      {error && <div className="error-message" role="alert">{error}</div>}
      <button type="submit" hidden/>
    </form>
    <footer className="dialog-footer"><button className="button secondary" onClick={close}>Vazgeç</button><button className="button primary" disabled={!ready || busy} onClick={() => void submit()}><Play size={14}/>Çalıştır</button></footer>
  </section></div>;
}
