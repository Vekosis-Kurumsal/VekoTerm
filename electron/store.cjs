const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const protocols = new Set(['ssh', 'sftp', 'local', 'rdp', 'vnc', 'telnet', 'serial', 'ftp', 'ftps']);
const DEFAULT_FOLDER = 'Bağlantılar';
function cleanFolder(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Klasör adı 1–80 karakter olmalı.');
  return value.trim().normalize('NFC');
}
const folderKey = value => value.normalize('NFC').toLocaleLowerCase('tr');

function cleanProfile(input) {
  if (!input || !protocols.has(input.type)) throw new Error('Geçerli bir bağlantı türü seçin.');
  const port = Number(input.port || ({ rdp: 3389, vnc: 5900, telnet: 23, ftp: 21, ftps: 21 }[input.type] || 22));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port 1–65535 arasında olmalı.');
  const host = String(input.host || '').trim();
  if (!['local', 'serial'].includes(input.type) && (!host || /[\s\x00-\x1f/\\]/.test(host) || host.startsWith('-'))) throw new Error('Geçerli bir sunucu adresi yazın.');
  const profile = {
    id: /^[a-z0-9-]{1,80}$/i.test(input.id || '') ? input.id : randomUUID(),
    name: String(input.name || host || (input.type === 'serial' ? input.serial?.path : '') || 'Yerel terminal').trim().slice(0, 100),
    type: input.type, host, port,
    username: String(input.username || '').slice(0, 150),
    folder: cleanFolder(input.folder || DEFAULT_FOLDER),
    color: /^#[a-f0-9]{6}$/i.test(input.color || '') ? input.color : '#56b6a4',
    auth: ['password', 'key', 'agent', 'interactive'].includes(input.auth) ? input.auth : 'password',
    keyPath: String(input.keyPath || ''), x11: !!input.x11,
    shell: ['powershell', 'cmd', 'wsl', 'bash'].includes(input.shell) ? input.shell : 'powershell',
    favorite: !!input.favorite, ftpImplicit: !!input.ftpImplicit,
    jumpProfileId: /^[a-z0-9-]{1,80}$/i.test(input.jumpProfileId || '') ? input.jumpProfileId : '',
    compression: !!input.compression, agentForward: !!input.agentForward,
    keepaliveSeconds: Math.max(0, Math.min(600, Number.isFinite(Number(input.keepaliveSeconds)) ? Number(input.keepaliveSeconds) : 15)),
    connectTimeout: Math.max(5, Math.min(300, Number(input.connectTimeout) || 25))
  };
  if (input.proxy?.type && input.proxy.type !== 'none') {
    const proxy = input.proxy, proxyPort = Number(proxy.port || (proxy.type === 'socks5' ? 1080 : proxy.type === 'https' ? 443 : 8080));
    if (!['http', 'https', 'socks5'].includes(proxy.type) || typeof proxy.host !== 'string' || !proxy.host.trim() || /[\s\x00-\x1f/\\]/.test(proxy.host) || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new Error('Proxy adresini ve portunu kontrol edin.');
    if (profile.jumpProfileId) throw new Error('Aynı bağlantıda ara sunucu veya proxy seçin. Proxy gerekiyorsa ara sunucu kaydına ekleyebilirsiniz.');
    profile.proxy = { type: proxy.type, host: proxy.host.trim(), port: proxyPort, username: String(proxy.username || '').slice(0, 150) };
  }
  if (profile.type === 'rdp') profile.rdp = require('./rdp.cjs').cleanRDP(input.rdp);
  if (profile.type === 'serial') profile.serial = require('./serial.cjs').cleanSerial(input.serial);
  return profile;
}

class Store {
  constructor(dir, secure) {
    this.dir = dir; this.secure = secure;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'settings.json');
    this.data = { version: 1, profiles: [], folders: [DEFAULT_FOLDER], secrets: {}, knownHosts: {}, preferences: { theme: 'dark', fontSize: 14, fontFamily: 'Cascadia Code', copyOnSelect: true, terminalHighlights: true } };
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved.format === 'vekoterm-vault') { this.envelope = saved; this.locked = true; return; }
        this.data = { ...this.data, ...saved, preferences: { ...this.data.preferences, ...saved.preferences } };
        delete this.data.preferences.terminalBottomSpace;
      }
      catch { throw new Error('Ayar dosyası okunamadı. Veri kaybını önlemek için uygulama durduruldu.'); }
    }
    // Older versions store folders only on profiles. Keep those groups and empty new folders.
    this.data.profiles = this.data.profiles.map(p => ({ ...p, folder: p.folder || DEFAULT_FOLDER }));
    this.data.folders = [...new Set([...(Array.isArray(this.data.folders) ? this.data.folders.filter(f => typeof f === 'string' && f) : []), ...this.data.profiles.map(p => p.folder || DEFAULT_FOLDER)])];
  }
  flush() {
    const tmp = this.file + '.tmp';
    if (this.locked) throw new Error('Uygulama kilitli.');
    const content = this.vault ? require('./vault.cjs').seal(this.data, this.vault) : this.data;
    fs.writeFileSync(tmp, JSON.stringify(content, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  vaultStatus() { return { enabled: !!(this.vault || this.envelope), locked: !!this.locked }; }
  enableVault(password) {
    if (this.locked) throw new Error('Önce kilidi açın.');
    const previous = this.vault, next = require('./vault.cjs').create(password); this.vault = next;
    try { this.flush(); previous?.key.fill(0); this.envelope = null; } catch (error) { next.key.fill(0); this.vault = previous; throw error; }
  }
  lock() {
    if (!this.vault) throw new Error('Önce ana parola oluşturun.');
    this.flush(); this.envelope = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.vault.key.fill(0); this.vault = null; this.locked = true; this.data = { profiles: [], folders: [], secrets: {}, knownHosts: {}, preferences: { theme: 'dark', fontSize: 14, fontFamily: 'Cascadia Code', copyOnSelect: true, terminalHighlights: true } };
  }
  unlock(password) {
    if (!this.locked) return;
    const unlocked = require('./vault.cjs').unseal(this.envelope, password); this.data = unlocked.data; this.vault = { key: unlocked.key, salt: unlocked.salt }; this.locked = false; this.envelope = null;
  }
  disableVault(password) {
    if (this.locked || !this.vault) throw new Error('Önce kilidi açın.');
    const verified = require('./vault.cjs').unseal(JSON.parse(fs.readFileSync(this.file, 'utf8')), password); verified.key.fill(0);
    const previous = this.vault; this.vault = null; try { this.flush(); previous.key.fill(0); } catch (error) { this.vault = previous; throw error; }
  }
  list() { return this.data.profiles.map(p => ({ ...p, ...this.secretState(p.id) })); }
  folders() { return [...this.data.folders].sort((a, b) => a === b ? 0 : a === DEFAULT_FOLDER ? -1 : b === DEFAULT_FOLDER ? 1 : a.localeCompare(b, 'tr')); }
  folderName(value) {
    const name = cleanFolder(value);
    return this.data.folders.find(f => folderKey(f) === folderKey(name)) || name;
  }
  createFolder(value) {
    const name = cleanFolder(value);
    if (this.data.folders.some(f => folderKey(f) === folderKey(name))) throw new Error('Bu isimde bir bağlantı klasörü zaten var.');
    this.data.folders.push(name); this.flush(); return name;
  }
  renameFolder(from, value) {
    if (!this.data.folders.includes(from)) throw new Error('Klasör bulunamadı.');
    const name = cleanFolder(value);
    if (this.data.folders.some(f => f !== from && folderKey(f) === folderKey(name))) throw new Error('Bu isimde bir bağlantı klasörü zaten var.');
    this.data.folders = this.data.folders.map(f => f === from ? name : f);
    this.data.profiles = this.data.profiles.map(p => p.folder === from ? { ...p, folder: name } : p);
    this.flush(); return name;
  }
  removeFolder(name) {
    if (!this.data.folders.includes(name)) throw new Error('Klasör bulunamadı.');
    if (this.data.profiles.some(p => p.folder === name)) throw new Error('Önce içindeki bağlantıları başka bir klasöre taşıyın.');
    this.data.folders = this.data.folders.filter(f => f !== name); this.flush();
  }
  moveProfile(id, folder) {
    const profile = this.data.profiles.find(p => p.id === id);
    if (!profile) throw new Error('Bağlantı bulunamadı.');
    if (!this.data.folders.includes(folder)) throw new Error('Hedef bağlantı klasörü bulunamadı.');
    profile.folder = folder; this.flush(); return { ...profile, ...this.secretState(id) };
  }
  save(input) {
    const profile = cleanProfile(input);
    let sealed;
    if (input.remember && input.password) {
      if (!this.secure?.isEncryptionAvailable()) throw new Error('Windows parola koruması kullanılamıyor. Parola kaydedilmedi.');
      sealed = this.secure.encryptString(String(input.password)).toString('base64');
    }
    profile.folder = this.folderName(profile.folder);
    if (!this.data.folders.includes(profile.folder)) this.data.folders.push(profile.folder);
    const index = this.data.profiles.findIndex(p => p.id === profile.id);
    if (index < 0) this.data.profiles.push(profile); else this.data.profiles[index] = profile;
    if (sealed) this.data.secrets[profile.id] = sealed;
    if (input.forgetSecret) delete this.data.secrets[profile.id];
    this.flush(); return { ...profile, ...this.secretState(profile.id) };
  }
  importProfiles(input) {
    if (this.locked) throw new Error('Önce uygulamanın kilidini açın.');
    const next = { ...this.data, folders: [...this.data.folders], profiles: [...this.data.profiles], secrets: { ...this.data.secrets } };
    const folderName = value => {
      const name = cleanFolder(value), existing = next.folders.find(f => folderKey(f) === folderKey(name));
      if (existing) return existing;
      next.folders.push(name); return name;
    };
    for (const folder of input.folders) folderName(folder);
    const ids = new Set(next.profiles.map(p => p.id));
    for (const item of input.profiles) {
      const profile = cleanProfile(item);
      if (ids.has(profile.id)) throw new Error('Yinelenen bağlantı kimliği nedeniyle aktarım durduruldu.');
      ids.add(profile.id); profile.folder = folderName(profile.folder);
      if (item.remember && item.password) {
        if (!this.secure?.isEncryptionAvailable()) throw new Error('Windows parola koruması kullanılamıyor. İçe aktarım yapılmadı.');
        next.secrets[profile.id] = this.secure.encryptString(item.password).toString('base64');
      }
      next.profiles.push(profile);
    }
    // Validate and encrypt everything before committing once. A failure leaves
    // both existing profiles and saved passwords unchanged.
    const previous = this.data; this.data = next;
    try { this.flush(); } catch (error) { this.data = previous; throw error; }
    return input.profiles.length;
  }
  // A saved password the current Windows protection key cannot open (the Windows account password was reset, or
  // changed somewhere other than this computer) counts as not saved: connecting asks for it and it can be saved again.
  // The unreadable value is kept, so it opens again if the old key comes back.
  secretState(id) {
    if (!this.data.secrets[id]) return { hasSecret: false };
    return this.secretUnreadable(id) ? { hasSecret: false, secretUnreadable: true } : { hasSecret: true };
  }
  secretUnreadable(id) {
    const value = this.data.secrets[id]; if (!value) return false;
    this.readable ||= new Map();
    if (!this.readable.has(value)) {
      let ok = true; try { this.secure.decryptString(Buffer.from(value, 'base64')); } catch { ok = false; }
      this.readable.set(value, ok);
    }
    return !this.readable.get(value);
  }
  unreadableSecretError(id) {
    const name = this.data.profiles.find(p => p.id === id)?.name;
    return Object.assign(new Error(`${name ? `“${name}” bağlantısının` : 'Bu bağlantının'} kayıtlı parolası bu Windows hesabında açılamıyor; Windows hesap parolası başka bir yerden değiştirilmiş ya da sıfırlanmış olabilir. Bağlantıyı düzenleyip parolayı yeniden yazın ve “Parolayı sakla”yı işaretleyin.`), { code: 'SECRET_UNREADABLE' });
  }
  secret(id) {
    const value = this.data.secrets[id]; if (!value) return '';
    try { return this.secure.decryptString(Buffer.from(value, 'base64')); } catch { throw this.unreadableSecretError(id); }
  }
  remove(id) {
    if (this.locked) throw new Error('Önce uygulamanın kilidini açın.');
    if (!this.data.profiles.some(p => p.id === id)) throw new Error('Bağlantı bulunamadı.');
    // Deleting a jump host or a tunnel's SSH profile would silently break those records.
    const jumpUsers = this.data.profiles.filter(p => p.jumpProfileId === id).map(p => p.name);
    if (jumpUsers.length) throw new Error(`Bu bağlantı ara sunucu olarak kullanılıyor: ${jumpUsers.join(', ')}. Önce o bağlantıların ara sunucu ayarını değiştirin.`);
    const tunnels = (this.data.tunnels || []).filter(t => t.profileId === id).map(t => t.name);
    if (tunnels.length) throw new Error(`Bu bağlantıyı kullanan kayıtlı tüneller var: ${tunnels.join(', ')}. Önce tünelleri silin.`);
    this.data.profiles = this.data.profiles.filter(p => p.id !== id); delete this.data.secrets[id]; this.flush();
  }
  // Command history lives with the other records (sealed too when the master password is on). Writing after every
  // command would rewrite the whole file, so it is saved a moment later.
  history() { return this.locked ? [] : (this.data.commandHistory || []); }
  addHistory(entry) { if (this.locked) return; this.data.commandHistory = require('./command-history.cjs').addEntry(this.data.commandHistory || [], entry); this.flushSoon(); }
  removeHistory(id) { this.data.commandHistory = (this.data.commandHistory || []).filter(e => e.id !== id); this.flush(); }
  clearHistory() { this.data.commandHistory = []; this.flush(); }
  // The folder pair last used for folder sync, per connection (kept for at most 200 connections).
  syncPair(key) { return this.locked ? null : (this.data.syncPairs || {})[key] || null; }
  saveSyncPair(key, pair) {
    if (this.locked) return;
    const pairs = { ...(this.data.syncPairs || {}) }; delete pairs[key];
    pairs[key] = { local: String(pair.local), remote: String(pair.remote), exclude: String(pair.exclude || '').slice(0, 2000) };
    const keys = Object.keys(pairs); for (const old of keys.slice(0, Math.max(0, keys.length - 200))) delete pairs[old];
    this.data.syncPairs = pairs; this.flushSoon();
  }
  flushSoon() { clearTimeout(this.flushTimer); this.flushTimer = setTimeout(() => this.flushPending(), 1500); }
  flushPending() { if (!this.flushTimer) return; clearTimeout(this.flushTimer); this.flushTimer = null; try { if (!this.locked) this.flush(); } catch {} }
  trust(host, port, fingerprint) { this.data.knownHosts[`${host}:${port}`] = fingerprint; this.flush(); }
  known(host, port) { return this.data.knownHosts[`${host}:${port}`]; }
  preferences(input) {
    this.data.preferences = {
      theme: ['light', 'dark', 'emerald'].includes(input.theme) ? input.theme : this.data.preferences.theme,
      fontSize: Math.max(11, Math.min(24, Number(input.fontSize) || this.data.preferences.fontSize)),
      fontFamily: ['Cascadia Code', 'Cascadia Mono', 'Consolas', 'Lucida Console', 'Courier New', 'JetBrains Mono', 'Fira Code'].includes(input.fontFamily) ? input.fontFamily : (this.data.preferences.fontFamily || 'Cascadia Code'),
      copyOnSelect: typeof input.copyOnSelect === 'boolean' ? input.copyOnSelect : this.data.preferences.copyOnSelect,
      compact: typeof input.compact === 'boolean' ? input.compact : !!this.data.preferences.compact,
      terminalHighlights: typeof input.terminalHighlights === 'boolean' ? input.terminalHighlights : this.data.preferences.terminalHighlights !== false,
      closeAction: ['quit', 'tray', 'ask'].includes(input.closeAction) ? input.closeAction : (this.data.preferences.closeAction || 'quit'),
      autoReconnect: typeof input.autoReconnect === 'boolean' ? input.autoReconnect : this.data.preferences.autoReconnect !== false,
      reconnectAttempts: Math.max(1, Math.min(20, Math.round(Number(input.reconnectAttempts)) || this.data.preferences.reconnectAttempts || 5)),
      reconnectDelay: Math.max(2, Math.min(60, Math.round(Number(input.reconnectDelay)) || this.data.preferences.reconnectDelay || 5)),
      commandHistory: typeof input.commandHistory === 'boolean' ? input.commandHistory : this.data.preferences.commandHistory !== false,
      updateCheck: typeof input.updateCheck === 'boolean' ? input.updateCheck : this.data.preferences.updateCheck !== false
    }; this.flush(); return this.data.preferences;
  }
  saveTunnel(input) {
    const config = require('./tunnels.cjs').cleanTunnel(input);
    if (!this.data.profiles.some(p => p.id === config.profileId && p.type === 'ssh')) throw new Error('Kayıtlı bir SSH bağlantısı seçin.');
    this.data.tunnels ||= []; const index = this.data.tunnels.findIndex(t => t.id === config.id);
    if (index < 0) this.data.tunnels.push(config); else this.data.tunnels[index] = config;
    this.flush(); return config;
  }
  removeTunnel(id) { this.data.tunnels = (this.data.tunnels || []).filter(t => t.id !== id); this.flush(); }
  saveMacro(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || typeof input.commands !== 'string' || !input.commands.trim() || input.commands.length > 65536 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.commands)) throw new Error('Makro adını ve komutlarını kontrol edin.');
    const macro = { id: /^[a-z0-9-]{1,80}$/i.test(input.id || '') ? input.id : randomUUID(), name: input.name.trim().slice(0, 100), commands: input.commands.replace(/\r\n/g, '\n'), delayMs: Math.max(0, Math.min(10000, Number.isFinite(Number(input.delayMs)) ? Number(input.delayMs) : 150)), shortcut: [1, 2, 3, 4, 5, 6, 7, 8, 9].includes(Number(input.shortcut)) ? Number(input.shortcut) : 0 };
    // One macro per Alt+number: giving the key to this macro takes it from the other one.
    if (macro.shortcut) for (const other of this.data.macros || []) if (other.id !== macro.id && other.shortcut === macro.shortcut) other.shortcut = 0;
    this.data.macros ||= []; const index = this.data.macros.findIndex(m => m.id === macro.id); if (index < 0) this.data.macros.push(macro); else this.data.macros[index] = macro;
    this.flush(); return macro;
  }
  removeMacro(id) { this.data.macros = (this.data.macros || []).filter(m => m.id !== id); this.flush(); }
}
module.exports = { Store, cleanProfile };
