import { X } from 'lucide-react';
import type { Session } from './types';
export type TerminalLayout = 'single'|'columns'|'rows'|'grid';
export function TerminalLayoutDialog({ kind, setKind, sessions, targets, setTargets, close, apply, mode }: { kind: TerminalLayout; setKind: (value: TerminalLayout) => void; sessions: Session[]; targets: string[]; setTargets: (ids: string[]) => void; close: () => void; apply: () => void; mode: 'layout'|'broadcast' }) {
  const max = mode === 'broadcast' ? 100 : kind === 'grid' ? 4 : kind === 'single' ? 1 : 2;
  return <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label={mode === 'layout' ? 'Terminal düzeni' : 'Çoklu komut hedefleri'}>
    <header className="dialog-header"><h2>{mode === 'layout' ? 'Terminal düzeni' : 'Çoklu komut hedefleri'}</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header>
    <div className="dialog-body">{mode === 'layout' && <label>Düzen<select value={kind} onChange={e => setKind(e.target.value as TerminalLayout)}><option value="single">Tek terminal</option><option value="columns">Yan yana</option><option value="rows">Alt alta</option><option value="grid">Dört bölme</option></select></label>}
      <p className="field-hint">{mode === 'layout' ? `Görüntülenecek en fazla ${max} terminali seçin. Sekmeye tıklamak o terminali ilk bölmeye getirir.` : 'Yazdıklarınız seçtiğiniz terminallere aynı anda gönderilir. Durdur düğmesi veya Esc ile kapatabilirsiniz.'}</p>
      <fieldset className="target-picker"><legend>Terminaller</legend>{sessions.map(s => <label key={s.id} className="check"><input type="checkbox" checked={targets.includes(s.id)} disabled={!targets.includes(s.id) && targets.length >= max} onChange={e => setTargets(e.target.checked ? [...targets, s.id] : targets.filter(id => id !== s.id))}/>{s.name}<small>{s.host || 'Yerel'}</small></label>)}</fieldset>
    </div><footer className="dialog-footer"><button className="button primary" disabled={mode === 'broadcast' && targets.length < 2} onClick={apply}>{mode === 'layout' ? 'Uygula' : 'Seçili terminallerde etkinleştir'}</button></footer>
  </section></div>;
}
