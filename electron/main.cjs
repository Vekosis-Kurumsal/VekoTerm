const { app, BrowserWindow, ipcMain, dialog, safeStorage, Menu, Tray, clipboard, screen, shell, net: electronNet } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, execFile } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const { WebSocketServer } = require('ws');
const { Store, cleanProfile } = require('./store.cjs');
const { Sessions, safeName } = require('./sessions.cjs');
const { Updates } = require('./updates.cjs');
const { XServer } = require('./xserver.cjs');
app.setName('VekoTerm');
// Keep the existing profile location after the product rename.
const portable = app.commandLine.hasSwitch('portable');
app.setPath('userData', process.env.VEKTERM_TEST_HOME || (portable ? path.join(path.dirname(app.getPath('exe')), 'VekoTerm-data') : path.join(app.getPath('appData'), 'VekTerm')));
// Automated tests can run without showing a window on the user's screen; rendering must not be throttled there.
const hiddenTestWindow = !!process.env.VEKTERM_TEST_HOME && process.env.VEKTERM_TEST_HIDDEN === '1';
if (hiddenTestWindow) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}
let window, sessions, store, xserver, updates, tray = null, quitting = false, trayHintShown = false;
// One VekoTerm per data folder: starting it again brings the open window forward instead of a second copy
// writing the same settings file.
const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on('second-instance', () => showWindow());
// A quit requested for the whole app (Windows sign-out, tray "Çık" after its own question, automation) must not
// wait on the per-window question; closing the window itself still asks.
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { store?.flushPending(); sessions?.closeAll(); xserver?.stop(); tray?.destroy(); tray = null; });
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (hiddenTestWindow) window.showInactive(); else { window.show(); window.focus(); }
}
function confirmQuit() {
  if (![...(sessions?.items.values() || [])].some(s => s.status === 'connected')) return true;
  const answer = dialog.showMessageBoxSync(window, { type: 'question', title: 'VekoTerm’i kapat', message: 'Açık bağlantılar sonlandırılacak.', buttons: ['Vazgeç', 'Bağlantıları kapat ve çık'], defaultId: 0, cancelId: 0 });
  return answer === 1;
}
function quitApp() {
  if (quitting) return;
  if (!confirmQuit()) return;
  quitting = true; sessions?.closeAll(); xserver?.stop(); tray?.destroy(); tray = null; app.quit();
}
function hideToTray() {
  if (!tray) {
    tray = new Tray(path.join(__dirname, '../assets/vekterm.ico'));
    tray.setToolTip('VekoTerm');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'VekoTerm’i göster', click: showWindow }, { type: 'separator' }, { label: 'Çık', click: quitApp }]));
    tray.on('click', showWindow); tray.on('double-click', showWindow);
  }
  window.hide();
  if (!trayHintShown && !hiddenTestWindow) { trayHintShown = true; tray.displayBalloon({ title: 'VekoTerm tepside çalışıyor', content: 'Bağlantılarınız açık kalır. Geri açmak için tepsideki VekoTerm simgesine tıklayın.' }); }
}
const authQuestions = new Map();
function promptAuth(sessionId, title, prompts, instructions = '') {
  if (store?.locked) return Promise.reject(new Error('Uygulama kilitli.'));
  if (!Array.isArray(prompts) || prompts.length > 20) return Promise.reject(new Error('Sunucu çok fazla doğrulama alanı istedi.'));
  return new Promise((resolve, reject) => {
    const id = randomBytes(16).toString('hex');
    const timer = setTimeout(() => finish(null), 120000);
    const finish = answers => { clearTimeout(timer); authQuestions.delete(id); sessions.emit('event', { type: 'authDone', id }); answers ? resolve(answers) : reject(new Error('Kimlik doğrulama iptal edildi.')); };
    authQuestions.set(id, { sessionId, count: prompts.length, finish });
    sessions.emit('event', { type: 'auth', challenge: { id, sessionId, title: String(title).slice(0, 200), instructions: String(instructions).slice(0, 2000), prompts: prompts.map(p => ({ prompt: String(p.prompt).slice(0, 500), echo: !!p.echo })) } });
  });
}
const devURL = process.env.VEKTERM_DEV === '1' ? 'http://127.0.0.1:5178' : null;
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== event.sender.mainFrame) return false;
  const url = event.senderFrame.url;
  return devURL ? url.startsWith(devURL + '/') : url === require('node:url').pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
}
const handle = (name, fn) => ipcMain.handle('vekterm:' + name, async (event, ...args) => {
  if (!trusted(event)) return { ok: false, error: 'İstek kaynağı doğrulanamadı.' };
  try { if (store?.locked && !['bootstrap', 'vaultStatus', 'unlockVault', 'window'].includes(name)) throw new Error('Uygulama kilitli.'); const value = await fn(...args); if (store?.locked && !['bootstrap', 'vaultStatus', 'unlockVault', 'lockVault', 'window'].includes(name)) throw new Error('Uygulama kilitli.'); return { ok: true, value }; } catch (error) { return { ok: false, error: error.message || 'İşlem tamamlanamadı.' }; }
});

async function openVNC(s) {
  const token = randomBytes(32).toString('hex');
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false,
    verifyClient: info => info.req.url === '/' + token && ['null', 'file://', devURL].includes(info.origin) });
  server.on('error', () => {});
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  s.resources.push(server);
  server.on('connection', ws => {
    s.resources.push(ws);
    const socket = net.connect(s.profile.port, s.profile.host); s.resources.push(socket);
    ws.on('message', data => socket.write(data));
    socket.on('data', data => { if (ws.readyState === 1) ws.send(data); });
    socket.on('error', () => ws.close(1011, 'Sunucuya bağlanılamadı'));
    socket.on('close', () => ws.close()); ws.on('close', () => socket.destroy()); ws.on('error', () => socket.destroy());
  });
  s.public = { vncURL: `ws://127.0.0.1:${server.address().port}/${token}` };
}
// MobaXterm keeps its sessions in MobaXterm.ini; the installed edition records the location in the registry.
async function mobaxtermSources() {
  if (process.platform !== 'win32') return [];
  if (process.env.VEKTERM_TEST_HOME) return process.env.VEKTERM_TEST_MOBAXTERM_INI ? [process.env.VEKTERM_TEST_MOBAXTERM_INI] : [];
  const candidates = [];
  const registry = await new Promise(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe'), ['query', 'HKCU\\Software\\Mobatek\\MobaXterm', '/v', 'LastIniPath'], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? '' : String(stdout))));
  const match = registry.match(/LastIniPath\s+REG_\w+\s+(.+)/);
  if (match) candidates.push(match[1].trim());
  candidates.push(path.join(app.getPath('appData'), 'MobaXterm', 'MobaXterm.ini'), path.join(app.getPath('documents'), 'MobaXterm', 'MobaXterm.ini'));
  const found = [];
  for (const candidate of candidates) {
    if (!/\.ini$/i.test(candidate)) continue;
    const file = path.resolve(candidate);
    if (found.some(f => f.toLowerCase() === file.toLowerCase())) continue;
    try { if ((await fs.stat(file)).isFile()) found.push(file); } catch {}
  }
  return found;
}
async function openRDP(s) {
  if (process.platform !== 'win32') throw new Error('Bu sürümde RDP bağlantısı Windows üzerinde kullanılabilir.');
  const file = path.join(app.getPath('userData'), `session-${s.id}.rdp`);
  const rdp = require('./rdp.cjs');
  const display = window && !window.isDestroyed() ? screen.getDisplayMatching(window.getBounds()) : screen.getPrimaryDisplay();
  const geometry = { bounds: screen.dipToScreenRect(window || null, display.bounds), workArea: screen.dipToScreenRect(window || null, display.workArea), scaleFactor: display.scaleFactor };
  await fs.writeFile(file, rdp.rdpFile(s.profile, geometry), { mode: 0o600 });
  const options = rdp.cleanRDP(s.profile.rdp), physical = options.displayMode === 'custom' ? options : options.fullscreen ? geometry.bounds : geometry.workArea;
  s.public = { ...s.public, rdpDisplay: { scale: rdp.effectiveScale(options, geometry), resize: options.resize, mode: options.multimon ? 'multimon' : options.displayMode, width: Math.round(physical.width), height: Math.round(physical.height) } };
  try { await new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/mstsc.exe'), rdp.launchArgs(file, s.profile), { windowsHide: false, detached: false, stdio: 'ignore' });
    child.once('spawn', resolve); child.once('error', reject); child.once('exit', () => { void fs.unlink(file).catch(() => {}); if (sessions.items.get(s.id) === s) sessions.close(s.id); });
  }); } catch (error) { await fs.unlink(file).catch(() => {}); throw error; }

}

app.whenReady().then(async () => {
  if (!firstInstance) return;
  store = new Store(app.getPath('userData'), safeStorage);
  // Updates come from GitHub; tests may point the check at a local server, but only inside a test home.
  const testUpdateApi = process.env.VEKTERM_TEST_HOME && process.env.VEKTERM_TEST_UPDATE_API;
  updates = new Updates({ version: app.getVersion(), directory: path.join(app.getPath('temp'), 'VekoTerm-guncelleme'), fetch: (url, options) => electronNet.fetch(url, options), ...(testUpdateApi ? { api: testUpdateApi } : {}) });
  xserver = new XServer(app.getPath('userData'), app.isPackaged ? path.join(process.resourcesPath, 'vcxsrv') : path.join(__dirname, '../vendor/vcxsrv'));
  sessions = new Sessions(store, {
    localCwd: process.env.VEKTERM_TEST_HOME || undefined,
    startX11: () => xserver.start(store.data.xserverOptions), openVNC, openRDP, promptAuth,
    verifyHost: async info => {
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Sunucu kimliğini doğrula', message: `${info.host}:${info.port} sunucusuna ilk bağlantı`, detail: `Sunucu anahtarının parmak izi:\n\n${info.fingerprint}\n\nBu anahtarı doğrulayıp kaydetmek istiyor musunuz?`, buttons: ['İptal', 'Güven ve bağlan'], defaultId: 0, cancelId: 0, noLink: true }); return result.response === 1;
    }
  });
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1450, height: 920, minWidth: 1000, minHeight: 650, frame: false, backgroundColor: '#11151b', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  sessions.on('event', event => { if (event.type === 'removed') for (const question of authQuestions.values()) if (question.sessionId === event.id) question.finish(null); if (!window.isDestroyed() && (!store.locked || event.type === 'locked')) window.webContents.send('vekterm:event', event); });
  handle('bootstrap', () => ({ profiles: store.list(), folders: store.folders(), preferences: store.data.preferences, sessions: [...sessions.items.values()].filter(s => !s.hidden).map(s => sessions.info(s)), version: app.getVersion(), desktop: true, locked: !!store.locked, portable }));
  handle('saveProfile', p => store.save(p)); handle('removeProfile', id => store.remove(id));
  for (const name of ['createFolder', 'renameFolder', 'removeFolder', 'moveProfile']) handle(name, (...args) => store[name](...args));
  handle('open', p => sessions.open(p)); handle('close', id => sessions.close(id));
  handle('input', (id, data) => sessions.userInput(id, data)); handle('resize', (id, cols, rows) => sessions.resize(id, cols, rows));
  handle('cancelTransfer', id => sessions.cancelTransfer(id)); handle('resumeTransfer', id => sessions.resumeTransfer(id));
  handle('monitor', id => sessions.monitor(id)); handle('currentDirectory', id => sessions.currentDirectory(id));
  handle('answerAuth', (id, answers) => {
    const question = authQuestions.get(id); if (!question) throw new Error('Doğrulama isteğinin süresi doldu.');
    if (answers !== null && (!Array.isArray(answers) || answers.length !== question.count || answers.some(a => typeof a !== 'string' || a.length > 4096))) throw new Error('Doğrulama alanlarını kontrol edin.');
    question.finish(answers);
  });
  handle('tunnelList', () => ({ saved: store.data.tunnels || [], running: sessions.tunnelList() }));
  handle('saveTunnel', input => store.saveTunnel(input)); handle('removeTunnel', id => store.removeTunnel(id));
  handle('startTunnel', (id, input) => sessions.startTunnel(id, input)); handle('stopTunnel', id => sessions.stopTunnel(id)); handle('startSavedTunnel', id => sessions.startSavedTunnel(id));
  handle('duplicateSession', id => sessions.duplicateSession(id));
  // Server operations: only these names can be called from the window.
  const opsActions = { services: 'opsServices', serviceLog: 'opsServiceLog', serviceAction: 'opsServiceAction', processes: 'opsProcesses', kill: 'opsKill', docker: 'opsDocker', dockerAction: 'opsDockerAction', dockerLogs: 'opsDockerLogs' };
  handle('updateCheck', async () => { const result = await updates.check(); if (!store.locked) { store.data.lastUpdateCheck = Date.now(); store.flushSoon(); } return { ...result, portable }; });
  handle('updateDownload', () => updates.download(progress => { if (!window.isDestroyed()) window.webContents.send('vekterm:event', { type: 'updateProgress', progress }); }));
  handle('updateCancel', () => updates.cancel());
  handle('updatePage', async () => { const page = updates.releasePage(); if (page) await shell.openExternal(page); });
  // Starts the verified installer and closes VekoTerm so the installer can replace it.
  handle('updateInstall', async () => {
    if (portable) throw new Error('Taşınabilir kullanımda VekoTerm kendini kurmaz. Yeni sürümü sürüm sayfasından indirin.');
    const file = await updates.verifiedInstaller();
    if (!confirmQuit()) return false;
    const failure = await shell.openPath(file); if (failure) throw new Error(`Kurulum başlatılamadı: ${failure}`);
    quitting = true; sessions?.closeAll(); xserver?.stop(); tray?.destroy(); tray = null; setTimeout(() => app.quit(), 300); return true;
  });
  // Folder sync. The folder on this computer comes from a system dialog or is the pair saved for this connection.
  const syncFolders = new Set();
  const syncKey = id => { const p = sessions.get(id).profile; return p.id || `${p.username || ''}@${p.host}:${p.port || 22}`; };
  const allowedSyncFolder = (id, local) => { if (typeof local !== 'string' || !(syncFolders.has(local) || store.syncPair(syncKey(id))?.local === local)) throw new Error('Bilgisayardaki klasörü yeniden seçin.'); };
  handle('syncPickLocal', async () => { const result = await dialog.showOpenDialog(window, { title: 'Bilgisayardaki klasörü seç', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return ''; const folder = await fs.realpath(result.filePaths[0]); syncFolders.add(folder); return folder; });
  handle('syncPair', id => store.syncPair(syncKey(id)));
  handle('syncCompare', async (id, local, remote, exclude) => { allowedSyncFolder(id, local); const result = await sessions.syncCompare(id, local, remote, exclude); syncFolders.add(result.local); store.saveSyncPair(syncKey(id), { local: result.local, remote: result.remote, exclude }); return result; });
  handle('syncRun', (id, local, remote, items) => { allowedSyncFolder(id, local); return sessions.syncRun(id, local, remote, items); });
  handle('ops', (id, action, ...args) => { if (!Object.hasOwn(opsActions, action)) throw new Error('Geçersiz sunucu işlemi.'); return sessions[opsActions[action]](id, ...args); });
  handle('historyList', () => store.history()); handle('historyRemove', id => store.removeHistory(id)); handle('historyClear', () => store.clearHistory());
  handle('reconnect', id => sessions.reconnect(id)); handle('cancelReconnect', id => sessions.cancelReconnect(id));
  handle('sendSavedPassword', id => sessions.sendSavedPassword(id));
  handle('exportTerminal', async id => { const result = await dialog.showSaveDialog(window, { title: 'Terminal çıktısını kaydet', defaultPath: 'VekoTerm-terminal.txt' }); if (result.canceled) return false; await fs.writeFile(result.filePath, sessions.transcript(id), 'utf8'); return true; });
  handle('startLog', async id => { const result = await dialog.showSaveDialog(window, { title: 'Terminal kaydının konumu', defaultPath: 'VekoTerm-oturum.log' }); if (result.canceled) return false; sessions.startLog(id, result.filePath); return true; });
  handle('stopLog', id => sessions.stopLog(id));
  handle('startRecording', id => sessions.startRecording(id)); handle('stopRecording', id => sessions.stopRecording(id));
  handle('macroList', () => store.data.macros || []); handle('saveMacro', input => store.saveMacro(input)); handle('removeMacro', id => store.removeMacro(id)); handle('startMacro', (id, targets, values) => sessions.startMacro(id, targets, values)); handle('macroVariables', () => store.locked ? {} : (store.data.macroVariables || {})); handle('stopMacro', id => sessions.stopMacro(id));
  handle('clearTerminal', id => { const s = sessions.get(id); s.buffer = ''; sessions.output(s, '\x1b[2J\x1b[3J\x1b[H'); });
  handle('vncStatus', (id, status) => { const s = sessions.get(id); if (s.profile.type !== 'vnc' || !['connected','closed','error'].includes(status)) throw new Error('Geçersiz oturum durumu.'); s.status = status; sessions.emitState(s); });
  for (const name of ['list', 'read', 'write', 'mkdir', 'rename', 'tunnel', 'createFile', 'permissions', 'removeFiles']) handle(name, (...args) => sessions[name](...args));
  handle('preferences', p => store.preferences(p));
  handle('readClipboard', () => clipboard.readText());
  handle('writeClipboard', async text => {
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new Error('Kopyalanacak metin çok büyük. Daha küçük bir bölüm seçin.');
    await clipboard.writeText(text);
    if (await clipboard.readText() !== text) throw new Error('Windows panosuna erişilemedi. VekoTerm’i kendi kısayolundan açıp yeniden deneyin.');
  });
  handle('pickKey', async () => { const result = await dialog.showOpenDialog(window, { title: 'SSH özel anahtarını seç', properties: ['openFile'] }); return result.filePaths[0] || ''; });
  handle('download', async (id, file, directory = false) => {
    if (directory) {
      const result = await dialog.showOpenDialog(window, { title: 'Klasörün indirileceği yeri seç', properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      return sessions.downloadDirectory(id, file, result.filePaths[0]);
    }
    const result = await dialog.showSaveDialog(window, { title: 'Dosyayı indir', defaultPath: safeName(path.posix.basename(file.replaceAll('\\', '/'))).replace(/[<>:"|?*]/g, '_') });
    if (result.canceled) return null;
    await sessions.transfer(id, file, result.filePath, 'download'); return { path: result.filePath };
  });
  handle('upload', async (id, dir) => {
    const result = await dialog.showOpenDialog(window, { title: 'Yüklenecek dosyaları seç', properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return false;
    const s = sessions.get(id);
    for (const local of result.filePaths) {
      const remote = s.profile.type === 'local' ? path.join(dir, path.basename(local)) : path.posix.join(dir, path.basename(local));
      await sessions.transfer(id, remote, local, 'upload');
    } return true;
  });
  handle('uploadFolder', async (id, dir) => {
    const result = await dialog.showOpenDialog(window, { title: 'Yüklenecek klasörü seç', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return false;
    await sessions.uploadDirectory(id, result.filePaths[0], dir); return true;
  });
  handle('uploadDropped', async (id, dir, sources) => {
    if (!Array.isArray(sources) || !sources.length || sources.length > 10000 || sources.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('Yüklenecek dosya veya klasörleri seçin.');
    const s = sessions.get(id), destination = sessions.target(s, dir);
    for (const source of sources) {
      const attrs = await fs.lstat(source);
      if (attrs.isDirectory()) await sessions.uploadDirectory(id, source, destination);
      else if (attrs.isFile()) await sessions.transfer(id, (s.profile.type === 'local' ? path : path.posix).join(destination, safeName(path.basename(source))), source, 'upload');
      else throw new Error('Sembolik bağlantı veya özel dosya yüklenemez.');
    }
    return true;
  });
  handle('downloadMany', async (id, files) => {
    if (!Array.isArray(files) || !files.length || files.length > 10000) throw new Error('İndirilecek dosyaları seçin.');
    const result = await dialog.showOpenDialog(window, { title: 'İndirilecek konumu seç', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return false;
    const parent = await fs.realpath(result.filePaths[0]);
    for (const file of files) {
      if (file.directory) { await sessions.downloadDirectory(id, file.path, parent); continue; }
      const name = safeName(path.posix.basename(file.path.replaceAll('\\', '/'))).replace(/[<>:"|?*]/g, '_');
      const parsed = path.parse(name); let target;
      for (let suffix = 0; suffix < 1000; suffix++) {
        const candidate = path.join(parent, suffix ? `${parsed.name} (${suffix + 1})${parsed.ext}` : name);
        try { const handle = await fs.open(candidate, 'wx'); await handle.close(); target = candidate; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!target) throw new Error('İndirme için uygun dosya adı bulunamadı.');
      await sessions.transfer(id, file.path, target, 'download');
    }
    return true;
  });
  handle('exportProfiles', async (options = {}) => {
    const result = await dialog.showSaveDialog(window, { title: 'Bağlantıları dışa aktar', defaultPath: options.encrypted ? 'VekoTerm-yedek.vekobak' : 'VekoTerm-baglantilar.json', filters: [{ name: options.encrypted ? 'Parola korumalı VekoTerm yedeği' : 'VekoTerm bağlantıları', extensions: [options.encrypted ? 'vekobak' : 'json'] }] });
    if (result.canceled) return false;
    const content = await require('./profile-backup.cjs').exportConnections(store, options);
    if (store.locked) throw new Error('Uygulama kilitli.');
    await fs.writeFile(result.filePath, content, { mode: 0o600 }); return true;
  });
  const importConnections = async (file, options = {}) => {
    const backup = require('./profile-backup.cjs');
    const stat = await fs.stat(file); if (stat.size > backup.MAX_FILE) throw new Error('Bağlantı dosyası çok büyük.');
    const parsed = await backup.readConnections(await fs.readFile(file), file, options);
    if (store.locked) throw new Error('Uygulama kilitli.');
    const data = require('./import-profiles.cjs').dropExisting(parsed, store.data.profiles);
    const folderKey = name => name.normalize('NFC').toLocaleLowerCase('tr');
    const newFolders = data.folders.filter(folder => !store.data.folders.some(existing => folderKey(existing) === folderKey(folder)));
    const skipped = data.skipped ? [`${data.skipped} bağlantı zaten kayıtlı olduğu için atlanacak (aynı tür, adres, port ve kullanıcı).`] : [];
    const warnings = [...data.warnings.slice(0, 30), ...(data.warnings.length > 30 ? [`… ve ${data.warnings.length - 30} ek uyarı.`] : [])];
    if (!data.profiles.length && !newFolders.length) {
      await dialog.showMessageBox(window, { type: 'info', title: 'İçe aktarım özeti', message: 'Eklenecek yeni bağlantı yok.', detail: [`Kaynak: ${file}`, ...skipped, ...warnings].join('\n'), buttons: ['Tamam'] });
      return 0;
    }
    const detail = [
      `Kaynak: ${file}`,
      `${newFolders.length} yeni bağlantı klasörü. Mevcut bağlantılar korunur; kayıtlar yeni bağlantılar olarak eklenir.`,
      ...skipped,
      options.encrypted ? `${data.profiles.filter(p => p.remember && p.password).length} kayıtlı parola bu bilgisayarda korunarak saklanacak.` : 'Bu içe aktarım parolaları taşımaz. MobaXterm parolalarını ilk bağlantıda yeniden girip kaydedebilirsiniz.',
      'SSH özel anahtar dosyaları aktarılmaz; dosya yollarını kontrol edin.',
      ...data.profiles.slice(0, 20).map(p => `${p.folder} / ${p.name} (${p.type.toUpperCase()})`),
      ...(data.profiles.length > 20 ? [`… ve ${data.profiles.length - 20} bağlantı daha.`] : []),
      ...warnings
    ].join('\n');
    const answer = await dialog.showMessageBox(window, { type: 'info', title: 'İçe aktarım özeti', message: `${data.profiles.length} yeni bağlantı aktarılabilir.`, detail, buttons: ['İptal', 'Bağlantıları ekle'], defaultId: 1, cancelId: 0 });
    if (answer.response !== 1) return null;
    return store.importProfiles(data);
  };
  handle('importProfiles', async (options = {}) => {
    const result = await dialog.showOpenDialog(window, { title: 'Bağlantıları içe aktar', properties: ['openFile'], filters: [{ name: options.encrypted ? 'Parola korumalı VekoTerm yedeği' : 'VekoTerm / MobaXterm', extensions: options.encrypted ? ['vekobak', 'json'] : ['json', 'ini', 'mxtsessions'] }] });
    if (result.canceled) return null;
    return importConnections(result.filePaths[0], options);
  });
  handle('mobaxtermSources', () => mobaxtermSources());
  // The renderer cannot pass a path here; only a MobaXterm.ini found on this computer is read.
  handle('importMobaXterm', async () => {
    const [file] = await mobaxtermSources();
    if (!file) throw new Error('Bu bilgisayarda MobaXterm.ini bulunamadı. “Dosya seç” ile .ini veya .mxtsessions dosyasını seçin.');
    return importConnections(file);
  });
  for (const kind of ['Files', 'Folders']) handle('compare' + kind, async () => {
    const properties = [kind === 'Folders' ? 'openDirectory' : 'openFile'];
    const left = await dialog.showOpenDialog(window, { title: 'Birinci ' + (kind === 'Folders' ? 'klasörü' : 'dosyayı') + ' seç', properties }); if (left.canceled) return null;
    const right = await dialog.showOpenDialog(window, { title: 'İkinci ' + (kind === 'Folders' ? 'klasörü' : 'dosyayı') + ' seç', properties }); if (right.canceled) return null;
    return require('./compare.cjs')['compare' + kind](left.filePaths[0], right.filePaths[0]);
  });
  handle('vaultStatus', () => store.vaultStatus());
  handle('enableVault', password => store.enableVault(password));
  handle('disableVault', password => store.disableVault(password));
  handle('lockVault', () => { if (!store.vaultStatus().enabled) throw new Error('Önce ana parola oluşturun.'); sessions.closeAll(); for (const question of authQuestions.values()) question.finish(null); store.lock(); sessions.emit('event', { type: 'locked' }); });
  handle('unlockVault', password => store.unlock(password));
  handle('serialPorts', async () => (await require('serialport').SerialPort.list()).map(p => ({ path: p.path, manufacturer: p.manufacturer })));
  handle('networkTool', input => require('./utilities.cjs').networkTool(input));
  handle('generateKey', async input => { const result = await dialog.showSaveDialog(window, { title: 'SSH özel anahtarını kaydet', defaultPath: 'id_' + (['ed25519', 'rsa', 'ecdsa'].includes(input?.type) ? input.type : 'ed25519') }); if (result.canceled) return null; return require('./utilities.cjs').generateKey(result.filePath, input); });
  handle('inspectKey', async passphrase => { const result = await dialog.showOpenDialog(window, { title: 'SSH anahtarını seç', properties: ['openFile'] }); if (result.canceled) return null; const file = result.filePaths[0]; if ((await fs.stat(file)).size > 1024 * 1024) throw new Error('Anahtar dosyası çok büyük.'); return { path: file, ...require('./utilities.cjs').keyInfo(await fs.readFile(file), passphrase || undefined) }; });
  handle('workspaceList', () => store.data.workspaces || []);
  handle('saveWorkspace', input => require('./workspaces.cjs').saveWorkspace(store, sessions, input));
  handle('removeWorkspace', id => { store.data.workspaces = (store.data.workspaces || []).filter(w => w.id !== id); store.flush(); });
  handle('openWorkspace', id => require('./workspaces.cjs').openWorkspace(store, sessions, id));
  handle('xserver', async options => { if (options) { store.data.xserverOptions = { clipboard: options.clipboard !== false, openGL: options.openGL !== false }; store.flush(); } const cfg = await xserver.start(store.data.xserverOptions); return { running: true, display: cfg.display }; });
  handle('xserverStatus', () => ({ running: !!xserver.config, display: xserver.config?.display ?? null, options: store.data.xserverOptions || { clipboard: true, openGL: true } }));
  handle('stopXserver', () => xserver.stop());
  handle('window', action => { if (action === 'minimize') window.minimize(); else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize(); else if (action === 'close') window.close(); else if (action === 'quit') quitApp(); });
  // Closing the window follows the "when the window is closed" setting: quit, keep running in the tray, or ask.
  window.on('close', event => {
    if (quitting) return;
    const action = store.data.preferences.closeAction || 'quit';
    if (action === 'tray') { event.preventDefault(); hideToTray(); return; }
    if (action === 'ask') {
      event.preventDefault();
      void dialog.showMessageBox(window, { type: 'question', title: 'VekoTerm’i kapat', message: 'VekoTerm kapatılsın mı, yoksa sistem tepsisinde çalışmaya devam etsin mi?', detail: 'Tepside çalışırken bağlantılarınız açık kalır.', buttons: ['Vazgeç', 'Tepsiye küçült', 'Çık'], defaultId: 1, cancelId: 0, noLink: true, checkboxLabel: 'Seçimimi hatırla, bir daha sorma' }).then(({ response, checkboxChecked }) => {
        if (response === 0) return;
        if (checkboxChecked) { store.preferences({ ...store.data.preferences, closeAction: response === 1 ? 'tray' : 'quit' }); window.webContents.send('vekterm:event', { type: 'preferences', preferences: store.data.preferences }); }
        if (response === 1) hideToTray(); else quitApp();
      });
      return;
    }
    if (!confirmQuit()) { event.preventDefault(); return; }
    quitting = true; sessions.closeAll(); xserver.stop(); tray?.destroy(); tray = null;
  });
  window.once('ready-to-show', () => {
    if (!hiddenTestWindow) { window.show(); return; }
    window.setSkipTaskbar(true); window.setPosition(-32000, -32000); window.showInactive(); window.setIgnoreMouseEvents(true);
  });
  if (devURL) await window.loadURL(devURL); else await window.loadFile(path.join(__dirname, '../dist/index.html'));
  // At most one automatic check a day, a few seconds after start; it can be turned off in the settings.
  if (!process.env.VEKTERM_TEST_HOME || testUpdateApi) setTimeout(async () => {
    if (store.locked || store.data.preferences.updateCheck === false || Date.now() - (store.data.lastUpdateCheck || 0) < 20 * 3600 * 1000) return;
    try {
      const result = await updates.check(); store.data.lastUpdateCheck = Date.now(); store.flushSoon();
      if (result.available && !window.isDestroyed()) window.webContents.send('vekterm:event', { type: 'update', update: { ...result, portable } });
    } catch {}
  }, testUpdateApi ? 1500 : 8000);
}).catch(error => { dialog.showErrorBox('VekoTerm başlatılamadı', error.message); app.quit(); });
app.on('window-all-closed', () => { sessions?.closeAll(); xserver?.stop(); app.quit(); });
