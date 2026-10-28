import { useEffect, useRef, useState } from 'react';
// @ts-expect-error noVNC does not publish TypeScript declarations.
import RFB from '@novnc/novnc';
import type { Session } from './types';
import { api } from './api';
export function VncPane({ session }: { session: Session }) {
  const container = useRef<HTMLDivElement>(null), rfb = useRef<any>(null);
  const [status, setStatus] = useState('VNC sunucusuna bağlanılıyor…'), [credentialTypes, setCredentialTypes] = useState<string[]>([]), [credentials, setCredentials] = useState<Record<string, string>>({});
  const [viewOnly, setViewOnly] = useState(false), [scale, setScale] = useState(true), [resize, setResize] = useState(true), [quality, setQuality] = useState(6), [remoteClipboard, setRemoteClipboard] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    if (!container.current || !session.vncURL) return;
    const client = new RFB(container.current, session.vncURL); rfb.current = client; client.scaleViewport = true; client.resizeSession = true;
    client.addEventListener('connect', () => { setStatus(''); api.vncStatus(session.id, 'connected').catch(() => {}); });
    client.addEventListener('disconnect', () => { setStatus('VNC bağlantısı kapandı. Yeniden bağlanmak için oturumu açın.'); api.vncStatus(session.id, 'closed').catch(() => {}); });
    client.addEventListener('credentialsrequired', (event: any) => setCredentialTypes(event.detail.types));
    client.addEventListener('clipboard', (event: any) => setRemoteClipboard(String(event.detail.text).slice(0, 1024 * 1024)));
    client.addEventListener('securityfailure', () => { setStatus('VNC kimlik doğrulaması başarısız.'); api.vncStatus(session.id, 'error').catch(() => {}); });
    return () => { rfb.current = null; client.disconnect(); };
  }, [session.id, session.vncURL]);
  useEffect(() => { if (rfb.current) { rfb.current.viewOnly = viewOnly; rfb.current.scaleViewport = scale; rfb.current.resizeSession = resize; rfb.current.qualityLevel = quality; } }, [viewOnly, scale, resize, quality]);
  const run = async (fn: () => Promise<void>) => { try { await fn(); setNotice(''); } catch (e: any) { setNotice(e.message); } };
  return <div className="vnc-pane">
    <div className="vnc-toolbar"><button disabled={viewOnly || session.status !== 'connected'} onClick={() => rfb.current?.sendCtrlAltDel()}>Ctrl Alt Del</button><button disabled={viewOnly || session.status !== 'connected'} onClick={() => run(async () => { const text = await api.readClipboard(); if (text.length > 1024 * 1024) throw new Error('Pano içeriği çok büyük.'); rfb.current?.clipboardPasteFrom(text); })}>Panoyu gönder</button><button disabled={!remoteClipboard} onClick={() => run(() => api.writeClipboard(remoteClipboard))}>Uzak panoyu kopyala</button><label><input type="checkbox" checked={viewOnly} onChange={e => setViewOnly(e.target.checked)}/>Yalnız izle</label><label><input type="checkbox" checked={scale} onChange={e => setScale(e.target.checked)}/>Ekrana sığdır</label><label><input type="checkbox" checked={resize} onChange={e => setResize(e.target.checked)}/>Uzak çözünürlüğü uyarla</label><select aria-label="Görüntü kalitesi" value={quality} onChange={e => setQuality(Number(e.target.value))}><option value="2">Düşük bant genişliği</option><option value="6">Dengeli görüntü</option><option value="9">Yüksek kalite</option></select></div>
    <div className="vnc-surface" ref={container}/>{notice && <div className="file-error" role="alert">{notice}</div>}{status && <div className="vnc-status">{status}</div>}
    {!!credentialTypes.length && <form className="vnc-password" onSubmit={e => { e.preventDefault(); rfb.current?.sendCredentials(credentials); setCredentials({}); setCredentialTypes([]); }}>{credentialTypes.map(type => <label key={type}>{({ password: 'VNC parolası', username: 'Kullanıcı adı', target: 'Hedef' } as Record<string, string>)[type] || type}<input autoFocus={type === credentialTypes[0]} type={type === 'password' ? 'password' : 'text'} autoComplete="off" value={credentials[type] || ''} onChange={e => setCredentials({ ...credentials, [type]: e.target.value })}/></label>)}<button className="button primary">Bağlan</button></form>}
  </div>;
}
