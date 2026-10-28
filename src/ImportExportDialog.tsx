import { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { api } from './api';

export function ImportExportDialog({ mode, close, completed }: { mode: 'import'|'export'; close: () => void; completed: (message: string) => Promise<void> }) {
  const [encrypted, setEncrypted] = useState(false), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [mobaSource, setMobaSource] = useState('');
  const section = useRef<HTMLElement>(null);
  const importing = mode === 'import', title = importing ? 'Bağlantıları içe aktar' : 'Bağlantıları dışa aktar';
  useEffect(() => { const previous = document.activeElement as HTMLElement|null; section.current?.focus(); return () => previous?.focus(); }, []);
  useEffect(() => { if (importing) api.mobaxtermSources().then(list => setMobaSource(list[0] || '')).catch(() => setMobaSource('')); }, [importing]);
  const importMoba = async () => {
    setError(''); setBusy(true);
    try {
      const count = await api.importMobaXterm();
      if (count === null) return;
      await completed(count ? `${count} bağlantı MobaXterm'den alındı.` : 'MobaXterm’de yeni bağlantı yok; hepsi zaten kayıtlı.');
      close();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="modal-backdrop"><section ref={section} tabIndex={-1} className="small-dialog import-export-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) close(); }
    if (e.key === 'Tab') {
      const items = section.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === section.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }}>
    <header className="dialog-header"><h2>{title}</h2><button className="icon-button" title="Kapat" disabled={busy} onClick={close}><X size={19}/></button></header>
    <form onSubmit={async e => {
      e.preventDefault(); setError('');
      if (encrypted && !importing && password !== confirm) { setError('Yedek parolaları eşleşmiyor.'); return; }
      setBusy(true);
      try {
        const options = { encrypted, password: encrypted ? password : undefined };
        if (importing) {
          const count = await api.importProfiles(options);
          if (count === null) return;
          await completed(count ? `${count} bağlantı içe aktarıldı.` : 'Eklenecek yeni bağlantı yoktu; hepsi zaten kayıtlı.');
        } else {
          if (!await api.exportProfiles(options)) return;
          await completed(encrypted ? 'Parola korumalı bağlantı yedeği kaydedildi.' : 'Bağlantılar dışa aktarıldı.');
        }
        setPassword(''); setConfirm(''); close();
      } catch (e: any) { setError(e.message); }
      finally { setBusy(false); }
    }}>
      <fieldset className="import-export-fields" disabled={busy}>
        <div className="dialog-body">
          <label>{importing ? 'Dosya türü' : 'Yedek türü'}<select value={encrypted ? 'encrypted' : 'plain'} onChange={e => { setEncrypted(e.target.value === 'encrypted'); setPassword(''); setConfirm(''); setError(''); }}>
            <option value="plain">{importing ? 'MobaXterm oturumları / VekoTerm bağlantıları' : 'Bağlantılar — parolalar hariç'}</option>
            <option value="encrypted">VekoTerm şifreli yedeği — parolalar dahil</option>
          </select></label>
          {importing && !encrypted && mobaSource && <div className="moba-source">
            <strong>MobaXterm bu bilgisayarda bulundu</strong>
            <code title={mobaSource}>{mobaSource}</code>
            <button type="button" className="button primary" onClick={importMoba}><Download size={15}/>MobaXterm'den al</button>
          </div>}
          {importing && !encrypted && <div className="import-instructions">
            <p>{mobaSource ? 'Başka bir dosya için: ' : ''}MobaXterm’de bağlantı klasörüne sağ tıkla → <strong>Export sessions from this folder</strong>. Kaydettiğin .mxtsessions dosyasını “Dosya seç” ile aç. MobaXterm.ini ve VekoTerm .json dosyaları da desteklenir.</p>
            <p>SSH, SFTP, RDP ve VNC bağlantıları klasörleriyle alınır. Zaten kayıtlı olanlar (aynı tür, adres, port ve kullanıcı) atlanır. Desteklenmeyen kayıtlar özette gösterilir. MobaXterm’de saklanan şifreler otomatik aktarılmaz; ilk bağlantıda yeniden girip kaydedebilirsin.</p>
          </div>}
          {encrypted ? <>
            <p>VekoTerm bağlantıları, klasörler ve kayıtlı parolalar tek bir parola korumalı dosyada taşınır. {importing ? 'Yedeği oluştururken belirlediğin parolayı yaz.' : 'Yedeği açmak için gerekecek bir parola belirle.'}</p>
            <label>Yedek parolası<input type="password" autoComplete={importing ? 'current-password' : 'new-password'} required minLength={8} maxLength={4096} value={password} onChange={e => setPassword(e.target.value)}/></label>
            {!importing && <label>Yedek parolası tekrar<input type="password" autoComplete="new-password" required minLength={8} maxLength={4096} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>}
          </> : !importing && <p>Bağlantı ayarları ve boş klasörler JSON dosyasına kaydedilir. Kayıtlı parolalar bu dosyaya dahil edilmez.</p>}
          <p>SSH özel anahtar dosyaları yedeğe dahil değildir; yalnız dosya yolları saklanır.</p>
          {error && <div className="error-message" role="alert">{error}</div>}
        </div>
      </fieldset>
      <footer className="dialog-footer"><button type="button" className="text-button" disabled={busy} onClick={close}>Vazgeç</button><button className="button primary" disabled={busy}>{importing ? <Download size={15}/> : <Upload size={15}/>} {busy ? 'İşleniyor…' : importing ? 'Dosya seç' : 'Yedeği kaydet'}</button></footer>
    </form>
  </section></div>;
}
