const net = require('node:net');
const { randomUUID } = require('node:crypto');
const { Reader } = require('./proxy.cjs');
const validHost = host => typeof host === 'string' && host && !/[\s\x00-\x1f/\\]/.test(host);
function cleanTunnel(input) {
  const kind = ['local', 'remote', 'dynamic'].includes(input?.kind) ? input.kind : 'local';
  const port = Number(input?.listenPort), targetPort = Number(input?.targetPort || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error('Geçerli port numaraları girin.');
  const host = input?.targetHost || '127.0.0.1'; if (!validHost(host)) throw new Error('Geçerli hedef adresi girin.');
  return { id: /^[a-z0-9-]{1,80}$/i.test(input?.id || '') ? input.id : randomUUID(), name: String(input?.name || `${kind} :${port}`).slice(0, 100), profileId: String(input?.profileId || ''), kind, listenPort: port, targetHost: host, targetPort };
}
function pipe(a, b, sockets) {
  if (a.destroyed || b.destroyed) { a.destroy(); b.destroy(); return; }
  sockets.add(a); sockets.add(b);
  const done = () => { sockets.delete(a); sockets.delete(b); a.destroy(); b.destroy(); };
  a.on('error', done); b.on('error', done); a.on('close', done); b.on('close', done); a.pipe(b).pipe(a);
}
const methods = {
  tunnelList() { return [...(this.tunnelItems?.values() || [])].map(({ config, sessionId, status }) => ({ ...config, sessionId, status })); },
  async startTunnel(sessionId, input) {
    this.tunnelItems ||= new Map();
    const config = cleanTunnel(input), s = this.get(sessionId);
    if (!s.client || s.status !== 'connected') throw new Error('Tünel için açık bir SSH bağlantısı seçin.');
    if (this.tunnelItems.get(config.id)?.status === 'running') throw new Error('Bu tünel zaten çalışıyor.');
    const record = { config, sessionId, status: 'starting', sockets: new Set(), owned: false }; this.tunnelItems.set(config.id, record);
    const outgoing = (host, port) => new Promise((resolve, reject) => s.client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => error ? reject(error) : resolve(channel)));
    try {
      if (config.kind === 'remote') {
        record.listener = (info, accept, reject) => {
          if (info.destIP !== '127.0.0.1' || info.destPort !== config.listenPort) return;
          const socket = net.connect(config.targetPort, config.targetHost); record.sockets.add(socket);
          socket.once('connect', () => pipe(socket, accept(), record.sockets)); socket.once('error', () => { reject(); socket.destroy(); });
        };
        s.client.on('tcp connection', record.listener);
        await new Promise((resolve, reject) => s.client.forwardIn('127.0.0.1', config.listenPort, error => error ? reject(error) : resolve()));
      } else {
        record.server = net.createServer(socket => {
          record.sockets.add(socket); socket.on('error', () => socket.destroy()); socket.on('close', () => record.sockets.delete(socket));
          if (config.kind === 'local') outgoing(config.targetHost, config.targetPort).then(channel => pipe(socket, channel, record.sockets)).catch(() => socket.destroy());
          else {
            const reader = new Reader(socket); const timer = setTimeout(() => socket.destroy(), 15000);
            (async () => {
              const greeting = await reader.read(2); if (greeting[0] !== 5 || !(await reader.read(greeting[1])).includes(0)) { socket.end(Buffer.from([5, 255])); return; }
              socket.write(Buffer.from([5, 0]));
              const request = await reader.read(4); if (request[0] !== 5 || request[1] !== 1 || request[2] !== 0) throw new Error('Yalnız SOCKS5 TCP bağlantıları desteklenir.');
              let host;
              if (request[3] === 1) host = [...await reader.read(4)].join('.');
              else if (request[3] === 3) host = (await reader.read((await reader.read(1))[0])).toString();
              else if (request[3] === 4) { const value = await reader.read(16); host = Array.from({ length: 8 }, (_, i) => value.readUInt16BE(i * 2).toString(16)).join(':'); }
              else throw new Error('Geçersiz SOCKS5 hedefi.');
              const port = (await reader.read(2)).readUInt16BE(); if (!validHost(host) || !port) throw new Error('Geçersiz SOCKS5 hedefi.');
              const channel = await outgoing(host, port); reader.release(); clearTimeout(timer);
              socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])); pipe(socket, channel, record.sockets);
            })().catch(() => { if (!socket.destroyed) socket.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0])); }).finally(() => clearTimeout(timer));
          }
        });
        record.server.on('error', () => {});
        await new Promise((resolve, reject) => { record.server.once('error', reject); record.server.listen(config.listenPort, '127.0.0.1', resolve); });
      }
      record.status = 'running'; s.resources.push({ destroy: () => { void this.stopTunnel(config.id).catch(() => {}); } });
      return { ...config, sessionId, status: record.status };
    } catch (error) { await this.stopTunnel(config.id); throw error; }
  },
  async stopTunnel(id) {
    const record = this.tunnelItems?.get(id); if (!record) return;
    this.tunnelItems.delete(id); record.status = 'closed';
    for (const socket of record.sockets) socket.destroy(); record.sockets.clear(); record.server?.close();
    const s = this.items.get(record.sessionId);
    if (record.listener && s?.client) {
      s.client.off('tcp connection', record.listener);
      if (s.status === 'connected') await new Promise(resolve => s.client.unforwardIn('127.0.0.1', record.config.listenPort, () => resolve()));
    }
    if (record.owned && ![...this.tunnelItems.values()].some(t => t.sessionId === record.sessionId)) this.close(record.sessionId);
  },
  async startSavedTunnel(id) {
    const config = this.store.data.tunnels?.find(t => t.id === id); if (!config) throw new Error('Kayıtlı tünel bulunamadı.');
    const profile = this.store.list().find(p => p.id === config.profileId); if (!profile) throw new Error('Tünelin SSH bağlantısı bulunamadı.');
    const existing = [...this.items.values()].find(s => s.profile.id === profile.id && s.status === 'connected' && s.client);
    let session = existing, owned = false;
    if (!session) {
      let password = '';
      if (profile.auth === 'password' && !profile.hasSecret) {
        if (!this.options.promptAuth) throw new Error('Önce SSH oturumunu açın.');
        password = (await this.options.promptAuth('', `${profile.name} · Tünel`, [{ prompt: 'SSH parolası', echo: false }]))[0];
      }
      const opened = await this.open({ ...profile, type: 'sftp', x11: false, password, name: `${profile.name} · Tünel` }, { hidden: true }); session = this.get(opened.id); owned = true;
    }
    try { const result = await this.startTunnel(session.id, config); this.tunnelItems.get(config.id).owned = owned || session.hidden; return result; }
    catch (error) { if (owned) this.close(session.id); throw error; }
  }
};
module.exports = { methods, cleanTunnel };
