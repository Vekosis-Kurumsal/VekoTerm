import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal, Plus, Search, FolderOpen, Monitor, Radio, Settings, Network, Play, X, Minus, Maximize2, RefreshCw, Upload, Download, FileText, House, Star, MoreHorizontal, Sun, Moon, Check, CircleHelp, Command, ArrowRight, PanelLeftClose, PanelLeftOpen, Copy, SlidersHorizontal, FolderPlus, ExternalLink, Keyboard, ShieldCheck, CheckCircle2, AlertCircle, LoaderCircle, Trash2, SquarePlus, SquareTerminal, Columns2, Wrench, Import, SunMoon, Power, Zap, Lock, Eraser, FileDown, Type, GitCompare, LayoutGrid, Activity, Info, KeyRound } from 'lucide-react';
import { api } from './api';
import { TerminalPane } from './TerminalPane';
import { SessionDialog, blankProfile } from './SessionDialog';
import { ConnectionTree, type ConnectionTreeState } from './ConnectionTree';
import { MoveConnectionDialog } from './MoveConnectionDialog';
import { VncPane } from './VncPane';
import { FileBrowser } from './FileBrowser';
import { RemoteMonitor } from './RemoteMonitor';
import { AuthDialog } from './AuthDialog';
import { TunnelDialog } from './TunnelDialog';
import { CompareDialog } from './CompareDialog';
import { VaultDialog } from './VaultDialog';
import { ImportExportDialog } from './ImportExportDialog';
import { XServerDialog } from './XServerDialog';
import { CodeEditor } from './CodeEditor';
import { UtilitiesDialog } from './UtilitiesDialog';
import { WorkspacesDialog } from './WorkspacesDialog';
import { MacrosDialog } from './MacrosDialog';
import { TerminalTools } from './TerminalTools';
import { TerminalLayoutDialog, type TerminalLayout } from './TerminalLayoutDialog';
import { MenuBar, type Menu } from './MenuBar';
import { HomePage, type RecentConnection } from './HomePage';
import type { AuthChallenge, MacroRun, Profile, Session, FileEntry, Preferences, Transfer } from './types';
import './style.css';
import './layout.css';

const icons = { ssh: Terminal, sftp: FolderOpen, local: Terminal, rdp: Monitor, vnc: Radio, telnet: Terminal, serial: Terminal, ftp: FolderOpen, ftps: FolderOpen };
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const statusText: Record<string, string> = { connecting: 'Bağlanıyor', connected: 'Bağlı', error: 'Bağlantı hatası', closed: 'Bağlantı kapandı', external: 'Windows penceresinde' };
type Editor = { sessionId: string; path: string; text: string; original: string; hash: string };
type Prompt = { title: string; label: string; value: string; action: (value: string) => Promise<void>; danger?: boolean; confirmLabel?: string };
// Recently opened saved connections for the start tab; kept per device, IDs only.
const recentKey = 'vekoterm.recent';
const readRecent = (): RecentConnection[] => { try { const value = JSON.parse(localStorage.getItem(recentKey) || '[]'); return Array.isArray(value) ? value.filter(r => typeof r?.id === 'string' && typeof r?.at === 'number').slice(0, 20) : []; } catch { return []; } };
// Quick connect accepts user@host[:port]; IPv6 needs brackets: user@[::1]:22.
const parseQuick = (text: string) => { const match = text.trim().match(/^(?:([^@\s]+)@)?(\[[0-9a-f:.]+\]|[^\s:@/\\[\]]+)(?::(\d{1,5}))?$/i); if (!match) return null; const port = Number(match[3] || 22); return port >= 1 && port <= 65535 ? { username: match[1] || '', host: match[2].replace(/^\[|\]$/g, ''), port } : null; };

function App() {
  const [profiles, setProfiles] = useState<Profile[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const sessionList = useRef<Session[]>([]);
  const [locked, setLocked] = useState(false), [vaultDialog, setVaultDialog] = useState(false);
  const [importExport, setImportExport] = useState<'import'|'export'|null>(null);
  const [active, setActive] = useState('home'), [preferences, setPreferences] = useState<Preferences>({ theme: 'dark', fontSize: 14, copyOnSelect: true });
  const [newSession, setNewSession] = useState<Profile|null>(null), [sidebar, setSidebar] = useState('sessions'), [sidebarVisible, setSidebarVisible] = useState(true), [sidebarWidth, setSidebarWidth] = useState(270);
  const [folders, setFolders] = useState<string[]>(['Bağlantılar']), [selectedFolder, setSelectedFolder] = useState(''), [selectedProfile, setSelectedProfile] = useState('');
  const [recent, setRecent] = useState<RecentConnection[]>(readRecent), [quickConnect, setQuickConnect] = useState(''), [version, setVersion] = useState('');
  const [movingProfile, setMovingProfile] = useState<Profile|null>(null);
  const [authChallenges, setAuthChallenges] = useState<AuthChallenge[]>([]);
  const [treeState, setTreeState] = useState<ConnectionTreeState>({ query: '', favorites: false, collapsed: [] });
  const [toast, setToast] = useState<{ text: string; error: boolean }|null>(null), [settings, setSettings] = useState(false), [help, setHelp] = useState(false);
  const [monitor, setMonitor] = useState(true);
  const [layout, setLayout] = useState<TerminalLayout>('single'), [layoutTargets, setLayoutTargets] = useState<string[]>([]), [layoutDialog, setLayoutDialog] = useState<'layout'|'broadcast'|null>(null);
  const [broadcastTargets, setBroadcastTargets] = useState<string[]>([]);
  const [macros, setMacros] = useState<{ draft?: string }|null>(null), [macroJobs, setMacroJobs] = useState<MacroRun[]>([]), [toolsSession, setToolsSession] = useState<string|null>(null);
  const draggedTab = useRef('');
  const [broadcast, setBroadcast] = useState(false), [transfers, setTransfers] = useState<Transfer[]>([]), [showTransfers, setShowTransfers] = useState(false);
  const [editor, setEditor] = useState<Editor|null>(null), [editorBusy, setEditorBusy] = useState(false), [prompt, setPrompt] = useState<Prompt|null>(null), [promptError, setPromptError] = useState('');
  const [tunnels, setTunnels] = useState(false), [workspaces, setWorkspaces] = useState(false), [utilities, setUtilities] = useState(false), [xDialog, setXDialog] = useState(false), [compare, setCompare] = useState(false);
  const [xstatus, setXstatus] = useState<number|null>(null), [quick, setQuick] = useState(false), [quickSearch, setQuickSearch] = useState(''), [desktop, setDesktop] = useState(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const current = sessions.find(s => s.id === active), connected = sessions.filter(s => s.status === 'connected');
  const terminalSessions = sessions.filter(s => ['ssh','local','sftp','telnet','serial','ftp','ftps'].includes(s.type));
  const notify = useCallback((text: string, error = false) => { setToast({ text, error }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 6500); }, []);
  const run = async (fn: () => Promise<any>, success?: string) => { try { const result = await fn(); if (success && result !== false) notify(success); return result; } catch (e: any) { notify(e.message, true); } };
  const refreshProfiles = () => api.bootstrap().then(data => { setProfiles(data.profiles); setFolders(data.folders); });
  const revealFolder = (folder: string) => setTreeState(previous => ({ query: '', favorites: false, collapsed: previous.collapsed.filter(f => f !== folder) }));
  // New sessions go to the folder selected in the tree, else the selected connection's folder.
  const targetFolder = () => (folders.includes(selectedFolder) && selectedFolder) || profiles.find(p => p.id === selectedProfile)?.folder || folders[0] || 'Bağlantılar';
  const addSession = (type: Profile['type'] = 'ssh', folder = targetFolder()) => setNewSession({ ...blankProfile(type), folder });
  const createFolder = async (value: string) => { const name = await api.createFolder(value); await refreshProfiles(); revealFolder(name); return name; };
  const askFolder = () => { setPromptError(''); setPrompt({ title: 'Yeni bağlantı klasörü', label: 'Klasör adı', value: '', action: async value => { const name = await createFolder(value); setSelectedFolder(name); notify('Bağlantı klasörü oluşturuldu.'); } }); };
  const renameFolder = (folder: string) => { setPromptError(''); setPrompt({ title: 'Bağlantı klasörünü yeniden adlandır', label: 'Klasör adı', value: folder, action: async value => { const name = await api.renameFolder(folder, value); await refreshProfiles(); revealFolder(name); setSelectedFolder(previous => previous === folder ? name : previous); notify('Bağlantı klasörü yeniden adlandırıldı.'); } }); };
  const removeFolder = (folder: string) => run(async () => { await api.removeFolder(folder); await refreshProfiles(); setSelectedFolder(previous => previous === folder ? '' : previous); }, 'Boş bağlantı klasörü silindi.');
  const remember = (id: string) => setRecent(previous => { const next = [{ id, at: Date.now() }, ...previous.filter(r => r.id !== id)].slice(0, 20); try { localStorage.setItem(recentKey, JSON.stringify(next)); } catch {} return next; });
  const toggleFavorite = (profile: Profile) => run(async () => { await api.saveProfile({ ...profile, favorite: !profile.favorite }); await refreshProfiles(); }, profile.favorite ? 'Favorilerden çıkarıldı.' : 'Favorilere eklendi.');
  const showPanel = (panel: 'sessions'|'files') => { setSidebar(panel); setSidebarVisible(true); };
  const askRemoveProfile = (profile: Profile) => { setPromptError(''); setPrompt({ title: 'Bağlantıyı sil', label: `“${profile.name}” (${profile.folder}) bağlantısı ve kayıtlı parolası silinecek. Açık sekmesi varsa kapanmaz. Bu işlem geri alınamaz.`, value: '', danger: true, confirmLabel: 'Sil', action: async () => { await api.removeProfile(profile.id); await refreshProfiles(); setSelectedProfile(previous => previous === profile.id ? '' : previous); setNewSession(previous => previous?.id === profile.id ? null : previous); notify(`“${profile.name}” silindi.`); } }); };
  const moveProfile = async (profile: Profile, folder: string) => { await api.moveProfile(profile.id, folder); await refreshProfiles(); revealFolder(folder); setSelectedProfile(profile.id); notify(`Bağlantı “${folder}” klasörüne taşındı.`); };
  useEffect(() => {
    api.bootstrap().then(data => { setProfiles(data.profiles); setFolders(data.folders); setPreferences(data.preferences); sessionList.current = data.sessions; setSessions(data.sessions); setDesktop(data.desktop); setVersion(data.version); setLocked(!!data.locked); }).catch(e => notify(e.message, true));
    const unsub = api.onEvent(e => {
      if (e.type === 'locked') { setLocked(true); setImportExport(null); setProfiles([]); setFolders([]); setEditor(null); setMacros(null); setAuthChallenges([]); setNewSession(null); setTransfers([]); setToast(null); setWorkspaces(false); setUtilities(false); }
      if (e.type === 'state' && e.session) {
        const session = e.session, exists = sessionList.current.some(s => s.id === session.id);
        sessionList.current = exists ? sessionList.current.map(s => s.id === session.id ? session : s) : [...sessionList.current, session];
        setSessions(sessionList.current); if (!exists) setActive(session.id);
      }
      if (e.type === 'removed') {
        const index = sessionList.current.findIndex(s => s.id === e.id), remaining = sessionList.current.filter(s => s.id !== e.id);
        sessionList.current = remaining; setSessions(remaining);
        const next = remaining[Math.max(0, Math.min(index, remaining.length - 1))]?.id || 'home';
        setActive(previous => previous === e.id ? next : previous);
        if (!remaining.length) setSidebar('sessions');
      }
      if (e.type === 'auth' && e.challenge) setAuthChallenges(previous => [...previous, e.challenge!]);
      if (e.type === 'notice' && e.message) notify(e.message, true);
      if (e.type === 'macroState' && e.macro) { const job = e.macro; setMacroJobs(previous => [job, ...previous.filter(j => j.id !== job.id)].slice(0, 30)); if (job.status !== 'running') notify(job.message || `${job.name}: ${job.status === 'done' ? 'tamamlandı' : 'durduruldu'}`, job.status === 'error'); }
      if (e.type === 'authDone') setAuthChallenges(previous => previous.filter(q => q.id !== e.id));
      if (e.type === 'transfer' && e.transfer) { const item = e.transfer; setTransfers(previous => [item, ...previous.filter(t => t.id !== item.id)].slice(0, 100)); setShowTransfers(true); }
    }); return () => { unsub(); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [notify]);
  useEffect(() => { document.documentElement.dataset.theme = preferences.theme; document.documentElement.dataset.compact = String(!!preferences.compact); }, [preferences.theme, preferences.compact]);
  useEffect(() => {
    if (current?.status === 'connected' && ['ssh','sftp','ftp','ftps'].includes(current.type)) setSidebar('files');
  }, [active, current?.status]);
  useEffect(() => { if (broadcast && connected.filter(s => broadcastTargets.includes(s.id) && ['ssh','local','telnet','serial'].includes(s.type)).length < 2) setBroadcast(false); }, [connected, broadcast, broadcastTargets]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (locked) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setQuick(true); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); addSession(); }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); openLocal(); }
      if (e.key === 'Escape') { setQuick(false); setNewSession(null); setMovingProfile(null); setSettings(false); setHelp(false); setTunnels(false); setBroadcast(false); setLayoutDialog(null); setToolsSession(null); }
    }; document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  });
  useEffect(() => {
    // Ctrl+Tab / Ctrl+Shift+Tab cycle through tabs, including Başlangıç; captured before the terminal sees it.
    const cycle = (e: KeyboardEvent) => {
      if (locked || !e.ctrlKey || e.altKey || e.key !== 'Tab') return;
      e.preventDefault(); e.stopPropagation();
      const order = ['home', ...sessionList.current.map(s => s.id)];
      setActive(previous => order[(order.indexOf(previous) + (e.shiftKey ? -1 : 1) + order.length) % order.length]);
    };
    document.addEventListener('keydown', cycle, true); return () => document.removeEventListener('keydown', cycle, true);
  }, [locked]);
  const openLocal = () => run(() => api.open({ ...blankProfile('local'), name: 'PowerShell' }));
  const connect = async (p: Profile) => { if (['ssh','sftp','ftp','ftps'].includes(p.type) && !['agent', 'interactive'].includes(p.auth) && !p.hasSecret && !p.password && p.auth !== 'key') { setNewSession(p); return; } const session = await run(() => api.open(p)); if (session && profiles.some(saved => saved.id === p.id)) remember(p.id); };
  const saveSession = async (p: Profile, connectNow: boolean) => { const saved = await api.saveProfile(p); await refreshProfiles(); revealFolder(saved.folder); if (connectNow) { setNewSession(null); await api.open({ ...saved, password: p.password }); remember(saved.id); } else notify('Oturum kaydedildi.'); };
  // Quick connect: a saved connection's name opens it; otherwise user@host[:port] opens SSH and the password is asked by the connection.
  const runQuickConnect = () => {
    const text = quickConnect.trim(); if (!text) return;
    const saved = profiles.find(p => p.name.toLocaleLowerCase('tr') === text.toLocaleLowerCase('tr'));
    if (saved) { setQuickConnect(''); void connect(saved); return; }
    const target = parseQuick(text);
    if (!target) { notify('Hızlı bağlantı için kullanıcı@sunucu:port yazın veya kayıtlı bir bağlantının adını seçin.', true); return; }
    setQuickConnect('');
    if (!target.username) { setNewSession({ ...blankProfile('ssh'), folder: targetFolder(), name: target.host, host: target.host, port: target.port }); return; }
    void run(() => api.open({ ...blankProfile('ssh'), name: `${target.username}@${target.host}`, host: target.host, port: target.port, username: target.username }));
  };
  const updatePreferences = (p: Partial<Preferences>) => run(async () => { const next = await api.preferences(p); setPreferences(next); });
  const openFile = (file: FileEntry) => { if (!current) return; if (!file.directory) run(async () => { const doc = await api.read(current.id, file.path); setEditor({ sessionId: current.id, ...doc, original: doc.text }); }); };
  const saveFile = async () => { if (!editor) return; setEditorBusy(true); try { const result = await api.write(editor.sessionId, editor.path, editor.text, editor.hash); setEditor({ ...editor, hash: result.hash, original: editor.text }); notify('Dosya kaydedildi.'); } catch (e: any) { notify(e.message, true); } finally { setEditorBusy(false); } };
  const closeEditor = () => { if (!editor || editor.text === editor.original) setEditor(null); else setPrompt({ title: 'Kaydedilmemiş değişiklikler', label: 'Kaydetmeden kapatırsanız bu düzenlemeler kaybolur.', value: '', danger: true, action: async () => setEditor(null) }); };
  const Tool = ({ icon: Icon, label, click, color, selected, disabled, name, hint }: { icon: any; label: string; click: () => void; color?: string; selected?: boolean; disabled?: boolean; name?: string; hint?: string }) => <button className={`tool-button ${selected ? 'selected' : ''}`} onClick={click} disabled={disabled} aria-label={name} title={hint || name || label}><span className="tool-icon" style={{ color }}><Icon size={22} strokeWidth={1.7}/></span><span className="tool-label">{label}</span></button>;
  const terminalCurrent = current && ['ssh','sftp','local','telnet','serial','ftp','ftps'].includes(current.type) ? current : undefined;
  const selectedConnection = profiles.find(p => p.id === selectedProfile);
  const openSplit = () => { if (!layoutTargets.length) setLayoutTargets(terminalSessions.slice(0, 2).map(s => s.id)); setLayoutDialog('layout'); };
  const toggleBroadcast = () => { if (broadcast) setBroadcast(false); else { setBroadcastTargets(connected.filter(s => ['ssh','local','telnet','serial'].includes(s.type)).map(s => s.id)); setLayoutDialog('broadcast'); } };
  const toggleTheme = () => updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' });
  const menus: Menu[] = [
    { id: 'terminal', label: 'Terminal', items: [
      { label: 'Yeni yerel terminal', icon: SquareTerminal, shortcut: 'Ctrl+Shift+L', action: openLocal },
      { label: 'Terminal işlemleri…', icon: MoreHorizontal, disabled: !terminalCurrent, action: () => { if (terminalCurrent) setToolsSession(terminalCurrent.id); } },
      { label: 'Kayıtlı parolayı yapıştır', icon: KeyRound, shortcut: 'Ctrl+Shift+P', disabled: !terminalCurrent || !['ssh', 'local'].includes(terminalCurrent.type) || terminalCurrent.status !== 'connected', action: () => { if (terminalCurrent) void run(() => api.sendSavedPassword(terminalCurrent.id), 'Parola gönderildi.'); } },
      { label: 'Çıktıyı dosyaya kaydet…', icon: FileDown, disabled: !terminalCurrent, action: () => { if (terminalCurrent) void run(() => api.exportTerminal(terminalCurrent.id), 'Terminal çıktısı kaydedildi.'); } },
      { label: 'Ekranı temizle', icon: Eraser, disabled: !terminalCurrent, action: () => { if (terminalCurrent) void run(() => api.clearTerminal(terminalCurrent.id)); } },
      'separator',
      { label: 'Yazıyı büyüt', icon: Type, action: () => updatePreferences({ fontSize: preferences.fontSize + 1 }) },
      { label: 'Yazıyı küçült', icon: Type, action: () => updatePreferences({ fontSize: preferences.fontSize - 1 }) },
      'separator',
      { label: 'Sekmeyi kapat', icon: X, disabled: !current, action: () => { if (current) void run(() => api.close(current.id)); } }
    ] },
    { id: 'sessions', label: 'Oturumlar', items: [
      { label: 'Yeni oturum…', icon: SquarePlus, shortcut: 'Ctrl+Shift+N', action: () => addSession() },
      { label: 'Yeni bağlantı klasörü…', icon: FolderPlus, action: askFolder },
      { label: 'Hızlı erişim…', icon: Search, shortcut: 'Ctrl+K', action: () => setQuick(true) },
      'separator',
      { label: "MobaXterm'den al…", icon: Import, action: () => setImportExport('import') },
      { label: 'Dosyadan içe aktar…', icon: Download, action: () => setImportExport('import') },
      { label: 'Dışa aktar…', icon: Upload, action: () => setImportExport('export') },
      { label: 'Çalışma alanları…', icon: LayoutGrid, action: () => setWorkspaces(true) },
      'separator',
      { label: 'Seçili bağlantıyı düzenle', icon: SlidersHorizontal, shortcut: 'F2', disabled: !selectedConnection, action: () => { if (selectedConnection) setNewSession(selectedConnection); } },
      { label: 'Seçili bağlantıyı sil', icon: Trash2, shortcut: 'Del', danger: true, disabled: !selectedConnection, action: () => { if (selectedConnection) askRemoveProfile(selectedConnection); } }
    ] },
    { id: 'view', label: 'Görünüm', items: [
      { label: sidebarVisible ? 'Yan paneli gizle' : 'Yan paneli göster', icon: sidebarVisible ? PanelLeftClose : PanelLeftOpen, action: () => setSidebarVisible(!sidebarVisible) },
      { label: 'Bağlantılar paneli', icon: Star, action: () => showPanel('sessions') },
      { label: 'SFTP dosya paneli', icon: FolderOpen, action: () => showPanel('files') },
      { label: monitor ? 'Uzak izleme çubuğunu gizle' : 'Uzak izleme çubuğunu göster', icon: Activity, action: () => setMonitor(!monitor) },
      { label: showTransfers ? 'Aktarımları gizle' : 'Aktarımları göster', icon: Download, action: () => setShowTransfers(!showTransfers) },
      'separator',
      { label: 'Bölünmüş ekran…', icon: Columns2, action: openSplit },
      { label: preferences.theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç', icon: SunMoon, action: toggleTheme },
      { label: preferences.compact ? 'Yazılı araç çubuğu' : 'Kompakt araç çubuğu', icon: Minus, action: () => updatePreferences({ compact: !preferences.compact }) },
      { label: 'Pencereyi büyüt / eski boyut', icon: Maximize2, action: () => { void api.window('maximize'); } }
    ] },
    { id: 'x11', label: 'X sunucusu', items: [
      { label: xstatus !== null ? `X sunucusu :${xstatus} çalışıyor…` : 'X sunucusu…', icon: Monitor, action: () => setXDialog(true) }
    ] },
    { id: 'tools', label: 'Araçlar', items: [
      { label: 'Tüneller…', icon: Network, action: () => setTunnels(true) },
      { label: broadcast ? 'Çoklu komutu durdur' : 'Çoklu komut…', icon: Copy, action: toggleBroadcast },
      { label: 'Ağ araçları ve SSH anahtarları…', icon: Wrench, action: () => setUtilities(true) },
      { label: 'Dosya / klasör karşılaştır…', icon: GitCompare, action: () => setCompare(true) }
    ] },
    { id: 'settings', label: 'Ayarlar', items: [
      { label: 'Çalışma alanı ayarları…', icon: SlidersHorizontal, action: () => setSettings(true) },
      { label: 'Uygulama kilidi…', icon: Lock, action: () => setVaultDialog(true) }
    ] },
    { id: 'macros', label: 'Makrolar', items: [
      { label: 'Makroları yönet…', icon: Command, action: () => setMacros({}) },
      { label: 'Makro kaydını başlat', icon: Play, disabled: !terminalCurrent || !!terminalCurrent.recording, action: () => { if (terminalCurrent) void run(() => api.startRecording(terminalCurrent.id), 'Makro kaydı başladı. Bitirmek için terminalin üstündeki düğmeyi kullanın.'); } }
    ] },
    { id: 'help', label: 'Yardım', items: [
      { label: 'Klavye kısayolları ve VekoTerm hakkında', icon: Info, action: () => setHelp(true) }
    ] }
  ];
  const maxPanes = layout === 'grid' ? 4 : layout === 'single' ? 1 : 2;
  const chosenPanes = layoutTargets.filter(id => terminalSessions.some(s => s.id === id)).slice(0, maxPanes);
  const visiblePanes = current && terminalSessions.some(s => s.id === active) ? maxPanes === 1 ? [active] : chosenPanes.includes(active) ? chosenPanes : [active, ...chosenPanes].slice(0, maxPanes) : [];
  const reorderTab = (target: string) => { const source = draggedTab.current; draggedTab.current = ''; if (!source || source === target) return; const next = [...sessionList.current], from = next.findIndex(s => s.id === source); if (from < 0) return; const [item] = next.splice(from, 1), to = next.findIndex(s => s.id === target); if (to < 0) return; next.splice(to, 0, item); sessionList.current = next; setSessions(next); };

  if (locked) return <VaultDialog locked close={() => {}} unlocked={() => { void api.bootstrap().then(data => { setProfiles(data.profiles); setFolders(data.folders); setPreferences(data.preferences); sessionList.current = data.sessions; setSessions(data.sessions); setActive('home'); setLocked(false); }).catch(e => notify(e.message, true)); }}/>
  const railWidth = 38, problem = !!current && ['error', 'closed'].includes(current.status);
  return <div className="app-shell">
    <header className="titlebar"><div className="brand"><span className="brand-mark"><Terminal size={15}/></span><strong>Veko<span>Term</span></strong></div><div className="title-context">{current ? `${sessions.indexOf(current) + 1}. ${current.name}` : 'Başlangıç'}</div><div className="window-controls"><button aria-label="Simge durumuna küçült" onClick={() => api.window('minimize')}><Minus size={15}/></button><button aria-label="Büyüt" onClick={() => api.window('maximize')}><Maximize2 size={13}/></button><button aria-label="Uygulamayı kapat" onClick={() => api.window('close')}><X size={17}/></button></div></header>
    <MenuBar menus={menus} note={<><span className={`dot ${xstatus === null ? 'muted' : ''}`}/>{xstatus === null ? 'X11 kapalı' : `X11 :${xstatus} hazır`}</>}/>
    <nav className="toolbar" aria-label="Araç çubuğu">
      <Tool icon={SquarePlus} label="Oturum" hint="Yeni oturum (Ctrl+Shift+N)" click={() => addSession()} color="var(--accent)"/>
      <Tool icon={SquareTerminal} label="Yerel terminal" hint="Yeni yerel terminal (Ctrl+Shift+L)" click={openLocal} color="var(--icon-local)"/>
      <Tool icon={Star} label="Oturumlar" hint="Bağlantılar paneli" click={() => showPanel('sessions')} selected={sidebarVisible && sidebar === 'sessions'} color="var(--icon-star)"/>
      <div className="tool-divider"/>
      <Tool icon={FolderOpen} label="SFTP" hint="SFTP dosya paneli" click={() => showPanel('files')} selected={sidebarVisible && sidebar === 'files'} color="var(--icon-folder)"/>
      <Tool icon={Columns2} label="Böl" hint="Bölünmüş ekran" click={openSplit} selected={layout !== 'single'}/>
      <Tool icon={Copy} label="Çoklu komut" hint="Aynı komutu birden çok terminale gönder" click={toggleBroadcast} selected={broadcast}/>
      <Tool icon={Network} label="Tüneller" click={() => setTunnels(true)} color="var(--icon-violet)"/>
      <Tool icon={Command} label="Makrolar" click={() => setMacros({})} selected={!!macros}/>
      <Tool icon={Wrench} label="Araçlar" hint="Ağ araçları ve SSH anahtarları" click={() => setUtilities(true)} color="var(--icon-violet)"/>
      <div className="tool-divider"/>
      <Tool icon={Import} label="MobaXterm'den al" hint="MobaXterm oturumlarını içe aktar" click={() => setImportExport('import')} color="var(--accent)"/>
      <Tool icon={SlidersHorizontal} label="Ayarlar" hint="Çalışma alanı ayarları" click={() => setSettings(true)}/>
      <Tool icon={CircleHelp} label="Yardım" click={() => setHelp(true)} color="var(--icon-blue)"/>
      <div className="toolbar-spacer"/>
      <Tool icon={Monitor} label="X sunucusu" click={() => setXDialog(true)} selected={xstatus !== null} color="var(--icon-green)"/>
      <Tool icon={preferences.theme === 'dark' ? Sun : Moon} label="Tema" name={preferences.theme === 'dark' ? 'Açık temaya geç' : 'Koyu temaya geç'} click={toggleTheme}/>
      <Tool icon={Power} label="Çıkış" hint="VekoTerm'i kapat" click={() => { void api.window('close'); }} color="var(--icon-red)"/>
    </nav>
    <div className="quick-row">
      <form className="quick-connect" style={{ width: railWidth + (sidebarVisible ? sidebarWidth + 1 : 0) }} onSubmit={e => { e.preventDefault(); runQuickConnect(); }}>
        <Zap size={14}/><input aria-label="Hızlı bağlan" list="quick-connect-profiles" placeholder="Hızlı bağlan… kullanıcı@sunucu:22" value={quickConnect} onChange={e => setQuickConnect(e.target.value)}/>
        <datalist id="quick-connect-profiles">{profiles.map(p => <option key={p.id} value={p.name}>{p.type === 'local' ? 'Bu bilgisayar' : `${p.folder} · ${p.host}`}</option>)}</datalist>
      </form>
      <div className="tabbar">
        <button className={`tab home-tab ${active === 'home' ? 'active' : ''}`} aria-label="Başlangıç" title="Başlangıç" onClick={() => setActive('home')}><House size={15}/></button>
        {sessions.map((s, index) => { const Icon = icons[s.type]; return <div className={`tab ${active === s.id ? 'active' : ''}`} key={s.id} draggable onDragStart={() => { draggedTab.current = s.id; }} onDragEnd={() => { draggedTab.current = ''; }} onDragOver={e => { if (draggedTab.current) e.preventDefault(); }} onDrop={e => { e.preventDefault(); reorderTab(s.id); }} onContextMenu={e => { e.preventDefault(); setToolsSession(s.id); }} onAuxClick={e => { if (e.button === 1) void run(() => api.close(s.id)); }} style={{ '--tab-color': s.color } as React.CSSProperties}>
          <button className="tab-label" title={s.type === 'local' ? s.name : `${s.username ? s.username + '@' : ''}${s.host} · ${statusText[s.status] || s.status}`} onClick={() => setActive(s.id)}>{s.status === 'connecting' ? <LoaderCircle size={14} className="spin"/> : <Icon size={14} className={`protocol-icon protocol-${s.type}`}/>}<span className="tab-number">{index + 1}.</span><span className="tab-name">{s.name}</span><span className={`connection-dot ${s.status}`}/></button>
          <button className="tab-close" aria-label={`${s.name} oturumunu kapat`} title="Kapat (orta tık)" onClick={() => run(() => api.close(s.id))}><X size={12}/></button>
        </div>; })}
        <button className="new-tab" title="Yeni yerel terminal" aria-label="Yeni yerel terminal" onClick={openLocal}><Plus size={16}/></button>
      </div>
    </div>
    <div className="workspace">
      <nav className="sidebar-tabs side-rail" aria-label="Yan panel">
        <button className={sidebarVisible && sidebar === 'sessions' ? 'selected' : ''} aria-label="Bağlantılar" title={`Bağlantılar (${profiles.length})`} onClick={() => showPanel('sessions')}><Star size={18}/></button>
        <button className={sidebarVisible && sidebar === 'files' ? 'selected' : ''} aria-label="Dosyalar" title="SFTP dosyaları" onClick={() => showPanel('files')}><FolderOpen size={18}/></button>
        <button aria-label="Ağ araçları" title="Ağ araçları ve SSH anahtarları" onClick={() => setUtilities(true)}><Wrench size={17}/></button>
        <button aria-label="Makro listesi" title="Makrolar" onClick={() => setMacros({})}><Command size={17}/></button>
        <span className="rail-spacer"/>
        <button aria-label={sidebarVisible ? 'Yan paneli gizle' : 'Yan paneli göster'} title={sidebarVisible ? 'Yan paneli gizle' : 'Yan paneli göster'} onClick={() => setSidebarVisible(!sidebarVisible)}>{sidebarVisible ? <PanelLeftClose size={17}/> : <PanelLeftOpen size={17}/>}</button>
      </nav>
      {sidebarVisible && <><aside className="sidebar" style={{ width: sidebarWidth }}>
        {sidebar === 'sessions' ? <><ConnectionTree state={treeState} updateState={setTreeState} profiles={profiles} folders={folders} selectedFolder={selectedFolder} selectFolder={folder => { setSelectedFolder(folder); if (folder) setSelectedProfile(''); }} selected={selectedProfile} select={id => { setSelectedProfile(id); setSelectedFolder(''); }} connect={p => { void connect(p); }} edit={setNewSession} add={folder => addSession('ssh', folder)} move={setMovingProfile} moveTo={(profile, folder) => { void run(() => moveProfile(profile, folder)); }} remove={askRemoveProfile} toggleFavorite={p => { void toggleFavorite(p); }} createFolder={askFolder} renameFolder={renameFolder} removeFolder={removeFolder} importMoba={() => setImportExport('import')}/>
        <div className="sidebar-footer"><button onClick={() => setImportExport('import')}><Download size={14}/>İçe aktar</button><button onClick={() => setImportExport('export')}><Upload size={14}/>Dışa aktar</button></div></> : <>
          <FileBrowser key={current?.id || "none"} session={current} edit={openFile} notify={notify}/>
        </>}
      </aside><div className="sidebar-resizer" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setSidebarWidth(Math.max(225, Math.min(460, e.clientX - railWidth))); }}/></>}
      <main className="main-workspace">
        {broadcast && <div className="broadcast-bar"><Copy size={15}/><strong>Çoklu komut açık</strong><span>Girdiler {connected.filter(s => broadcastTargets.includes(s.id)).length} terminale gönderiliyor.</span><button onClick={() => setBroadcast(false)}>Durdur · Esc</button></div>}
        {macroJobs.filter(j => j.status === 'running').map(j => <div className="broadcast-bar" key={j.id}><Command size={14}/><strong>{j.name}</strong><span>Makro çalışıyor</span><button onClick={() => run(() => api.stopMacro(j.id))}>Durdur</button></div>)}
        {current && (problem || current.logging || current.recording) && <div className={`session-notice ${problem ? 'problem' : ''}`}>
          {problem && <><AlertCircle size={14}/><span className="connection-status">{statusText[current.status]}</span><span className="notice-target">{current.type === 'local' ? 'Bu bilgisayar' : `${current.username ? current.username + '@' : ''}${current.host}`}</span><button className="text-accent" onClick={() => { void run(() => api.duplicateSession(current.id)); }}><RefreshCw size={13}/>Yeniden bağlan</button></>}
          {current.logging && <span className="recording-badge">Dosyaya kayıt</span>}
          {current.recording && <button className="recording-badge" onClick={() => run(async () => { const result = await api.stopRecording(current.id); setMacros({ draft: result.commands }); if (result.skipped) notify(`${result.skipped} düzenlenmiş satır kayda alınmadı.`); })}>● Makro kaydı · Bitir</button>}
        </div>}
        <div className="main-content">
          {active === 'home' && <HomePage profiles={profiles} recent={recent} openLocal={openLocal} newSession={() => addSession()} importMoba={() => setImportExport('import')} connect={p => { void connect(p); }} desktop={desktop}/>}
          <div className={`terminals layout-${layout}`} style={{ display: current && ['ssh','sftp','local','telnet','serial','ftp','ftps'].includes(current.type) ? 'grid' : 'none' }}>{terminalSessions.map(s => <TerminalPane key={s.id} session={s} visible={visiblePanes.includes(s.id)} order={visiblePanes.indexOf(s.id)} showLabel={layout !== 'single'} isActive={s.id === active} activate={() => setActive(s.id)} fontSize={preferences.fontSize} fontFamily={preferences.fontFamily} highlight={preferences.terminalHighlights !== false} copyOnSelect={preferences.copyOnSelect} broadcast={broadcast && broadcastTargets.includes(s.id)} peers={connected.filter(s => broadcastTargets.includes(s.id) && ['ssh','local','telnet','serial'].includes(s.type)).map(s => s.id)}/>)}</div>
          {sessions.filter(s => s.type === 'vnc').map(s => <div className="vnc-wrapper" key={s.id} style={{ display: s.id === active ? 'flex' : 'none' }}><VncPane session={s}/></div>)}
          {current?.type === 'rdp' && <div className="external-session"><Monitor size={46}/><h2>Windows Uzak Masaüstü açıldı</h2><p>{current.host}:{profiles.find(p => p.id === current.profileId)?.port || 3389}</p>{current.rdpDisplay && <div className="rdp-display-chips" aria-label="Ekran ayarı"><span>{{ fullscreen: 'Tam ekran', window: 'Büyük pencere', custom: 'Özel boyut', multimon: 'Tüm monitörler' }[current.rdpDisplay.mode] || current.rdpDisplay.mode}</span>{current.rdpDisplay.mode !== 'multimon' && <span>{current.rdpDisplay.width} × {current.rdpDisplay.height}</span>}<span>Uzak ölçek %{current.rdpDisplay.scale}</span><span>{current.rdpDisplay.resize === 'smart' ? 'Görüntü pencereye sığdırılır' : 'Pencereyle yeniden boyutlanır'}</span></div>}<span>RDP ayrı bir Windows penceresinde çalışır.<br/>Tam ekran / pencere geçişi: Ctrl + Alt + Break.<br/>Ekran ayarı değişiklikleri yeniden bağlandığınızda uygulanır.</span><button className="button secondary" onClick={() => { const p = profiles.find(p => p.id === current.profileId); if (p) connect(p); }}><ExternalLink size={16}/>Yeniden aç</button>{profiles.some(p => p.id === current.profileId) && <button className="text-button" onClick={() => setNewSession(profiles.find(p => p.id === current.profileId)!)}><SlidersHorizontal size={16}/>Ekran ayarlarını düzenle</button>}</div>}
        </div>
        {monitor && current?.status === "connected" && ["ssh", "local", "sftp"].includes(current.type) && <RemoteMonitor key={current.id} session={current} close={() => setMonitor(false)}/>}
        {showTransfers && <div className="transfer-panel"><header><Download size={14}/><strong>Dosya aktarımları</strong><span>{transfers.length}</span><button className="icon-button" onClick={() => setShowTransfers(false)} title="Aktarımları gizle"><X size={14}/></button></header><div>{!transfers.length && <p>Henüz dosya aktarımı yok.</p>}{transfers.map(t => <div className="transfer-row" key={t.id}>{t.direction === 'upload' ? <Upload size={14}/> : <Download size={14}/>}<strong>{t.name}</strong>{t.detail && <span>{t.detail}</span>}<span>{size(t.bytes)}</span><small className={t.status}>{t.status === 'done' ? 'Tamamlandı' : t.status === 'error' ? 'Başarısız' : t.status === 'cancelled' ? 'İptal edildi' : t.total ? `${Math.min(100, Math.floor(t.bytes * 100 / t.total))}%` : 'Aktarılıyor…'}</small>{t.status === 'done' ? <Check size={14}/> : t.status === 'running' ? <button title="Aktarımı iptal et" onClick={() => run(() => api.cancelTransfer(t.id))}><X size={14}/></button> : t.resumable ? <button title="Aktarıma devam et" onClick={() => run(() => api.resumeTransfer(t.id))}><Play size={14}/></button> : <AlertCircle size={14}/>}</div>)}</div></div>}
      </main>
    </div>
    <footer className="statusbar"><button title="Yan paneli göster/gizle" aria-label="Yan paneli göster/gizle" onClick={() => setSidebarVisible(!sidebarVisible)}>{sidebarVisible ? <PanelLeftClose size={13}/> : <PanelLeftOpen size={13}/>}</button><span className="status-divider"/><span className={`dot ${connected.length ? '' : 'muted'}`}/><span>{sessions.length} açık oturum</span><span className="status-divider"/><span>{profiles.length} kayıtlı bağlantı</span>{xstatus !== null && <><span className="status-divider"/><span className="status-x"><Monitor size={12}/>X11 :{xstatus}</span></>}<div/><button onClick={() => setMonitor(!monitor)} title="Uzak izleme çubuğu"><Activity size={13}/>İzleme</button><button onClick={() => setShowTransfers(!showTransfers)}><Download size={13}/>Aktarımlar {transfers.length > 0 && `(${transfers.length})`}</button><span className="status-divider"/><span>UTF-8</span><span className="status-divider"/><span>{preferences.fontSize} px</span><span className="status-divider"/><button onClick={() => setHelp(true)}>VekoTerm {version}</button></footer>
    {layoutDialog && <TerminalLayoutDialog kind={layout} setKind={value => { setLayout(value); setLayoutTargets(ids => ids.slice(0, value === 'grid' ? 4 : value === 'single' ? 1 : 2)); }} sessions={layoutDialog === 'broadcast' ? connected.filter(s => ['ssh','local','telnet','serial'].includes(s.type)) : terminalSessions} targets={layoutDialog === 'broadcast' ? broadcastTargets : layoutTargets} setTargets={layoutDialog === 'broadcast' ? setBroadcastTargets : setLayoutTargets} mode={layoutDialog} close={() => setLayoutDialog(null)} apply={() => { if (layoutDialog === 'broadcast') setBroadcast(true); setLayoutDialog(null); }}/>} 
    {compare && <CompareDialog close={() => setCompare(false)}/>}
    {importExport && <ImportExportDialog mode={importExport} close={() => setImportExport(null)} completed={async message => { await refreshProfiles(); setSelectedFolder(''); setTreeState({ query: '', favorites: false, collapsed: [] }); notify(message); }}/>}
    {vaultDialog && <VaultDialog locked={false} close={() => setVaultDialog(false)} unlocked={() => {}}/>}
    {xDialog && <XServerDialog close={() => setXDialog(false)} changed={setXstatus}/>}
    {utilities && <UtilitiesDialog close={() => setUtilities(false)}/>}
    {workspaces && <WorkspacesDialog sessions={sessions} layout={layout} targets={layoutTargets} active={active} close={() => setWorkspaces(false)} restored={result => { setLayout(result.layout); setLayoutTargets(result.targets); setActive(result.active); }}/>}
    {macros && <MacrosDialog sessions={sessions} active={active} draft={macros.draft} jobs={macroJobs} close={() => setMacros(null)}/>}
    {toolsSession && sessions.some(s => s.id === toolsSession) && <TerminalTools session={sessions.find(s => s.id === toolsSession)!} close={() => setToolsSession(null)} run={run} recorded={(commands, skipped) => { setMacros({ draft: commands }); if (skipped) notify(`${skipped} düzenlenmiş satır kayda alınmadı.`); }}/>} 
    {authChallenges[0] && <AuthDialog key={authChallenges[0].id} challenge={authChallenges[0]}/>}
    {movingProfile && <MoveConnectionDialog profile={movingProfile} folders={folders} close={() => setMovingProfile(null)} submit={folder => moveProfile(movingProfile, folder)}/>}
    {newSession && <SessionDialog initial={newSession} profiles={profiles} folders={folders} createFolder={createFolder} close={() => setNewSession(null)} submit={saveSession} remove={profiles.some(p => p.id === newSession.id) ? () => askRemoveProfile(profiles.find(p => p.id === newSession.id)!) : undefined}/>}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <AlertCircle size={18}/> : <CheckCircle2 size={18}/>}<span>{toast.text}</span><button title="Bildirimi kapat" onClick={() => setToast(null)}><X size={14}/></button></div>}
    {settings && <div className="modal-backdrop"><section className="small-dialog settings-dialog" role="dialog" aria-modal="true" aria-label="Ayarlar"><header className="dialog-header"><h2>Çalışma alanı ayarları</h2><button className="icon-button" onClick={() => setSettings(false)} title="Kapat"><X size={19}/></button></header><div className="dialog-body"><label>Görünüm<div className="theme-options"><button className={preferences.theme === 'dark' ? 'selected' : ''} onClick={() => updatePreferences({ theme: 'dark' })}><Moon size={20}/>Koyu</button><button className={preferences.theme === 'light' ? 'selected' : ''} onClick={() => updatePreferences({ theme: 'light' })}><Sun size={20}/>Açık</button></div></label><label>Terminal yazı karakteri<select value={preferences.fontFamily || 'Cascadia Code'} onChange={e => updatePreferences({ fontFamily: e.target.value })}>{['Cascadia Code', 'Cascadia Mono', 'Consolas', 'Lucida Console', 'Courier New', 'JetBrains Mono', 'Fira Code'].map(font => <option key={font} value={font}>{font}</option>)}</select><span className="field-hint">Bilgisayarında kurulu olmayan yazı tipleri yerine Consolas kullanılır.</span></label><label>Terminal yazı boyutu<input type="range" min="11" max="24" value={preferences.fontSize} onChange={e => updatePreferences({ fontSize: Number(e.target.value) })}/><span className="field-hint">{preferences.fontSize} piksel</span></label><pre className="terminal-font-preview" aria-label="Terminal yazı önizlemesi" style={{ fontFamily: '"' + (preferences.fontFamily || 'Cascadia Code') + '", Consolas, monospace', fontSize: preferences.fontSize }}>{'user@sunucu:~$ ls -la\nÇç Ğğ İı Öö Şş Üü · 0123456789'}</pre><p className="field-hint">Terminal zemini açık ve koyu temada siyah kalır. Yazı değişiklikleri açık terminallere de uygulanır.</p><label className="check"><input type="checkbox" checked={preferences.terminalHighlights !== false} onChange={e => updatePreferences({ terminalHighlights: e.target.checked })}/>Komut ve önemli çıktıları renklendir</label><div className="terminal-highlight-preview" aria-label="Renklendirme örnekleri"><span className="highlight-command">Komut</span><span className="highlight-option">--seçenek</span><span className="highlight-error">HATA</span><span className="highlight-warning">UYARI</span><span className="highlight-success">BAŞARILI</span></div><p className="field-hint">Tanınan komut satırları, satır başındaki büyük harfli durum etiketleri (ATANDI yeşil, ATLANDI sarı, HATA kırmızı, diğerleri mavi), önemli sözcükler, IP adresleri ve dosya yolları vurgulanır. Sunucunun gönderdiği renkler korunur.</p><label className="check"><input type="checkbox" checked={!!preferences.compact} onChange={e => updatePreferences({ compact: e.target.checked })}/>Kompakt araç çubuğu ve dosya satırları</label><label className="check"><input type="checkbox" checked={preferences.copyOnSelect} onChange={e => updatePreferences({ copyOnSelect: e.target.checked })}/>Terminalde seçilen metni otomatik kopyala</label><p className="field-hint">Sol tuşla sürükleyerek seçin. Sağ tık menüsünden kopyalayabilir ve yapıştırabilirsiniz. Fareyi kullanan terminal uygulamalarında seçim için Shift tuşunu basılı tutun.</p><div className="info-note"><ShieldCheck size={20}/><span>Bağlantı kayıtları bu cihazda tutulur. Kaydetmeyi seçtiğin parolalar Windows korumasıyla şifrelenir. Dışa aktarılan bağlantılarda parola bulunmaz.</span></div>{profiles.some(p => p.id === selectedProfile) && <button className="text-danger" onClick={() => { setSettings(false); askRemoveProfile(profiles.find(p => p.id === selectedProfile)!); }}><Trash2 size={14}/>Seçili oturum kaydını sil</button>}</div></section></div>}
    {help && <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="VekoTerm hakkında"><header className="dialog-header"><div><span className="eyebrow">AÇIK KAYNAK · MIT</span><h2>VekoTerm <small>{version}</small></h2></div><button className="icon-button" title="Kapat" onClick={() => setHelp(false)}><X size={19}/></button></header><div className="dialog-body"><p>Terminal, dosyalar ve uzak bağlantılar için kişisel çalışma alanın.</p><h4>Bu sürüm</h4><p>SSH/SFTP, FTP/FTPS, Telnet, seri port ve yerel terminal; gelişmiş düzenleyici, dosya aktarımı, tüneller, makrolar, çalışma alanları, X11 ve VNC. RDP ayrı Windows penceresinde açılır.</p><h4>Geliştirme kapsamı</h4><p>Gömülü RDP, Mosh/Rlogin/XDMCP, eklenti ve paket yöneticisi, otomatik güncelleme henüz tamamlanmadı. MobaXterm ile tam özellik eşitliği yoktur.</p><div className="info-note"><Keyboard size={20}/><span>Terminalde arama: Ctrl + Shift + F<br/>Kopyalama: Metni seç veya Ctrl + Shift + C<br/>Tümünü seç: Ctrl + Shift + A<br/>Tümünü kopyala: Sağ tık → Tümünü kopyala<br/>Yapıştırma: Sağ tık → Yapıştır veya Ctrl + Shift + V<br/>Çoklu komutu durdurma: Esc</span></div><p className="field-hint">Vekosis Kurumsal Bilgi Sistemleri<br/>Geri bildirim: vekosis@vekosis.com</p></div></section></div>}
    {tunnels && <TunnelDialog profiles={profiles} current={current} close={() => setTunnels(false)}/>}
    {editor && <div className="modal-backdrop editor-backdrop"><section className="editor-dialog" role="dialog" aria-modal="true" aria-label="Dosya düzenleyici"><header><FileText size={17}/><strong>{editor.path.split(/[\\/]/).pop()}{editor.text !== editor.original && ' ●'}</strong><span>{editor.path}</span><button className="button primary" disabled={editorBusy || editor.text === editor.original} onClick={saveFile}>{editorBusy ? 'Kaydediliyor…' : 'Kaydet'}</button><button className="icon-button" title="Düzenleyiciyi kapat" onClick={closeEditor}><X size={18}/></button></header><CodeEditor key={`${editor.sessionId}:${editor.path}`} path={editor.path} text={editor.text} theme={preferences.theme} change={text => setEditor({ ...editor, text })} save={saveFile}/><footer><span>UTF-8 · {editor.text.split('\n').length} satır</span><span>Ara / değiştir · Ctrl F / Ctrl H · Kaydet · Ctrl S</span></footer></section></div>}
    {prompt && <div className="modal-backdrop prompt-backdrop"><section className="small-dialog prompt-dialog" role="dialog" aria-modal="true" aria-label={prompt.title}><header className="dialog-header"><h2>{prompt.title}</h2><button className="icon-button" title="Kapat" onClick={() => { setPrompt(null); setPromptError(''); }}><X size={18}/></button></header><form onSubmit={async e => { e.preventDefault(); try { await prompt.action(prompt.value); setPrompt(null); setPromptError(''); } catch (error: any) { setPromptError(error.message); } }}><div className="dialog-body"><label>{prompt.label}{!prompt.danger && <input autoFocus value={prompt.value} onChange={e => setPrompt({ ...prompt, value: e.target.value })}/>}</label>{promptError && <p className="error-message">{promptError}</p>}</div><footer className="dialog-footer"><button type="button" className="text-button" onClick={() => setPrompt(null)}>Vazgeç</button><button className={`button ${prompt.confirmLabel ? 'danger' : 'primary'}`} autoFocus={prompt.danger}>{prompt.danger ? prompt.confirmLabel || 'Devam et' : 'Kaydet'}</button></footer></form></section></div>}
    {quick && <div className="modal-backdrop quick-backdrop" onClick={() => setQuick(false)}><section className="quick-dialog" role="dialog" aria-modal="true" aria-label="Hızlı erişim" onClick={e => e.stopPropagation()}><div className="quick-input"><Search size={21}/><input autoFocus placeholder="Oturum veya komut ara…" value={quickSearch} onChange={e => setQuickSearch(e.target.value)}/><kbd>Esc</kbd></div><div className="quick-results">{[{ label: 'Yeni SSH oturumu', icon: Plus, action: () => addSession() }, { label: 'Yerel terminal aç', icon: Terminal, action: openLocal }, { label: 'Ayarlar', icon: Settings, action: () => setSettings(true) }, ...profiles.map(p => ({ label: p.name + ' · ' + (p.host || 'Yerel'), icon: icons[p.type], action: () => connect(p) }))].filter(item => item.label.toLocaleLowerCase('tr').includes(quickSearch.toLocaleLowerCase('tr'))).map(item => <button key={item.label} onClick={() => { setQuick(false); setQuickSearch(''); item.action(); }}><item.icon size={17}/><span>{item.label}</span><ArrowRight size={15}/></button>)}</div></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
