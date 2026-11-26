// Folder sync between a folder on this computer and a folder on the server behind an SSH/SFTP tab.
// Compare lists both sides; sync copies only the rows the user picked, never deletes, and never overwrites a file
// that is newer at the destination than at the source.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (error, value) => error ? reject(error) : resolve(value)));

const LIMIT = 20000, DEPTH = 64, TOLERANCE = 2000, MAX_PATTERNS = 50;
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000;
const missing = error => ['ENOENT', 2].includes(error?.code);
// Names Windows cannot store; such server files are listed as skipped instead of failing at download time.
const WINDOWS_NAME = /[<>:"|?*\\\x00-\x1f]|[. ]$|^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

// Exact names or simple "*" patterns ("node_modules, .git, *.log").
function excluder(text) {
  const patterns = String(text || '').split(/[,\n]/).map(p => p.trim()).filter(Boolean);
  if (patterns.length > MAX_PATTERNS) throw new Error(`En fazla ${MAX_PATTERNS} hariç tutma kalıbı yazılabilir.`);
  const tests = patterns.map(p => {
    if (p.length > 200 || p.includes('/')) throw new Error(`Geçersiz hariç tutma kalıbı: ${p.slice(0, 60)}`);
    return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  });
  return name => tests.some(t => t.test(name));
}

// "a/b/c.txt" → ['a', 'b', 'c.txt']; rejects anything that could leave the chosen folders.
function relativeParts(relative) {
  if (typeof relative !== 'string' || !relative || relative.length > 4096) throw new Error('Geçersiz dosya yolu.');
  const parts = relative.split('/');
  for (const part of parts) if (!part || part === '.' || part === '..' || /[\\\x00]/.test(part)) throw new Error(`Geçersiz dosya yolu: ${relative}`);
  return parts;
}

function tooMany() { return new Error(`Klasörde ${LIMIT.toLocaleString('tr-TR')} öğeden fazlası var. Daha küçük bir klasör seçin ya da hariç tutulacak adlar ekleyin.`); }

async function walkLocal(root, exclude) {
  const items = new Map(); let skipped = 0;
  const visit = async (folder, prefix, depth) => {
    if (depth > DEPTH) throw new Error('Klasör çok derin. Daha alt bir klasör seçin.');
    for (const entry of await fsp.readdir(folder, { withFileTypes: true })) {
      if (exclude(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name, file = path.join(folder, entry.name);
      const stat = await fsp.lstat(file);
      if (stat.isDirectory()) { items.set(relative, { directory: true }); if (items.size > LIMIT) throw tooMany(); await visit(file, relative, depth + 1); }
      else if (stat.isFile()) { items.set(relative, { directory: false, size: stat.size, modified: Math.floor(stat.mtimeMs) }); if (items.size > LIMIT) throw tooMany(); }
      else skipped++;
    }
  };
  await visit(root, '', 0);
  return { items, skipped };
}

async function walkRemote(sftp, root, exclude) {
  const items = new Map(); let skipped = 0;
  const visit = async (folder, prefix, depth) => {
    if (depth > DEPTH) throw new Error('Sunucudaki klasör çok derin. Daha alt bir klasör seçin.');
    for (const entry of await call(sftp, 'readdir', folder)) {
      const name = entry.filename;
      if (name === '.' || name === '..' || exclude(name)) continue;
      const type = (entry.attrs?.mode ?? 0) & S_IFMT;
      if ((type !== S_IFDIR && type !== S_IFREG) || name.includes('/') || (process.platform === 'win32' && WINDOWS_NAME.test(name))) { skipped++; continue; }
      const relative = prefix ? `${prefix}/${name}` : name;
      if (type === S_IFDIR) { items.set(relative, { directory: true }); if (items.size > LIMIT) throw tooMany(); await visit(path.posix.join(folder, name), relative, depth + 1); }
      else { items.set(relative, { directory: false, size: entry.attrs.size, modified: entry.attrs.mtime * 1000 }); if (items.size > LIMIT) throw tooMany(); }
    }
  };
  await visit(root, '', 0);
  return { items, skipped };
}

function compareTrees(local, remote) {
  const rows = [];
  for (const relative of new Set([...local.keys(), ...remote.keys()])) {
    const l = local.get(relative), r = remote.get(relative);
    let status;
    if (l && r) {
      if (l.directory !== r.directory) status = 'conflict';
      else if (l.directory) continue; // a folder on both sides is not a change by itself
      else {
        const diff = l.modified - r.modified;
        status = l.size === r.size && Math.abs(diff) <= TOLERANCE ? 'same' : diff > TOLERANCE ? 'local-newer' : diff < -TOLERANCE ? 'remote-newer' : 'different';
      }
    } else status = l ? 'local' : 'remote';
    rows.push({ path: relative, directory: !!(l || r).directory && status !== 'conflict', status, local: l && !l.directory ? { size: l.size, modified: l.modified } : l ? { directory: true } : null, remote: r && !r.directory ? { size: r.size, modified: r.modified } : r ? { directory: true } : null });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path, 'tr'));
}

async function localFolder(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Bilgisayardaki klasörü seçin.');
  const real = await fsp.realpath(value).catch(() => { throw new Error(`Klasör bulunamadı: ${value}`); });
  if (!(await fsp.stat(real)).isDirectory()) throw new Error('Bilgisayarda bir klasör seçin.');
  return real;
}

const methods = {
  async remoteFolder(s, value) {
    if (!s.sftp) throw new Error('Bu oturumda dosya bağlantısı yok.');
    const target = await call(s.sftp, 'realpath', this.target(s, value || ''));
    const stat = await call(s.sftp, 'stat', target).catch(error => { throw missing(error) ? new Error(`Sunucuda klasör bulunamadı: ${target}`) : error; });
    if (!stat.isDirectory()) throw new Error('Sunucuda bir klasör seçin.');
    return target;
  },
  async syncCompare(id, localPath, remotePath, excludeText) {
    const s = this.get(id);
    if (!['ssh', 'sftp'].includes(s.profile.type)) throw new Error('Klasör eşitleme SSH ve SFTP bağlantılarında kullanılabilir.');
    const exclude = excluder(excludeText), local = await localFolder(localPath), remote = await this.remoteFolder(s, remotePath);
    const [left, right] = await Promise.all([walkLocal(local, exclude), walkRemote(s.sftp, remote, exclude)]);
    return { local, remote, rows: compareTrees(left.items, right.items), skipped: { local: left.skipped, remote: right.skipped } };
  },
  // items: [{ path, direction: 'upload' | 'download', size }]
  async syncRun(id, localPath, remotePath, items) {
    const s = this.get(id);
    if (!Array.isArray(items) || !items.length) throw new Error('Eşitlenecek dosya seçin.');
    if (items.length > LIMIT * 2) throw tooMany();
    const local = await localFolder(localPath), remote = await this.remoteFolder(s, remotePath), sftp = s.sftp;
    const plan = items.map(item => {
      if (!['upload', 'download'].includes(item?.direction)) throw new Error('Geçersiz eşitleme yönü.');
      const parts = relativeParts(item.path), localFile = path.join(local, ...parts), relative = path.relative(local, localFile);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Geçersiz dosya yolu: ${item.path}`);
      return { path: item.path, direction: item.direction, size: Number.isSafeInteger(item.size) && item.size > 0 ? item.size : 0, localFile, remoteFile: path.posix.join(remote, ...parts) };
    });
    const seen = new Set();
    for (const item of plan) {
      const key = process.platform === 'win32' ? item.path.toLocaleLowerCase('en') : item.path; // Windows names ignore case
      if (seen.has(key)) throw new Error(`Bir dosya yalnız bir kez ve tek yönde eşitlenebilir: ${item.path}`);
      seen.add(key);
    }
    plan.sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path));
    const uploads = plan.filter(p => p.direction === 'upload').length;
    const job = this.beginTransfer(id, path.basename(local) || local, uploads === plan.length ? 'upload' : uploads ? 'sync' : 'download');
    const result = { uploaded: 0, downloaded: 0, folders: 0, skipped: [], failed: [] };
    let done = 0, last = 0;
    const report = (status, detail) => { this.reportTransfer(job, status, detail); };
    const progress = () => { if (Date.now() - last > 150) { last = Date.now(); report('running', `${done}/${plan.length} öğe`); } };
    const remoteStat = file => call(sftp, 'stat', file).catch(error => { if (missing(error)) return null; throw error; });
    // Folders here are created one level at a time and must be real folders: a junction or link inside the chosen
    // folder could otherwise send a file named by the server somewhere else on this computer.
    const madeLocal = new Set([local]);
    const ensureLocal = async folder => {
      if (madeLocal.has(folder)) return;
      await ensureLocal(path.dirname(folder));
      const stat = await fsp.lstat(folder).catch(error => { if (missing(error)) return null; throw error; });
      if (!stat) await fsp.mkdir(folder);
      else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Bilgisayardaki yol bir klasör değil ya da başka bir yeri gösteren bir bağlantı: ${folder}`);
      madeLocal.add(folder);
    };
    const madeRemote = new Set([remote]);
    const ensureRemote = async folder => {
      if (madeRemote.has(folder)) return;
      await ensureRemote(path.posix.dirname(folder));
      const stat = await call(sftp, 'lstat', folder).catch(error => { if (missing(error)) return null; throw error; });
      if (!stat) await call(sftp, 'mkdir', folder); else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Sunucudaki yol bir klasör değil ya da bir bağlantı: ${folder}`);
      madeRemote.add(folder);
    };
    const copy = async (input, output) => {
      input.on('data', chunk => { job.bytes += chunk.length; progress(); });
      await pipeline(input, output, { signal: job.controller.signal });
    };
    job.total = plan.reduce((sum, item) => sum + item.size, 0); // sizes from the comparison, for the progress bar only
    report('running', `0/${plan.length} öğe`);
    for (const item of plan) {
      if (job.controller.signal.aborted) break;
      this.get(id);
      try {
        if (item.direction === 'upload') {
          const source = await fsp.lstat(item.localFile).catch(error => { if (missing(error)) return null; throw error; });
          if (!source) { result.skipped.push({ path: item.path, reason: 'Bilgisayarda artık yok' }); continue; }
          if (source.isDirectory()) { await ensureRemote(item.remoteFile); result.folders++; continue; }
          if (!source.isFile()) { result.skipped.push({ path: item.path, reason: 'Özel dosya' }); continue; }
          await ensureRemote(path.posix.dirname(item.remoteFile));
          const existing = await remoteStat(item.remoteFile);
          if (existing?.isDirectory()) { result.skipped.push({ path: item.path, reason: 'Sunucuda aynı adla klasör var' }); continue; }
          if (existing && existing.mtime * 1000 > source.mtimeMs + TOLERANCE) { result.skipped.push({ path: item.path, reason: 'Sunucudaki dosya daha yeni' }); continue; }
          const temporary = path.posix.join(path.posix.dirname(item.remoteFile), `.${path.posix.basename(item.remoteFile)}.vekoterm-${randomBytes(4).toString('hex')}`);
          try {
            await copy(fs.createReadStream(item.localFile), sftp.createWriteStream(temporary, { flags: 'wx', mode: existing ? existing.mode & 0o7777 : 0o644 }));
            if (existing) await call(sftp, 'chmod', temporary, existing.mode & 0o7777).catch(() => {});
            try { await call(sftp, 'ext_openssh_rename', temporary, item.remoteFile); }
            catch (error) {
              if (error.code !== 8 && !/unsupported|does not support/i.test(error.message)) throw error;
              if (existing) await call(sftp, 'unlink', item.remoteFile);
              await call(sftp, 'rename', temporary, item.remoteFile);
            }
          } catch (error) { await call(sftp, 'unlink', temporary).catch(() => {}); throw error; }
          // Same modification time on both sides, so the next comparison shows the file as unchanged.
          await call(sftp, 'utimes', item.remoteFile, Math.floor(source.atimeMs / 1000), Math.floor(source.mtimeMs / 1000)).catch(() => {});
          result.uploaded++;
        } else {
          const source = await remoteStat(item.remoteFile);
          if (!source) { result.skipped.push({ path: item.path, reason: 'Sunucuda artık yok' }); continue; }
          if (source.isDirectory()) { await ensureLocal(item.localFile); result.folders++; continue; }
          if (!source.isFile()) { result.skipped.push({ path: item.path, reason: 'Özel dosya' }); continue; }
          await ensureLocal(path.dirname(item.localFile));
          const existing = await fsp.lstat(item.localFile).catch(error => { if (missing(error)) return null; throw error; });
          if (existing?.isDirectory()) { result.skipped.push({ path: item.path, reason: 'Bilgisayarda aynı adla klasör var' }); continue; }
          if (existing && !existing.isFile()) { result.skipped.push({ path: item.path, reason: 'Bilgisayarda aynı adla bir bağlantı ya da özel dosya var' }); continue; }
          if (existing && existing.mtimeMs > source.mtime * 1000 + TOLERANCE) { result.skipped.push({ path: item.path, reason: 'Bilgisayardaki dosya daha yeni' }); continue; }
          const temporary = `${item.localFile}.vekoterm-${randomBytes(4).toString('hex')}`;
          try { await copy(sftp.createReadStream(item.remoteFile), fs.createWriteStream(temporary, { flags: 'wx' })); await fsp.rename(temporary, item.localFile); }
          catch (error) { await fsp.unlink(temporary).catch(() => {}); throw error; }
          await fsp.utimes(item.localFile, source.atime, source.mtime).catch(() => {});
          result.downloaded++;
        }
      } catch (error) {
        if (job.controller.signal.aborted) break;
        result.failed.push({ path: item.path, error: error.message });
      } finally { done++; progress(); }
    }
    const summary = [result.uploaded && `${result.uploaded} yüklendi`, result.downloaded && `${result.downloaded} indirildi`, result.skipped.length && `${result.skipped.length} atlandı`, result.failed.length && `${result.failed.length} aktarılamadı`].filter(Boolean).join(' · ') || 'Değişiklik yok';
    if (job.controller.signal.aborted) { report('cancelled', `Eşitleme iptal edildi · ${summary}`); result.cancelled = true; }
    else report(result.failed.length ? 'error' : 'done', summary);
    return result;
  }
};

module.exports = { methods, excluder, relativeParts, compareTrees, TOLERANCE };
