import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Download, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { api } from './api';
import type { UpdateInfo, UpdateProgress } from './types';

type Phase = 'checking' | 'result' | 'downloading' | 'downloaded';
const megabytes = (n: number) => `${(n / 1048576).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
const day = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// Release notes are short Markdown: headings, lists, code blocks, `code` and **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('`') && part.endsWith('`') && part.length > 1 ? <code key={i}>{part.slice(1, -1)}</code> : part.startsWith('**') && part.endsWith('**') && part.length > 3 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>);
}
function Notes({ text }: { text: string }) {
  // The installation section of the release page (download, SmartScreen, checksum) is done here by VekoTerm itself.
  const blocks: ReactNode[] = [], lines = text.replace(/\r/g, '').split(/\n#{1,6}\s+Kurulum\s*\n/)[0].split('\n');
  let list: string[] = [], paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) { blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>); paragraph = []; }
    if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>); list = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) { flush(); const code: string[] = []; for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]); blocks.push(<pre key={blocks.length}>{code.join('\n')}</pre>); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line), item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading) { flush(); blocks.push(<h4 key={blocks.length}>{inline(heading[1])}</h4>); }
    else if (item) { if (paragraph.length) flush(); list.push(item[1]); }
    else if (!line.trim()) flush();
    else { if (list.length) flush(); paragraph.push(line.trim()); }
  }
  flush();
  return <div className="update-notes">{blocks}</div>;
}

// Checks GitHub for a newer published release; downloads, verifies and starts the installer on request.
export function UpdateDialog({ initial, close, found }: { initial: UpdateInfo | null; close: () => void; found: (info: UpdateInfo) => void }) {
  const [phase, setPhase] = useState<Phase>(initial ? 'result' : 'checking'), [info, setInfo] = useState<UpdateInfo | null>(initial);
  const [progress, setProgress] = useState<UpdateProgress | null>(null), [error, setError] = useState(''), [installing, setInstalling] = useState(false);
  const check = async () => {
    setPhase('checking'); setError('');
    try { const next = await api.updateCheck(); setInfo(next); found(next); } catch (e: any) { setError(e.message); } finally { setPhase('result'); }
  };
  useEffect(() => { if (!initial) void check(); }, []);
  useEffect(() => api.onEvent(event => { if (event.type === 'updateProgress' && event.progress) setProgress(event.progress); }), []);
  // Closing the window (also with Esc) stops a download that is still running.
  const current = useRef(phase); current.current = phase;
  useEffect(() => () => { if (current.current === 'downloading') void api.updateCancel(); }, []);
  const download = async () => {
    setPhase('downloading'); setError(''); setProgress({ bytes: 0, total: info?.size || 0 });
    try { await api.updateDownload(); setPhase('downloaded'); } catch (e: any) { setError(e.message); setPhase('result'); }
  };
  const install = async () => {
    setInstalling(true); setError('');
    try { if (!await api.updateInstall()) setInstalling(false); } catch (e: any) { setError(e.message); setInstalling(false); }
  };
  const percent = progress?.total ? Math.min(100, Math.floor(progress.bytes * 100 / progress.total)) : 0;
  const available = !!info?.available;

  return <div className="modal-backdrop"><section className="small-dialog update-dialog" role="dialog" aria-modal="true" aria-label="VekoTerm güncellemesi">
    <header className="dialog-header"><h2>VekoTerm güncellemesi</h2><button className="icon-button" title="Kapat" onClick={() => { if (phase === 'downloading') void api.updateCancel(); close(); }}><X size={18}/></button></header>
    <div className="dialog-body update-body">
      {error && <div className="error-message" role="alert">{error}</div>}
      {phase === 'checking' && <p className="update-status"><LoaderCircle size={16} className="spin"/>GitHub’daki son yayımlanmış sürüme bakılıyor…</p>}
      {phase !== 'checking' && info && !available && <p className="update-status ok"><CheckCircle2 size={16}/>{info.latest ? `VekoTerm güncel. Kullandığınız sürüm: ${info.current}.` : 'Henüz yayımlanmış bir sürüm bulunamadı.'}</p>}
      {phase !== 'checking' && info && available && <>
        <div className="update-head">
          <strong>VekoTerm {info.latest}</strong>
          <span>{[info.published && `${day(info.published)} tarihinde yayımlandı`, `kullandığınız sürüm ${info.current}`, info.size ? `kurulum dosyası ${megabytes(info.size)}` : ''].filter(Boolean).join(' · ')}</span>
        </div>
        {info.notes ? <Notes text={info.notes}/> : <p className="field-hint">Bu sürüm için not yazılmamış.</p>}
        {phase === 'downloading' && <div className="update-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="İndirme">
          <div><span style={{ width: `${percent}%` }}/></div><small>{progress?.total ? `${megabytes(progress.bytes)} / ${megabytes(progress.total)} · %${percent}` : progress ? megabytes(progress.bytes) : ''}</small>
        </div>}
        {phase === 'downloaded' && <p className="update-status ok"><CheckCircle2 size={16}/>Kurulum dosyası indirildi ve SHA256 özeti sürümdekiyle eşleşti.</p>}
        {phase === 'downloaded' && <p className="field-hint">Kurulumu başlatınca VekoTerm kapanır ve açık bağlantılar sonlanır. Kayıtlı bağlantılarınız ve ayarlarınız korunur; kurulum bitince VekoTerm yeniden açılır.</p>}
        {info.portable && <p className="field-hint">Taşınabilir kullanımda VekoTerm kendini kurmaz. Yeni sürümü sürüm sayfasından indirebilirsiniz.</p>}
        {!info.portable && !info.downloadable && <p className="field-hint">Bu sürümde Windows kurulum dosyası yok; sürüm sayfasına bakabilirsiniz.</p>}
      </>}
    </div>
    <footer className="dialog-footer update-footer">
      {info?.latest && <button className="button secondary" onClick={() => void api.updatePage()}><ExternalLink size={14}/>Sürüm sayfası</button>}
      <span/>
      {phase === 'downloading'
        ? <button className="button secondary" onClick={() => void api.updateCancel()}>İndirmeyi iptal et</button>
        : <button className="button secondary" onClick={close}>{available ? 'Sonra' : 'Kapat'}</button>}
      {phase === 'result' && !available && <button className="button primary" onClick={() => void check()}>Yeniden denetle</button>}
      {phase === 'result' && available && !info?.portable && info?.downloadable && <button className="button primary" onClick={() => void download()}><Download size={14}/>İndir</button>}
      {phase === 'downloaded' && <button className="button primary" disabled={installing} onClick={() => void install()}>{installing ? 'Başlatılıyor…' : 'Kurulumu başlat'}</button>}
    </footer>
  </section></div>;
}
