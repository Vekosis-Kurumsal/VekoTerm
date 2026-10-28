import { useState } from 'react';
import { Files, FolderOpen, X } from 'lucide-react';
import { api } from './api';
export function CompareDialog({ close }: { close: () => void }) {
  const [files, setFiles] = useState<Awaited<ReturnType<typeof api.compareFiles>>>(null), [folders, setFolders] = useState<Awaited<ReturnType<typeof api.compareFolders>>>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async (kind: 'files'|'folders') => { setBusy(true); setError(''); try { if (kind === 'files') { const result = await api.compareFiles(); if (result) { setFiles(result); setFolders(null); } } else { const result = await api.compareFolders(); if (result) { setFolders(result); setFiles(null); } } } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  const current = files || folders;
  return <div className="modal-backdrop"><section className="compare-dialog" role="dialog" aria-modal="true" aria-label="Karşılaştırma"><header className="dialog-header"><h2>Dosya ve klasör karşılaştırma</h2><button className="icon-button" title="Kapat" onClick={close}><X size={18}/></button></header><div className="compare-toolbar"><button className="button secondary" disabled={busy} onClick={() => run('files')}><Files size={15}/>İki dosya seç</button><button className="button secondary" disabled={busy} onClick={() => run('folders')}><FolderOpen size={15}/>İki klasör seç</button>{busy && <span>Karşılaştırılıyor…</span>}</div><p className="field-hint compare-hint">Bu bilgisayardaki dosyaları karşılaştırır. Klasörlerde bağlantılar takip edilmez; en fazla 10000 öğe ve 256 MB içerik taranır. Atlanan öğeler ayrıca gösterilir.</p>
    {current && <div className="compare-paths"><span>Sol: {current.left}</span><span>Sağ: {current.right}</span></div>}
    {files && <div className="compare-content"><p>{files.note}</p>{files.changes.map((c, i) => <pre className={`diff-${c.kind}`} key={i}>{c.value}</pre>)}</div>}
    {folders && <div className="compare-content"><table><thead><tr><th>Dosya / klasör</th><th>Sonuç</th></tr></thead><tbody>{folders.rows.map(r => <tr key={r.name} className={`comparison-${r.status}`}><td>{r.name}</td><td>{({ same: 'Aynı', left: 'Yalnız solda', right: 'Yalnız sağda', different: 'Farklı', skipped: 'İçerik karşılaştırılmadı' } as Record<string,string>)[r.status]}</td></tr>)}</tbody></table></div>}
    {error && <div className="file-error" role="alert">{error}</div>}
  </section></div>;
}
