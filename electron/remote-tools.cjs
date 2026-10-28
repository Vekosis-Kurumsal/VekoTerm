const os = require('node:os');
const monitorCommand = "LC_ALL=C; printf '__CPU__\\n'; head -n 1 /proc/stat; printf '__MEM__\\n'; cat /proc/meminfo; printf '__NET__\\n'; cat /proc/net/dev; printf '__UP__\\n'; cat /proc/uptime; printf '__DISK__\\n'; df -Pk / /boot 2>/dev/null; printf '__END__\\n'";
function cpuState(line) {
  const ticks = line.trim().split(/\s+/).slice(1).map(Number);
  return { total: ticks.slice(0, 8).reduce((a,b) => a+b, 0), idle: (ticks[3] || 0) + (ticks[4] || 0) };
}
function parseMonitor(text, previous) {
  const section = name => text.split(`__${name}__\n`)[1]?.split(/__[A-Z]+__\n/)[0] || '';
  const cpu = cpuState(section('CPU')), mem = Object.fromEntries([...section('MEM').matchAll(/^(\w+):\s+(\d+)/gm)].map(m => [m[1], Number(m[2]) * 1024]));
  if (!cpu.total || !mem.MemTotal) throw new Error('Bu sunucuda Linux sistem bilgileri okunamıyor.');
  let rx = 0, tx = 0;
  for (const line of section('NET').split('\n')) { const [device, data] = line.split(':'); if (!data || device.trim() === 'lo') continue; const values = data.trim().split(/\s+/).map(Number); rx += values[0] || 0; tx += values[8] || 0; }
  const time = Date.now(), seconds = previous ? Math.max(.1, (time - previous.time) / 1000) : 1;
  const percent = previous && cpu.total > previous.cpu.total ? Math.max(0, Math.min(100, 100 * (1 - (cpu.idle - previous.cpu.idle) / (cpu.total - previous.cpu.total)))) : null;
  const disks = section('DISK').split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(row => row.length >= 6).map(row => ({ mount: row.at(-1), percent: parseInt(row[4]), used: Number(row[2]) * 1024, total: Number(row[1]) * 1024 }));
  return { cpu: percent, memoryUsed: mem.MemTotal - (mem.MemAvailable ?? mem.MemFree ?? 0), memoryTotal: mem.MemTotal, swapUsed: (mem.SwapTotal || 0) - (mem.SwapFree || 0), swapTotal: mem.SwapTotal || 0, rx: previous ? Math.max(0, (rx - previous.rx) / seconds) : 0, tx: previous ? Math.max(0, (tx - previous.tx) / seconds) : 0, uptime: Number(section('UP').trim().split(/\s/)[0]) || 0, disks, sample: { cpu, rx, tx, time } };
}
const methods = {
  async execReadOnly(id, command, timeout = 7000) {
    const s = this.get(id); if (!s.client || s.status !== 'connected') throw new Error('Önce SSH bağlantısı açın.');
    return new Promise((resolve, reject) => {
      s.client.exec(command, (error, stream) => {
        if (error) { reject(error); return; }
        let text = '', done = false;
        const timer = setTimeout(() => finish(new Error('Sunucu zamanında yanıt vermedi.')), timeout);
        const finish = error => { if (done) return; done = true; clearTimeout(timer); s.resources = s.resources.filter(r => r !== stream); stream.destroy(); error ? reject(error) : resolve(text); };
        s.resources.push(stream);
        stream.on('data', data => { text += data.toString(); if (text.length > 256 * 1024) finish(new Error('Sunucu çıktısı çok büyük.')); });
        stream.on('error', finish); stream.on('close', code => finish(code ? new Error('Sunucu bu sistem sorgusunu desteklemiyor.') : undefined));
      });
    });
  },
  async monitor(id) {
    const s = this.get(id);
    if (s.profile.type === 'local') return { cpu: null, memoryUsed: os.totalmem() - os.freemem(), memoryTotal: os.totalmem(), swapUsed: 0, swapTotal: 0, rx: 0, tx: 0, uptime: os.uptime(), disks: [] };
    if (s.monitorBusy) return s.monitorBusy;
    s.monitorBusy = this.execReadOnly(id, monitorCommand).then(text => { const result = parseMonitor(text, s.monitorSample); s.monitorSample = result.sample; const { sample, ...publicResult } = result; return publicResult; }).finally(() => { s.monitorBusy = null; });
    return s.monitorBusy;
  },
  async currentDirectory(id) {
    const s = this.get(id);
    if (s.cwd) return s.cwd;
    // Read-only /proc lookup is a fallback for shells that do not publish OSC 7.
    // sshd's sibling session shell is the interactive terminal for this connection.
    if (s.profile.type === 'ssh') {
      const output = await this.execReadOnly(id, "for p in /proc/[0-9]*/stat; do IFS=' ' read -r pid comm state ppid rest < \"$p\" 2>/dev/null || continue; if [ \"$ppid\" = \"$PPID\" ] && [ \"$pid\" != \"$$\" ]; then case \"$comm\" in \"(bash)\"|\"(sh)\"|\"(zsh)\"|\"(fish)\"|\"(ksh)\") ;; *) continue ;; esac; readlink \"/proc/$pid/cwd\" 2>/dev/null && break; fi; done");
      const value = output.trim(); if (value.startsWith('/') && !value.includes('\n')) return value;
    }
    return s.home;
  }
};
module.exports = { methods, parseMonitor };
