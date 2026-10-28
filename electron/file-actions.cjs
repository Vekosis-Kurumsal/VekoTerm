const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const nameOnly = name => {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Geçersiz dosya adı.');
  return name;
};
const local = s => s.profile.type === 'local';
const join = (s, ...parts) => (local(s) ? path : path.posix).join(...parts);
const stat = (s, target) => local(s) ? fsp.lstat(target) : call(s.sftp, 'lstat', target);
const kind = attrs => attrs.mode & 0o170000;

module.exports = {
  async createFile(id, dir, name) {
    const s = this.get(id), target = join(s, this.target(s, dir), nameOnly(name));
    if (local(s)) await fsp.writeFile(target, '', { flag: 'wx' });
    else await call(s.sftp, 'writeFile', target, '', { flag: 'wx', mode: 0o644 });
  },
  async permissions(id, target, mode) {
    const s = this.get(id);
    if (local(s)) throw new Error('Windows dosya izinlerini Dosya Gezgini üzerinden değiştirebilirsiniz.');
    if (typeof mode !== 'string' || !/^[0-7]{3,4}$/.test(mode)) throw new Error('İzinleri 644 veya 755 gibi sekizli biçimde yazın.');
    const file = this.target(s, target);
    if (kind(await stat(s, file)) === 0o120000) throw new Error('Sembolik bağlantıların izinleri değiştirilemez.');
    await call(s.sftp, 'chmod', file, parseInt(mode, 8));
  },
  async removeFiles(id, dir, names) {
    const s = this.get(id), folder = this.target(s, dir);
    if (!Array.isArray(names) || !names.length || names.length > 10000) throw new Error('Silinecek dosyaları seçin.');
    const targets = [...new Set(names.map(nameOnly))].map(name => join(s, folder, name));
    let count = 0;
    const remove = async (file, depth) => {
      if (depth > 128 || ++count > 100000) throw new Error('Klasör çok büyük veya çok derin. Alt klasörleri ayrı silin.');
      this.get(id);
      const attrs = await stat(s, file);
      if (kind(attrs) === 0o040000) {
        const entries = local(s) ? await fsp.readdir(file) : (await call(s.sftp, 'readdir', file)).map(e => e.filename);
        for (const name of entries) if (name !== '.' && name !== '..') await remove(join(s, file, nameOnly(name)), depth + 1);
        if (local(s)) await fsp.rmdir(file); else await call(s.sftp, 'rmdir', file);
      } else if (local(s)) await fsp.unlink(file); else await call(s.sftp, 'unlink', file);
    };
    for (const target of targets) {
      try { await remove(target, 0); }
      catch (error) { throw new Error(`Silme tamamlanamadı: ${target}\n${error.message}`); }
    }
    return count;
  },
  async uploadDirectory(id, source, dir) {
    const s = this.get(id), sourcePath = await fsp.realpath(source);
    if (!(await fsp.lstat(source)).isDirectory()) throw new Error('Yüklenecek bir klasör seçin.');
    const destination = join(s, this.target(s, dir), nameOnly(path.basename(sourcePath)));
    if (local(s)) {
      const parent = await fsp.realpath(this.target(s, dir)), relative = path.relative(sourcePath, parent);
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Hedef, kaynak klasörün dışında olmalı.');
    }
    const plan = []; let skipped = 0;
    const walk = async (folder, parts = []) => {
      if (parts.length > 128 || plan.length > 100000) throw new Error('Klasör çok büyük veya çok derin. Alt klasörleri ayrı yükleyin.');
      for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
        const next = [...parts, nameOnly(entry.name)], file = path.join(folder, entry.name), attrs = await fsp.lstat(file);
        if (!attrs.isFile() && !attrs.isDirectory()) { skipped++; continue; }
        plan.push({ parts: next, source: file, directory: attrs.isDirectory() });
        if (attrs.isDirectory()) await walk(file, next);
      }
    };
    await walk(sourcePath);
    const job = this.beginTransfer(id, path.basename(sourcePath), 'upload'); let bytes = 0, completed = 0, started = false;
    const total = plan.filter(p => !p.directory).length;
    const report = (status, detail) => { job.bytes = bytes; this.reportTransfer(job, status, detail); };
    report('running', 'Klasör yükleniyor…');
    try {
      if (local(s)) await fsp.mkdir(destination); else await call(s.sftp, 'mkdir', destination);
      started = true;
      for (const item of plan) {
        job.controller.signal.throwIfAborted(); this.get(id);
        const attrs = await fsp.lstat(item.source);
        if ((item.directory && !attrs.isDirectory()) || (!item.directory && !attrs.isFile())) throw new Error('Kaynak klasör yükleme sırasında değişti.');
        const target = join(s, destination, ...item.parts);
        if (item.directory) {
          if (local(s)) await fsp.mkdir(target); else await call(s.sftp, 'mkdir', target);
        } else {
          const input = fs.createReadStream(item.source), output = local(s) ? fs.createWriteStream(target, { flags: 'wx' }) : s.sftp.createWriteStream(target, { flags: 'wx' });
          let last = 0;
          input.on('data', data => { bytes += data.length; if (Date.now() - last > 150) { last = Date.now(); report('running', `${completed}/${total} dosya`); } });
          await pipeline(input, output, { signal: job.controller.signal }); completed++;
        }
      }
      report('done', `${completed} dosya${skipped ? ` · ${skipped} bağlantı/özel dosya atlandı` : ''}`);
      return { path: destination, files: completed, skipped };
    } catch (error) {
      report(job.controller.signal.aborted ? 'cancelled' : 'error', job.controller.signal.aborted ? 'Yükleme iptal edildi' : started ? 'Yükleme yarım kaldı' : 'Yüklenemedi');
      throw new Error(`${error.message}${started ? `\nYüklenen bölüm burada kaldı: ${destination}` : '\nHedefte aynı adlı klasör varsa yeni bir ad veya başka bir konum seçin.'}`);
    }
  }
};
