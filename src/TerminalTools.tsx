import { Copy, Download, FileText, Eraser, Circle, Square, X } from 'lucide-react';
import { api } from './api';
import type { Session } from './types';

export function TerminalTools({ session, close, run, recorded }: { session: Session; close: () => void; run: (fn: () => Promise<any>, success?: string) => Promise<any>; recorded: (commands: string, skipped: number) => void }) {
  const action = (fn: () => Promise<any>, success?: string) => { close(); void run(fn, success); };
  return <div className="popover-dismiss" onMouseDown={close}><div className="session-tools-menu file-context-menu" role="menu" aria-label="Terminal işlemleri" onMouseDown={e => e.stopPropagation()}>
    <button role="menuitem" onClick={() => action(() => api.duplicateSession(session.id))}><Copy size={14}/>Oturumu çoğalt</button>
    <button role="menuitem" onClick={() => action(() => api.exportTerminal(session.id), 'Terminal çıktısı kaydedildi.')}><Download size={14}/>Çıktıyı dosyaya kaydet</button>
    <button role="menuitem" onClick={() => action(() => session.logging ? api.stopLog(session.id) : api.startLog(session.id), session.logging ? 'Dosyaya kayıt durduruldu.' : 'Çıktılar dosyaya kaydediliyor.')}><FileText size={14}/>{session.logging ? 'Dosyaya kaydı durdur' : 'Dosyaya kaydı başlat'}</button>
    <button role="menuitem" disabled={session.status !== 'connected' || !['ssh', 'local', 'telnet','serial'].includes(session.type)} onClick={() => action(async () => { if (session.recording) { const result = await api.stopRecording(session.id); recorded(result.commands, result.skipped); } else await api.startRecording(session.id); })}>{session.recording ? <Square size={14}/> : <Circle size={14}/>}Makro kaydını {session.recording ? 'bitir' : 'başlat'}</button>
    <button role="menuitem" onClick={() => action(() => api.clearTerminal(session.id))}><Eraser size={14}/>Terminali temizle</button>
    <button role="menuitem" onClick={() => action(() => api.close(session.id))}><X size={14}/>Sekmeyi kapat</button>
  </div></div>;
}
