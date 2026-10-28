const { EventEmitter } = require('node:events');
const { StringDecoder } = require('node:string_decoder');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { cleanProfile } = require('./store.cjs');

const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_EDIT = 2 * 1024 * 1024;
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const safeName = name => {
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Geçersiz dosya adı.');
  return name;
};

class Sessions extends EventEmitter {
  constructor(store, options = {}) { super(); this.store = store; this.options = options; this.items = new Map(); }
  get(id) { const s = this.items.get(id); if (!s) throw new Error('Oturum kapalı. Yeniden bağlanın.'); return s; }
  info(s) { return { id: s.id, name: s.profile.name, type: s.profile.type, host: s.profile.host, username: s.profile.username, color: s.profile.color, profileId: s.profile.id, status: s.status, buffer: s.buffer, home: s.home || '', ...s.public }; }
  emitState(s) { if (!s.hidden && this.items.get(s.id) === s) this.emit('event', { type: 'state', session: this.info(s) }); }
  output(s, data) {
    if (this.items.get(s.id) !== s) return;
    const text = Buffer.isBuffer(data) ? (s.decoder ||= new StringDecoder('utf8')).write(data) : String(data); s.buffer = (s.buffer + text).slice(-300000);
    if (s.log) { try { s.log.write(text); } catch (error) { s.log.close(); s.log = null; s.public = { ...s.public, logging: false }; this.emitState(s); this.emit('event', { type: 'notice', message: `Terminal kaydı durdu: ${error.message}` }); } }
    s.oscTail = ((s.oscTail || '') + text).slice(-8192);
    const directories = [...s.oscTail.matchAll(/\x1b\]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g)];
    if (directories.length) { try { s.cwd = decodeURIComponent(directories.at(-1)[1]); } catch {} s.oscTail = ''; }
    s.pending = (s.pending || '') + text;
    if (!s.timer) s.timer = setTimeout(() => { this.emit('event', { type: 'data', id: s.id, data: s.pending }); s.pending = ''; s.timer = null; }, 16);
  }
  async open(input, options = {}) {
    if (this.store.locked) throw new Error('Uygulama kilitli.');
    const profile = cleanProfile(input);
    const s = { id: randomUUID(), profile, authInput: { password: input.password || '' }, hidden: !!options.hidden, status: 'connecting', buffer: '', resources: [], home: '' };
    this.items.set(s.id, s); this.emitState(s);
    try {
      if (profile.type === 'local') this.openLocal(s);
      else if (['ftp','ftps'].includes(profile.type)) await require('./ftp.cjs').openFTP.call(this, s, input);
      else if (profile.type === 'serial') await require('./serial.cjs').openSerial.call(this, s);
      else if (profile.type === 'telnet') await require('./telnet.cjs').openTelnet.call(this, s);
      else if (['ssh', 'sftp'].includes(profile.type)) await this.openSSH(s, input);
      else if (profile.type === 'vnc') await this.options.openVNC(s, input);
      else if (profile.type === 'rdp') await this.options.openRDP(s);
      if (!this.items.has(s.id)) throw new Error('Bağlantı iptal edildi.');
      s.status = profile.type === 'rdp' ? 'external' : profile.type === 'vnc' ? 'connecting' : 'connected'; this.emitState(s); return this.info(s);
    } catch (error) {
      this.output(s, `\r\n\x1b[31m${error.message}\x1b[0m\r\n`);
      s.status = 'error'; this.emitState(s); this.dispose(s); throw error;
    }
  }
  openLocal(s) {
    const pty = require('node-pty');
    const win = process.platform === 'win32';
    const shells = win ? {
      powershell: [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo']],
      cmd: [process.env.ComSpec || 'cmd.exe', []], wsl: ['wsl.exe', []],
      bash: ['C:\\Program Files\\Git\\bin\\bash.exe', ['--login']]
    } : { powershell: [process.env.SHELL || '/bin/bash', []] };
    const [exe, args] = shells[s.profile.shell] || shells.powershell;
    s.home = this.options.localCwd || os.homedir();
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
    delete env.ELECTRON_RUN_AS_NODE;
    // PowerShell reconstructs its standard module paths instead of inheriting a launcher runtime's modules.
    if (win && s.profile.shell === 'powershell') for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
    s.pty = pty.spawn(exe, args, { name: 'xterm-256color', cols: 100, rows: 28, cwd: s.home, env, useConpty: true, useConptyDll: true });
    s.pty.onData(data => this.output(s, data));
    s.pty.onExit(() => { if (this.items.get(s.id) === s && s.status !== 'error') this.close(s.id); });
    s.status = 'connected';
  }
  async openSSH(s, input) {
    const p = s.profile;
    const client = await require('./ssh-connection.cjs').call(this, s, p, input); s.client = client;
    let x11;
    if (p.x11) x11 = await this.options.startX11?.();
    client.on('x11', (_info, accept, reject) => {
      if (!x11) return reject();
      const socket = net.connect(x11.port, '127.0.0.1'); s.resources.push(socket);
      socket.once('connect', () => { const channel = accept(); socket.pipe(channel).pipe(socket); channel.on('error', () => socket.destroy()); });
      socket.on('error', () => { socket.destroy(); reject(); });
    });
    client.on('close', () => { if (this.items.get(s.id) !== s) return; if (!['error', 'closed'].includes(s.status)) { s.status = 'closed'; this.emitState(s); } this.dispose(s); });
    client.on('error', error => { if (s.status === 'connected') { this.output(s, `\r\n${error.message}\r\n`); s.status = 'error'; this.emitState(s); } });
    if (p.type === 'ssh') {
      s.stream = await new Promise((resolve, reject) => client.shell({ term: 'xterm-256color', cols: 100, rows: 28 }, x11 ? { x11: { single: false, protocol: 'MIT-MAGIC-COOKIE-1', cookie: x11.cookie, screen: 0 } } : {}, (err, stream) => err ? reject(err) : resolve(stream)));
      s.stream.on('data', data => this.output(s, data));
      s.stream.stderr.on('data', data => this.output(s, data));
      s.stream.on('exit', code => { s.shellExited = Number.isInteger(code); });
      s.stream.on('close', () => {
        if (this.items.get(s.id) !== s) return;
        if (s.shellExited && s.status !== 'error') { this.close(s.id); return; }
        client.end(); if (s.status !== 'error') { s.status = 'closed'; this.emitState(s); }
      });
      s.stream.on('error', error => this.output(s, `\r\n${error.message}\r\n`));
    }
    try { s.sftp = await call(client, 'sftp'); s.home = await call(s.sftp, 'realpath', '.'); }
    catch (error) { if (p.type === 'sftp') throw error; this.output(s, `\r\nDosya paneli kullanılamıyor: ${error.message}\r\n`); }
    if (p.type === 'sftp') this.output(s, '\r\nSFTP bağlantısı hazır. Dosyaları soldaki panelden yönetebilirsiniz.\r\n');
  }
  input(id, data) { const s = this.get(id); if (typeof data !== 'string' || data.length > 1024 * 1024) throw new Error('Girdi çok uzun.'); if (s.status !== 'connected') return; if (s.recordingActive) { if (s.recording.length + data.length > 65536) { s.recordingActive = false; s.public = { ...s.public, recording: true }; this.emitState(s); this.emit('event', { type: 'notice', message: 'Makro kaydı sınırına ulaşıldı. Kaydı durdurup gözden geçirin.' }); } else s.recording += data; } if (s.pty) s.pty.write(data); else s.stream?.write(data); }
  resize(id, cols, rows) { const s = this.get(id); if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || cols > 1000 || rows > 500) return; try { s.pty?.resize(cols, rows); s.stream?.setWindow(rows, cols, 0, 0); } catch {} }
  dispose(s) {
    try { s.log?.close(); } catch {} s.log = null; s.authInput = null; s.recording = ''; s.recordingActive = false;
    if (s.public?.logging || s.public?.recording) { s.public = { ...s.public, logging: false, recording: false }; this.emitState(s); }
    const resources = s.resources; s.resources = [];
    try { s.pty?.kill(); } catch {}
    try { s.client?.end(); } catch {}
    for (const r of resources) { try { r.destroy?.(); } catch {} try { r.close?.(); } catch {} }
  }
  close(id) {
    const s = this.items.get(id);
    // Forget the session before closing resources: their late events must not reopen its tab.
    this.items.delete(id);
    if (s) { s.status = 'closed'; clearTimeout(s.timer); s.timer = null; }
    for (const job of this.jobs?.values() || []) if (job.sessionId === id && job.status === 'running') this.cancelTransfer(job.id);
    this.emit('event', { type: 'removed', id });
    if (s) this.dispose(s);
  }
  closeAll() { for (const job of this.macroJobs?.values() || []) job.abort(); for (const id of this.items.keys()) this.close(id); }
  target(s, value) { if (typeof value !== 'string' || value.includes('\0')) throw new Error('Geçersiz yol.'); return s.profile.type === 'local' ? path.resolve(value || s.home) : path.posix.resolve(s.home || '/', value || '.'); }
  async list(id, dir) {
    const s = this.get(id), folder = this.target(s, dir);
    let files;
    if (s.profile.type === 'local') {
      const entries = await fsp.readdir(folder, { withFileTypes: true });
      files = await Promise.all(entries.map(async e => { let stat; try { stat = await fsp.stat(path.join(folder, e.name)); } catch {} return { name: e.name, path: path.join(folder, e.name), directory: stat?.isDirectory() || e.isDirectory(), size: stat?.size || 0, mode: stat?.mode, modified: stat?.mtimeMs || 0 }; }));
    } else {
      if (!s.sftp) throw new Error('Bu oturumda dosya bağlantısı yok.');
      const entries = await call(s.sftp, 'readdir', folder);
      files = entries.filter(e => e.filename !== '.' && e.filename !== '..').map(e => ({ name: e.filename, path: path.posix.join(folder, e.filename), directory: (e.attrs.mode & 0o170000) === 0o040000, link: (e.attrs.mode & 0o170000) === 0o120000, size: e.attrs.size, mode: e.attrs.mode, modified: e.attrs.mtime * 1000 }));
    }
    files.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'tr'));
    return { path: folder, parent: s.profile.type === 'local' ? path.dirname(folder) : path.posix.dirname(folder), files };
  }
  async read(id, file) {
    const s = this.get(id), target = this.target(s, file);
    const stat = s.profile.type === 'local' ? await fsp.stat(target) : await call(s.sftp, 'stat', target);
    if (stat.size > MAX_EDIT) throw new Error('Düzenleyici en fazla 2 MB boyutunda metin dosyalarını açar.');
    const data = await this.readLimited(s, target);
    if (data.includes(0)) throw new Error('Bu dosya metin biçiminde değil. İndir düğmesini kullanın.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { throw new Error('Bu dosya UTF-8 metin biçiminde değil. Dosyayı indirip uygun düzenleyicide açın.'); }
    return { path: target, text: data.toString('utf8'), hash: hash(data) };
  }
  async readLimited(s, target) {
    const stream = s.profile.type === 'local' ? fs.createReadStream(target) : s.sftp.createReadStream(target);
    const parts = []; let size = 0;
    for await (const chunk of stream) { size += chunk.length; if (size > MAX_EDIT) { stream.destroy(); throw new Error('Dosya düzenleme sınırını aşıyor.'); } parts.push(chunk); }
    return Buffer.concat(parts);
  }
  async write(id, file, text, expectedHash) {
    const s = this.get(id), target = this.target(s, file), data = Buffer.from(text, 'utf8');
    if (data.length > MAX_EDIT) throw new Error('Dosya 2 MB sınırını aşıyor.');
    const existing = await this.readLimited(s, target);
    if (!expectedHash || hash(existing) !== expectedHash) throw new Error('Dosya siz açtıktan sonra değişmiş. Yeniden açıp değişiklikleri karşılaştırın.');
    const temporary = target + '.vekterm-' + randomUUID() + '.tmp';
    if (s.profile.type === 'local') {
      const stat = await fsp.stat(target);
      try { await fsp.writeFile(temporary, data, { flag: 'wx', mode: stat.mode }); await fsp.rename(temporary, target); }
      catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
    } else {
      const stat = await call(s.sftp, 'stat', target);
      try {
        await call(s.sftp, 'writeFile', temporary, data, { flag: 'wx', mode: stat.mode & 0o777 });
        try { await call(s.sftp, 'ext_openssh_rename', temporary, target); }
        catch (error) { if (error.code !== 8 && !/unsupported|does not support/i.test(error.message)) throw error; await call(s.sftp, 'rename', temporary, target); }
      } catch (error) { await call(s.sftp, 'unlink', temporary).catch(() => {}); throw error; }
    }
    return { hash: hash(data) };
  }
  async mkdir(id, dir, name) { const s = this.get(id); safeName(name); const target = s.profile.type === 'local' ? path.join(this.target(s, dir), name) : path.posix.join(this.target(s, dir), name); if (s.profile.type === 'local') await fsp.mkdir(target); else await call(s.sftp, 'mkdir', target); }
  async rename(id, file, name) { const s = this.get(id); safeName(name); const from = this.target(s, file); const to = s.profile.type === 'local' ? path.join(path.dirname(from), name) : path.posix.join(path.posix.dirname(from), name); let exists = false; try { if (s.profile.type === 'local') await fsp.stat(to); else await call(s.sftp, 'stat', to); exists = true; } catch (e) { if (!['ENOENT', 2].includes(e.code)) throw e; } if (exists) throw new Error('Bu isimde bir dosya zaten var.'); if (s.profile.type === 'local') await fsp.rename(from, to); else await call(s.sftp, 'rename', from, to); }
  async downloadDirectory(id, remote, parent) {
    const s = this.get(id), source = this.target(s, remote), localSession = s.profile.type === 'local';
    const join = localSession ? path.join : path.posix.join;
    const stat = async target => localSession ? fsp.lstat(target) : call(s.sftp, 'lstat', target);
    const kind = attrs => attrs.mode & 0o170000;
    if (kind(await stat(source)) !== 0o040000) throw new Error('İndirmek için bir klasör seçin.');
    const parentPath = await fsp.realpath(parent);
    if (localSession) {
      const realSource = await fsp.realpath(source), relative = path.relative(realSource, parentPath);
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Hedef, kaynak klasörün dışında olmalı.');
    }
    const localName = name => {
      safeName(name);
      if (process.platform === 'win32' && (/[<>:"|?*]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))) throw new Error(`Windows bu dosya adını desteklemiyor: ${name}`);
      return name;
    };
    const name = localName((localSession ? path.basename(source) : path.posix.basename(source)) || 'Kök klasör');
    const job = this.beginTransfer(id, name, 'download'), plan = [];
    let bytes = 0, completed = 0, skipped = 0, destination, last = 0;
    const report = (status, detail) => { job.bytes = bytes; this.reportTransfer(job, status, detail); };
    const walk = async (folder, relative = [], depth = 0) => {
      job.controller.signal.throwIfAborted(); this.get(id);
      if (depth > 128 || plan.length > 100000) throw new Error('Klasör çok büyük veya çok derin. Alt klasörleri ayrı indirin.');
      const entries = localSession ? (await fsp.readdir(folder)).map(filename => ({ filename })) : await call(s.sftp, 'readdir', folder);
      const names = new Set();
      for (const entry of entries) {
        if (entry.filename === '.' || entry.filename === '..') continue;
        const childName = localName(entry.filename), key = process.platform === 'win32' ? childName.toLowerCase() : childName;
        if (names.has(key)) throw new Error(`Hedefte aynı ada dönüşen dosyalar var: ${childName}`);
        names.add(key);
        const target = join(folder, childName), attrs = entry.attrs || await stat(target), type = kind(attrs);
        if (type !== 0o040000 && type !== 0o100000) { skipped++; continue; }
        const parts = [...relative, childName];
        plan.push({ remote: target, parts, directory: type === 0o040000 });
        if (plan.length > 100000) throw new Error('Klasörde çok fazla öğe var. Alt klasörleri ayrı indirin.');
        if (type === 0o040000) await walk(target, parts, depth + 1);
      }
    };
    report('running', 'Klasör taranıyor…');
    try {
      await walk(source);
      for (let suffix = 1; suffix <= 1000; suffix++) {
        const candidate = path.join(parentPath, suffix === 1 ? name : `${name} (${suffix})`);
        try { await fsp.mkdir(candidate); destination = candidate; break; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!destination) throw new Error('Hedefte uygun bir klasör adı bulunamadı.');
      const total = plan.filter(item => !item.directory).length;
      for (const item of plan) {
        job.controller.signal.throwIfAborted(); this.get(id);
        const target = path.resolve(destination, ...item.parts);
        if (!target.startsWith(destination + path.sep)) throw new Error('Geçersiz hedef yolu.');
        // Recheck each source: a link must not replace a file between listing and transfer.
        if (kind(await stat(item.remote)) !== (item.directory ? 0o040000 : 0o100000)) throw new Error('Kaynak klasör indirme sırasında değişti. Yeniden deneyin.');
        if (item.directory) { await fsp.mkdir(target); continue; }
        const input = localSession ? fs.createReadStream(item.remote) : s.sftp.createReadStream(item.remote);
        input.on('data', chunk => { bytes += chunk.length; if (Date.now() - last > 150) { report('running', `${completed}/${total} dosya`); last = Date.now(); } });
        await pipeline(input, fs.createWriteStream(target, { flags: 'wx' }), { signal: job.controller.signal });
        completed++;
        report('running', `${completed}/${total} dosya`);
      }
      report('done', `${completed} dosya${skipped ? ` · ${skipped} bağlantı/özel dosya atlandı` : ''}`);
      return { path: destination, files: completed, skipped };
    } catch (error) {
      report(job.controller.signal.aborted ? 'cancelled' : 'error', job.controller.signal.aborted ? 'İndirme iptal edildi' : destination ? 'İndirme yarım kaldı' : 'İndirilemedi');
      throw new Error(`${error.message}${destination ? `\nİndirilen bölüm burada kaldı: ${destination}` : ''}`);
    }
  }
  async tunnel(id, localPort, host, port) {
    const s = this.get(id);
    if (!s.client || s.status !== 'connected') throw new Error('Tünel için açık bir SSH bağlantısı seçin.');
    for (const value of [localPort, port]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Geçerli port numaraları girin.');
    if (typeof host !== 'string' || !host || /[\s\x00-\x1f]/.test(host)) throw new Error('Geçerli hedef adresi girin.');
    const server = net.createServer(socket => { s.resources.push(socket); s.client.forwardOut('127.0.0.1', socket.remotePort || 0, host, port, (error, stream) => { if (error) return socket.destroy(); socket.on('error', () => stream.destroy()); stream.on('error', () => socket.destroy()); socket.pipe(stream).pipe(socket); }); });
    server.on('error', () => {});
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(localPort, '127.0.0.1', resolve); });
    s.resources.push(server);
    return { localPort, host, port };
  }
}
Object.assign(Sessions.prototype, require('./file-actions.cjs'));
Object.assign(Sessions.prototype, require('./transfers.cjs'));
Object.assign(Sessions.prototype, require('./remote-tools.cjs').methods);
Object.assign(Sessions.prototype, require('./tunnels.cjs').methods);
Object.assign(Sessions.prototype, require('./session-tools.cjs').methods);
module.exports = { Sessions, safeName, MAX_EDIT };
