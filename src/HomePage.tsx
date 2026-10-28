import { SquareTerminal, SquarePlus, Import, ShieldCheck, Terminal, FolderOpen, Monitor, Radio } from 'lucide-react';
import type { Profile } from './types';

const icons = { ssh: Terminal, sftp: FolderOpen, local: Terminal, rdp: Monitor, vnc: Radio, telnet: Terminal, serial: Terminal, ftp: FolderOpen, ftps: FolderOpen };
export type RecentConnection = { id: string; at: number };
const when = (at: number) => {
  const date = new Date(at), today = new Date(), yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return `Bugün ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Dün ${time}`;
  return date.toLocaleDateString('tr-TR');
};
const address = (p: Profile) => p.type === 'local' ? 'Bu bilgisayar' : `${p.username ? p.username + '@' : ''}${p.host}${[22, 3389, 5900, 23, 21].includes(p.port) ? '' : ':' + p.port}`;

// Start tab: the three common actions and the connections used most recently.
export function HomePage({ profiles, recent, openLocal, newSession, importMoba, connect, desktop }: { profiles: Profile[]; recent: RecentConnection[]; openLocal: () => void; newSession: () => void; importMoba: () => void; connect: (p: Profile) => void; desktop: boolean }) {
  const used = recent.map(r => ({ profile: profiles.find(p => p.id === r.id), at: r.at })).filter((r): r is { profile: Profile; at: number } => !!r.profile).slice(0, 8);
  const rows = used.length ? used : profiles.slice(0, 8).map(profile => ({ profile, at: 0 }));
  return <div className="home-page">
    <div className="home-grid">
      <section className="home-start">
        <h2>Başla</h2>
        <div className="home-start-actions">
          <button className="home-action" onClick={openLocal}><SquareTerminal size={26} className="protocol-local"/><span><strong>Yerel terminal başlat</strong><small>PowerShell · Ctrl+Shift+L</small></span></button>
          <button className="home-action" onClick={newSession}><SquarePlus size={26} className="accent-icon"/><span><strong>Yeni oturum</strong><small>SSH, SFTP, RDP, VNC, Telnet, seri port · Ctrl+Shift+N</small></span></button>
          <button className="home-action" onClick={importMoba}><Import size={26} className="protocol-sftp"/><span><strong>MobaXterm'den al</strong><small>Kayıtlı oturumları klasörleriyle getir</small></span></button>
        </div>
        <div className="home-shortcuts"><span><kbd>Ctrl</kbd><kbd>K</kbd>Hızlı erişim</span><span><kbd>Ctrl</kbd><kbd>Tab</kbd>Sekme değiştir</span><span><kbd>Del</kbd>Seçili bağlantıyı sil</span></div>
      </section>
      <section className="home-recent">
        <h2>{used.length ? 'Son oturumlar' : 'Kayıtlı oturumlar'}</h2>
        {rows.length ? <div className="recent-table-wrap"><table className="recent-table"><thead><tr><th>Ad</th><th>Klasör</th><th>Adres</th><th>{used.length ? 'Son bağlantı' : 'Tür'}</th></tr></thead><tbody>
          {rows.map(({ profile, at }) => { const Icon = icons[profile.type]; return <tr key={profile.id} onDoubleClick={() => connect(profile)}>
            <td><button className="recent-name" title="Bağlan" onClick={() => connect(profile)}><Icon size={15} className={`protocol-icon protocol-${profile.type}`}/>{profile.name}</button></td>
            <td>{profile.folder}</td><td className="dim">{address(profile)}</td><td className="dim">{at ? when(at) : profile.type.toUpperCase()}</td>
          </tr>; })}
        </tbody></table></div> : <div className="home-empty"><strong>Henüz kayıtlı bağlantı yok</strong><span>Yeni oturum ekle ya da MobaXterm'deki oturumlarını tek tıkla al. Bağlantılar bu cihazda saklanır; hesap açman gerekmez.</span></div>}
      </section>
    </div>
    <div className="home-footnote"><ShieldCheck size={14}/>Açık kaynak · Bağlantı bilgilerin bu cihazda{!desktop && <strong> · Tarayıcı önizlemesi</strong>}</div>
  </div>;
}
