// Server operations over the SSH connection: systemd services and their journal, processes, Docker containers.
// Every name or number that goes into a command is checked against a strict pattern first. Commands that change
// something run as root directly, or through "sudo -n" (never waits for a password); when sudo wants a password the
// caller is told so and the command can be typed into the terminal instead.
const SERVICE = /^[A-Za-z0-9@._:\\-]{1,200}\.service$/;
const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
// Runs as root directly, otherwise through sudo without waiting for a password.
const elevated = command => `if [ "$(id -u)" = 0 ]; then ${command}; else sudo -n ${command}; fi`;
const SUDO_PASSWORD = /a password is required|a terminal is required|sudo: .*password|no tty present|parola gerekli/i;

function parseServices(text) {
  return text.split('\n').map(line => line.trim().replace(/^[●*]\s*/, '')).filter(Boolean).map(line => {
    const [unit, load, active, sub, ...description] = line.split(/\s+/);
    return { unit, load, active, sub, description: description.join(' ') };
  }).filter(s => SERVICE.test(s.unit || ''));
}
function parseProcesses(text) {
  return text.split('\n').map(line => line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, user, cpu, mem, rss, elapsed, command]) => ({ pid: Number(pid), user, cpu: Number(cpu), mem: Number(mem), rss: Number(rss) * 1024, elapsed, command }));
}
function parseContainers(text, statsText) {
  const stats = new Map();
  for (const line of statsText.split('\n')) { try { const s = JSON.parse(line); stats.set(s.ID, s); stats.set(s.Name, s); } catch {} }
  const rows = [];
  for (const line of text.split('\n')) {
    let c; try { c = JSON.parse(line); } catch { continue; }
    const name = String(c.Names || '').split(',')[0], s = stats.get(String(c.ID).slice(0, 12)) || stats.get(c.ID) || stats.get(name) || {};
    rows.push({ id: String(c.ID).slice(0, 12), name, image: c.Image || '', state: c.State || '', status: c.Status || '', ports: c.Ports || '', cpu: s.CPUPerc || '', memory: s.MemUsage || '' });
  }
  return rows;
}

const methods = {
  // Runs a command and returns its output and exit code; output is capped so a huge log cannot flood the app.
  async execOps(id, command, timeout = 15000) {
    const s = this.get(id);
    if (!s.client || s.status !== 'connected' || !['ssh', 'sftp'].includes(s.profile.type)) throw new Error('Sunucu işlemleri için açık bir SSH bağlantısı seçin.');
    return new Promise((resolve, reject) => {
      s.client.exec(command, (error, stream) => {
        if (error) { reject(error); return; }
        let out = '', done = false;
        const timer = setTimeout(() => finish(null, new Error('Sunucu zamanında yanıt vermedi.')), timeout);
        const finish = (code, failure) => { if (done) return; done = true; clearTimeout(timer); s.resources = s.resources.filter(r => r !== stream); stream.destroy(); failure ? reject(failure) : resolve({ code: code ?? 0, out }); };
        s.resources.push(stream);
        const add = data => { out += data.toString(); if (out.length > 1024 * 1024) { out = out.slice(-1024 * 1024); } };
        stream.on('data', add); stream.stderr.on('data', add);
        stream.on('error', e => finish(null, e)); stream.on('close', code => finish(code));
      });
    });
  },
  opsError(result, what) {
    const text = result.out.trim();
    if (SUDO_PASSWORD.test(text)) return Object.assign(new Error(`${what} yönetici yetkisi istiyor ve sudo parola soruyor. “Terminalde sudo ile çalıştır” ile komutu terminale yazabilirsiniz.`), { code: 'SUDO_PASSWORD' });
    return new Error(`${what} yapılamadı${text ? ': ' + text.split('\n').slice(-3).join(' ').slice(0, 400) : '.'}`);
  },
  async opsServices(id) {
    const result = await this.execOps(id, 'LC_ALL=C systemctl list-units --type=service --all --no-pager --plain --no-legend 2>&1');
    if (result.code && !result.out.trim()) throw new Error('Bu sunucuda systemd servisleri okunamadı.');
    if (/command not found|not found|systemd.*not.*running|System has not been booted with systemd/i.test(result.out) && !parseServices(result.out).length) throw new Error('Bu sunucu systemd kullanmıyor.');
    return parseServices(result.out);
  },
  async opsServiceLog(id, unit, lines = 200) {
    if (!SERVICE.test(unit)) throw new Error('Geçersiz servis adı.');
    const count = Math.max(20, Math.min(2000, Number(lines) || 200));
    let result = await this.execOps(id, `LC_ALL=C journalctl -u ${quote(unit)} -n ${count} --no-pager -o short-iso 2>&1`);
    if (/insufficient permissions|Permission denied|No journal files were opened/i.test(result.out)) result = await this.execOps(id, `LC_ALL=C ${elevated(`journalctl -u ${quote(unit)} -n ${count} --no-pager -o short-iso`)} 2>&1`);
    if (result.code && SUDO_PASSWORD.test(result.out)) throw this.opsError(result, 'Günlüğü okumak');
    return result.out;
  },
  async opsServiceAction(id, unit, action) {
    if (!SERVICE.test(unit)) throw new Error('Geçersiz servis adı.');
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Geçersiz servis işlemi.');
    const result = await this.execOps(id, `LC_ALL=C ${elevated(`systemctl ${action} ${quote(unit)}`)} 2>&1`, 60000);
    if (result.code) throw this.opsError(result, `${unit} ${({ start: 'başlatma', stop: 'durdurma', restart: 'yeniden başlatma' })[action]}`);
    return true;
  },
  async opsProcesses(id) {
    const result = await this.execOps(id, 'LC_ALL=C ps -eo pid=,user=,pcpu=,pmem=,rss=,etime=,args= --sort=-pcpu 2>&1 | head -n 200');
    const rows = parseProcesses(result.out);
    if (!rows.length) throw new Error('Süreç listesi okunamadı.');
    return rows;
  },
  async opsKill(id, pid, force = false) {
    if (!Number.isInteger(pid) || pid < 2) throw new Error('Geçersiz süreç numarası.');
    const signal = force ? 'KILL' : 'TERM';
    let result = await this.execOps(id, `LC_ALL=C kill -s ${signal} ${pid} 2>&1`);
    if (result.code && /Operation not permitted|not permitted/i.test(result.out)) result = await this.execOps(id, `LC_ALL=C ${elevated(`kill -s ${signal} ${pid}`)} 2>&1`);
    if (result.code) throw this.opsError(result, `${pid} numaralı süreci sonlandırma`);
    return true;
  },
  async opsDocker(id) {
    const list = 'docker ps -a --no-trunc --format "{{json .}}"', stats = 'docker stats --no-stream --format "{{json .}}"';
    let result = await this.execOps(id, `LC_ALL=C ${list} 2>&1`);
    if (/command not found|not found/i.test(result.out) && result.code) throw Object.assign(new Error('Bu sunucuda Docker bulunamadı.'), { code: 'NO_DOCKER' });
    let sudo = false;
    if (result.code && /permission denied/i.test(result.out)) { result = await this.execOps(id, `LC_ALL=C ${elevated(list)} 2>&1`); sudo = true; }
    if (result.code) throw this.opsError(result, 'Docker konteynerlerini okumak');
    const statsResult = await this.execOps(id, `LC_ALL=C ${sudo ? elevated(stats) : stats} 2>/dev/null`, 20000).catch(() => ({ out: '' }));
    return parseContainers(result.out, statsResult.out);
  },
  async opsDockerAction(id, container, action) {
    if (!CONTAINER.test(container)) throw new Error('Geçersiz konteyner adı.');
    if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Geçersiz konteyner işlemi.');
    let result = await this.execOps(id, `LC_ALL=C docker ${action} ${quote(container)} 2>&1`, 90000);
    if (result.code && /permission denied/i.test(result.out)) result = await this.execOps(id, `LC_ALL=C ${elevated(`docker ${action} ${quote(container)}`)} 2>&1`, 90000);
    if (result.code) throw this.opsError(result, `${container} konteynerini ${({ start: 'başlatma', stop: 'durdurma', restart: 'yeniden başlatma' })[action]}`);
    return true;
  },
  async opsDockerLogs(id, container, lines = 200) {
    if (!CONTAINER.test(container)) throw new Error('Geçersiz konteyner adı.');
    const count = Math.max(20, Math.min(2000, Number(lines) || 200));
    let result = await this.execOps(id, `LC_ALL=C docker logs --tail ${count} ${quote(container)} 2>&1`);
    if (result.code && /permission denied/i.test(result.out)) result = await this.execOps(id, `LC_ALL=C ${elevated(`docker logs --tail ${count} ${quote(container)}`)} 2>&1`);
    if (result.code) throw this.opsError(result, 'Konteyner günlüğünü okumak');
    return result.out;
  }
};

module.exports = { methods, parseServices, parseProcesses, parseContainers, SERVICE, CONTAINER };
