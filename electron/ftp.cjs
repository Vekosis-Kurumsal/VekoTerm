const { Client } = require('basic-ftp');
const { PassThrough, Writable, Readable } = require('node:stream');
const path = require('node:path');
function validPath(value) { if (typeof value !== 'string' || /[\x00\r\n]/.test(value)) throw new Error('Geçersiz FTP yolu.'); return value; }
function attrs(entry) { return { size: entry.size, mtime: entry.modifiedAt ? entry.modifiedAt.getTime() / 1000 : 0, mode: entry.isSymbolicLink ? 0o120777 : entry.isDirectory ? 0o040755 : 0o100644 }; }
class FtpAdapter {
  constructor(config, ClientClass = Client) { this.config = config; this.ClientClass = ClientClass; this.clients = new Set(); this.pending = Promise.resolve(); this.closed = false; }
  async client() { if (this.closed) throw new Error('FTP bağlantısı kapalı.'); const c = new this.ClientClass(30000); this.clients.add(c); try { await c.access(this.config); if (this.closed) throw new Error('FTP bağlantısı kapalı.'); return c; } catch (e) { this.release(c); throw e; } }
  release(c) { c.close(); this.clients.delete(c); }
  async access() { this.control = await this.client(); this.home = await this.control.pwd(); return this.home; }
  queue(fn, callback) { const task = this.pending.then(async () => { if (this.closed) throw new Error('FTP bağlantısı kapalı.'); if (!this.control || this.control.closed) this.control = await this.client(); return fn(this.control); }); this.pending = task.catch(() => {}); task.then(result => callback(null, result), callback); }
  async statWith(c, filename) { validPath(filename); if (filename === '/') return { size: 0, mtime: 0, mode: 0o040755 }; const entries = await c.list(path.posix.dirname(filename)); const entry = entries.find(e => e.name === path.posix.basename(filename)); if (!entry) throw Object.assign(new Error('Dosya bulunamadı.'), { code: 2 }); return attrs(entry); }
  async absent(c, filename) { try { await this.statWith(c, filename); } catch (e) { if (e.code === 2) return; throw e; } throw Object.assign(new Error('Bu isimde bir dosya zaten var.'), { code: 'EEXIST' }); }
  stat(file, cb) { this.queue(c => this.statWith(c, file), cb); }
  lstat(file, cb) { this.stat(file, cb); }
  realpath(file, cb) { queueMicrotask(() => cb(null, path.posix.resolve(this.home || '/', validPath(file)))); }
  readdir(file, cb) { this.queue(async c => (await c.list(validPath(file))).map(e => ({ filename: e.name, attrs: attrs(e) })), cb); }
  mkdir(file, cb) { this.queue(async c => { await this.absent(c, file); await c.send('MKD ' + validPath(file)); }, cb); }
  rmdir(file, cb) { this.queue(c => c.send('RMD ' + validPath(file)), cb); }
  unlink(file, cb) { this.queue(c => c.remove(validPath(file)), cb); }
  rename(from, to, cb) { this.queue(c => c.rename(validPath(from), validPath(to)), cb); }
  ext_openssh_rename(_from, _to, cb) { queueMicrotask(() => cb(Object.assign(new Error('Unsupported FTP extension'), { code: 8 }))); }
  chmod(file, mode, cb) { this.queue(c => c.send(`SITE CHMOD ${(mode & 0o7777).toString(8)} ${validPath(file)}`), cb); }
  writeFile(file, data, options, cb) { this.queue(async c => { if (options?.flag === 'wx') await this.absent(c, file); await c.uploadFrom(Readable.from([Buffer.from(data)]), validPath(file)); }, cb); }
  createReadStream(file, options = {}) {
    const output = new PassThrough(); let client, completed = false;
    output.on('close', () => { if (!completed) client?.close(); });
    (async () => { try {
      client = await this.client(); if (output.destroyed) return;
      let offset = options.start || 0, remaining = options.end === undefined ? Infinity : options.end - offset + 1;
      const destination = new Writable({ write(chunk, _encoding, cb) { const data = chunk.subarray(0, Math.max(0, Math.min(chunk.length, remaining))); remaining -= data.length; if (!data.length || output.write(data)) cb(); else output.once('drain', cb); } });
      await client.downloadTo(destination, validPath(file), offset); completed = true; output.end();
    } catch (e) { output.destroy(e); } finally { if (client) this.release(client); } })();
    return output;
  }
  createWriteStream(file, options = {}) {
    const input = new PassThrough(); let client, readyResolve, readyReject;
    const done = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); done.catch(() => {});
    const output = new Writable({ write(chunk, _encoding, cb) { if (input.write(chunk)) cb(); else input.once('drain', cb); }, final(cb) { input.end(); done.then(() => cb(), cb); }, destroy(error, cb) { input.destroy(); client?.close(); cb(error); } });
    input.on('error', e => output.destroy(e));
    (async () => { try {
      client = await this.client(); if (output.destroyed) throw new Error('Aktarım iptal edildi.');
      if (options.flags === 'wx') await this.absent(client, file);
      else if (options.flags === 'r+') { const info = await this.statWith(client, file); if (info.size !== options.start) throw new Error('Kısmi FTP dosyasının boyutu değişti.'); }
      output.emit('open', 0);
      if (options.flags === 'r+') await client.appendFrom(input, validPath(file)); else await client.uploadFrom(input, validPath(file));
      readyResolve();
    } catch (e) { readyReject(e); output.destroy(e); } finally { if (client) this.release(client); } })();
    return output;
  }
  close() { this.closed = true; for (const c of this.clients) c.close(); this.clients.clear(); this.config = null; }
}
async function openFTP(s, input) {
  const unreadable = !input.password && !!this.store.secretUnreadable?.(s.profile.id);
  if (unreadable && !this.options.promptAuth) throw this.store.unreadableSecretError(s.profile.id);
  let password = input.password || (unreadable ? '' : this.store.secret(s.profile.id));
  if (!password && s.profile.username && s.profile.username !== 'anonymous' && this.options.promptAuth) password = (await this.options.promptAuth(s.id, `${s.profile.name} · ${unreadable ? 'Kayıtlı parola açılamadı, parolayı yazın' : 'FTP'}`, [{ prompt: 'Parola', echo: false }]))[0];
  const ftp = new FtpAdapter({ host: s.profile.host, port: s.profile.port, user: s.profile.username || 'anonymous', password: password || 'guest', secure: s.profile.type === 'ftps' ? (s.profile.ftpImplicit ? 'implicit' : true) : false });
  s.resources.push(ftp); s.sftp = ftp; s.home = await ftp.access();
  this.output(s, `\r\n${s.profile.type.toUpperCase()} bağlantısı hazır. Dosyaları soldaki panelden yönetebilirsiniz.\r\n`);
}
module.exports = { FtpAdapter, openFTP, validPath };
