const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');

function authority(display, cookie) {
  const chunks = [Buffer.from([255, 255])];
  for (const value of [Buffer.alloc(0), Buffer.from(String(display)), Buffer.from('MIT-MAGIC-COOKIE-1'), Buffer.from(cookie, 'hex')]) {
    const length = Buffer.alloc(2); length.writeUInt16BE(value.length); chunks.push(length, value);
  }
  return Buffer.concat(chunks);
}
function probeCookie(port, cookie) {
  const protocol = Buffer.from('MIT-MAGIC-COOKIE-1'), auth = Buffer.from(cookie, 'hex');
  const pad = n => Buffer.alloc((4 - n % 4) % 4);
  const header = Buffer.alloc(12); header[0] = 0x6c; header.writeUInt16LE(11, 2); header.writeUInt16LE(protocol.length, 6); header.writeUInt16LE(auth.length, 8);
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(Buffer.concat([header, protocol, pad(protocol.length), auth, pad(auth.length)])));
    socket.setTimeout(300); socket.once('data', data => { socket.destroy(); resolve(data[0]); }); socket.once('error', () => resolve(-1)); socket.once('close', () => resolve(-1)); socket.once('timeout', () => { socket.destroy(); resolve(-1); });
  });
}
class XServer {
  constructor(dir, bundle) { this.dir = dir; this.bundle = bundle; this.process = null; this.config = null; }
  async start(options = {}) {
    if (!this.starting) this.starting = this.startProcess(options).finally(() => { this.starting = null; });
    return this.starting;
  }
  async startProcess(options = {}) {
    if (this.process && this.config) return this.config;
    const exe = path.join(this.bundle, 'vcxsrv.exe');
    if (!fs.existsSync(exe)) throw new Error('X sunucusu pakette bulunamadı. VekTerm paketini yeniden hazırlayın.');
    let display;
    for (let candidate = 110; candidate < 130; candidate++) {
      const available = await new Promise(resolve => { const server = net.createServer(socket => socket.destroy()); server.once('error', () => resolve(false)); server.listen(6000 + candidate, '127.0.0.1', () => server.close(() => resolve(true))); });
      if (available) { display = candidate; break; }
    }
    if (!display) throw new Error('X sunucusu için boş ekran bulunamadı.');
    const cookie = randomBytes(16).toString('hex');
    const authFile = path.join(this.dir, `xauthority-${display}-${randomBytes(6).toString('hex')}`); this.authFile = authFile;
    fs.writeFileSync(authFile, authority(display, cookie), { mode: 0o600 });
    const proc = spawn(exe, [`:${display}`, '-multiwindow', options.clipboard === false ? '-noclipboard' : '-clipboard', options.openGL === false ? '-nowgl' : '-wgl', '-listen', 'tcp', '-auth', authFile, '-silent-dup-error', '-logfile', path.join(this.dir, 'xserver.log')], { windowsHide: true, stdio: 'ignore', cwd: this.bundle });
    this.process = proc;
    let error; proc.on('error', e => { error = e; }); proc.on('exit', () => { if (this.process === proc) { this.process = null; this.config = null; } try { fs.unlinkSync(authFile); } catch {} });
    for (let retry = 0; retry < 60; retry++) {
      if (error || proc.exitCode !== null || this.process !== proc) throw new Error(error?.message || 'X sunucusu başlatılamadı veya durduruldu.');
      const ready = await new Promise(resolve => { const socket = net.connect(6000 + display, '127.0.0.1'); socket.setTimeout(100); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); }); });
      if (ready && await probeCookie(6000 + display, cookie) === 1 && await probeCookie(6000 + display, '') === 0) { this.config = { port: 6000 + display, cookie, display }; return this.config; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    proc.kill(); throw new Error('X sunucusu zamanında yanıt vermedi.');
  }
  stop() { this.process?.kill(); this.process = null; this.config = null; try { if (this.authFile) fs.unlinkSync(this.authFile); } catch {} this.authFile = null; }
}
module.exports = { XServer, authority };
