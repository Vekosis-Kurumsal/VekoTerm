const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { diffLines } = require('diff');
async function digest(file) { const hash = createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
async function compareFiles(left, right) {
  const a = await fsp.lstat(left), b = await fsp.lstat(right); if (!a.isFile() || !b.isFile()) throw new Error('İki normal dosya seçin.');
  if (a.size > 256 * 1024 * 1024 || b.size > 256 * 1024 * 1024) throw new Error('Karşılaştırma dosya başına 256 MB ile sınırlıdır.');
  const [leftHash, rightHash] = await Promise.all([digest(left), digest(right)]), equal = leftHash === rightHash;
  const result = { left, right, equal, leftHash, rightHash, changes: [], note: '' };
  if (equal) { result.note = 'Dosyaların içeriği aynı.'; return result; }
  if (a.size > 2 * 1024 * 1024 || b.size > 2 * 1024 * 1024) { result.note = 'İçerikler farklı. 2 MB üzerindeki dosyalar için yalnız özet karşılaştırması gösterilir.'; return result; }
  const buffers = await Promise.all([fsp.readFile(left), fsp.readFile(right)]); let texts;
  try { if (buffers.some(b => b.includes(0))) throw new Error(); texts = buffers.map(b => new TextDecoder('utf-8', { fatal: true }).decode(b)); }
  catch { result.note = 'İkili dosyalar veya UTF-8 dışındaki metinler farklı.'; return result; }
  const changes = diffLines(texts[0], texts[1], { timeout: 1000, maxEditLength: 10000 });
  if (!changes) result.note = 'Dosyalar farklı; satır karşılaştırması işlem sınırını aştı.';
  else result.changes = changes.map(c => ({ value: c.value, kind: c.added ? 'added' : c.removed ? 'removed' : 'same' }));
  return result;
}
async function compareFolders(left, right) {
  const scan = async root => {
    if (!(await fsp.lstat(root)).isDirectory()) throw new Error('İki normal klasör seçin.');
    const entries = new Map(); let count = 0;
    const walk = async (directory, relative = '', depth = 0) => {
      if (depth > 64) throw new Error('Klasör yapısı çok derin.');
      for (const e of await fsp.readdir(directory, { withFileTypes: true })) { if (++count > 10000) throw new Error('En fazla 10000 öğe karşılaştırılabilir.'); const rel = path.join(relative, e.name), full = path.join(directory, e.name), stat = await fsp.lstat(full); entries.set(rel, { full, size: stat.size, kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'special' }); if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(full, rel, depth + 1); }
    }; await walk(root); return entries;
  };
  const [a, b] = await Promise.all([scan(left), scan(right)]), rows = []; let bytes = 0;
  for (const name of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(name), y = b.get(name); let status;
    if (!x) status = 'right'; else if (!y) status = 'left'; else if (x.kind !== y.kind) status = 'different'; else if (['link','special'].includes(x.kind)) status = 'skipped'; else if (x.kind === 'directory') status = 'same'; else if (x.size !== y.size) status = 'different'; else if (bytes + x.size + y.size > 256 * 1024 * 1024) status = 'skipped'; else { bytes += x.size + y.size; status = (await digest(x.full)) === (await digest(y.full)) ? 'same' : 'different'; }
    rows.push({ name, status });
  }
  return { left, right, rows };
}
module.exports = { compareFiles, compareFolders };
