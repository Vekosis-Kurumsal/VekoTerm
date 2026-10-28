const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const call = (obj, method, ...args) => new Promise((resolve, reject) => obj[method](...args, (error, value) => error ? reject(error) : resolve(value)));
const snapshot = attrs => ({ size: attrs.size, modified: attrs.mtimeMs ?? attrs.mtime * 1000 });
function closed(stream) {
  const done = new Promise((resolve, reject) => { stream.once('close', resolve); stream.once('error', reject); });
  done.catch(() => {}); return done;
}
async function digest(stream, signal) {
  const closing = closed(stream), hash = createHash('sha256');
  const abort = () => stream.destroy(signal.reason); signal.addEventListener('abort', abort, { once: true });
  try { for await (const chunk of stream) { signal.throwIfAborted(); hash.update(chunk); } await closing; return hash.digest('hex'); }
  finally { signal.removeEventListener('abort', abort); }
}

module.exports = {
  beginTransfer(sessionId, name, direction) {
    this.jobs ||= new Map();
    const job = { id: randomUUID(), sessionId, name, direction, bytes: 0, total: 0, status: 'running', controller: new AbortController(), started: Date.now() };
    this.jobs.set(job.id, job);
    for (const old of this.jobs.values()) if (this.jobs.size > 100 && old.status === 'done') this.jobs.delete(old.id);
    return job;
  },
  reportTransfer(job, status, detail) {
    job.status = status; job.detail = detail;
    this.emit('event', { type: 'transfer', transfer: { id: job.id, name: job.name, direction: job.direction, bytes: job.bytes, total: job.total, status, detail, resumable: !!job.resume && !!job.targetCreated && ['cancelled', 'error'].includes(status) } });
  },
  cancelTransfer(id) {
    const job = this.jobs?.get(id);
    if (!job || job.status !== 'running') return;
    job.controller.abort(new Error('Aktarım iptal edildi. İndirilen veya yüklenen bölüm korunur.'));
  },
  async resumeTransfer(id) {
    const job = this.jobs?.get(id);
    if (!job?.resume || !job.targetCreated || !['cancelled', 'error'].includes(job.status)) throw new Error('Bu aktarım devam ettirilemiyor.');
    job.controller = new AbortController();
    return job.resume();
  },
  async transfer(id, remote, filename, direction) {
    if (!['upload', 'download'].includes(direction)) throw new Error('Geçersiz aktarım yönü.');
    const s = this.get(id), target = this.target(s, remote), isLocal = s.profile.type === 'local';
    const remoteStat = () => isLocal ? fsp.stat(target) : call(s.sftp, 'stat', target);
    const sourceStat = () => direction === 'upload' ? fsp.stat(filename) : remoteStat();
    const destinationStat = () => direction === 'download' ? fsp.stat(filename) : remoteStat();
    const remoteRead = options => isLocal ? fs.createReadStream(target, options) : s.sftp.createReadStream(target, options);
    const sourceRead = options => direction === 'upload' ? fs.createReadStream(filename, options) : remoteRead(options);
    const destRead = options => direction === 'download' ? fs.createReadStream(filename, options) : remoteRead(options);
    const initial = snapshot(await sourceStat());
    if (isLocal) {
      const from = direction === 'upload' ? filename : target, to = direction === 'upload' ? target : filename;
      const realFrom = await fsp.realpath(from), realTo = await fsp.realpath(to).catch(() => path.resolve(to));
      if ((process.platform === 'win32' ? realFrom.toLowerCase() === realTo.toLowerCase() : realFrom === realTo)) throw new Error('Kaynak ve hedef dosya aynı olamaz.');
    }
    const job = this.beginTransfer(id, path.basename(filename), direction); job.total = initial.size;
    const execute = async (resume = false) => {
      this.reportTransfer(job, 'running', resume ? 'Devam etmek için dosyalar doğrulanıyor…' : undefined);
      try {
        this.get(id); job.controller.signal.throwIfAborted();
        const current = snapshot(await sourceStat());
        if (current.size !== initial.size || current.modified !== initial.modified) throw new Error('Kaynak dosya değişti. Aktarımı yeniden başlatın.');
        let offset = 0;
        if (resume) {
          offset = (await destinationStat()).size;
          if (offset > initial.size) throw new Error('Hedef dosya beklenenden büyük. Devam etmek için yeni bir hedef seçin.');
          if (offset > 0) {
            const range = { start: 0, end: offset - 1 };
            const hashes = await Promise.allSettled([digest(sourceRead(range), job.controller.signal), digest(destRead(range), job.controller.signal)]);
            const failure = hashes.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
            const [sourceHash, targetHash] = hashes.map(result => result.value);
            if (sourceHash !== targetHash) throw new Error('Hedefteki kısmi dosya değişmiş. Üzerine yazılmadı.');
          }
        }
        job.controller.signal.throwIfAborted(); job.bytes = offset;
        if (!resume || offset < initial.size) {
          const input = sourceRead({ start: offset });
          const options = { flags: resume ? 'r+' : direction === 'upload' ? 'wx' : 'w', start: offset };
          const output = direction === 'download' ? fs.createWriteStream(filename, options) : isLocal ? fs.createWriteStream(target, options) : s.sftp.createWriteStream(target, options);
          output.once('open', () => { job.targetCreated = true; });
          let last = 0;
          input.on('data', chunk => { job.bytes += chunk.length; if (Date.now() - last > 150) { last = Date.now(); this.reportTransfer(job, 'running'); } });
          const closing = [closed(input), closed(output)];
          try { await pipeline(input, output, { signal: job.controller.signal }); await Promise.all(closing); }
          catch (error) { await Promise.allSettled(closing); throw error; }
        }
        job.bytes = initial.size; this.reportTransfer(job, 'done');
      } catch (error) {
        const cancelled = job.controller.signal.aborted;
        this.reportTransfer(job, cancelled ? 'cancelled' : 'error', cancelled ? 'Aktarım iptal edildi' : error.message);
        throw new Error(cancelled ? 'Aktarım iptal edildi. Kısmi dosya korunur; Devam et ile sürdürebilirsiniz.' : error.message);
      }
    };
    job.resume = () => execute(true);
    return execute();
  }
};
