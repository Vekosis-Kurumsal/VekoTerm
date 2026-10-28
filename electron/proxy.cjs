const net = require('node:net');
const tls = require('node:tls');
const { domainToASCII } = require('node:url');
class Reader {
  constructor(socket) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.error = null;
    this.data = data => { this.buffer = Buffer.concat([this.buffer, data]); if (this.buffer.length > 65536) this.fail(new Error('Proxy yanıtı çok büyük.')); this.wake?.(); };
    this.fail = error => { this.error = error; this.wake?.(); };
    this.close = () => this.fail(new Error('Proxy bağlantısı kapandı.'));
    socket.on('data', this.data); socket.on('error', this.fail); socket.on('close', this.close);
  }
  async read(size) {
    if (this.error) throw this.error;
    while (this.buffer.length < size) { if (this.error) throw this.error; await new Promise(resolve => { this.wake = resolve; }); this.wake = null; }
    const value = this.buffer.subarray(0, size); this.buffer = this.buffer.subarray(size); return value;
  }
  async header() {
    while (!this.buffer.includes('\r\n\r\n')) { if (this.error) throw this.error; await new Promise(resolve => { this.wake = resolve; }); this.wake = null; }
    return (await this.read(this.buffer.indexOf('\r\n\r\n') + 4)).toString('latin1');
  }
  release() { this.socket.pause(); this.socket.off('data', this.data); this.socket.off('error', this.fail); this.socket.off('close', this.close); if (this.buffer.length) this.socket.unshift(this.buffer); }
}
function address(host) {
  if (net.isIP(host) === 4) return Buffer.from([1, ...host.split('.').map(Number)]);
  if (net.isIP(host) === 6) {
    let source = host;
    if (source.includes('.')) { const split = source.lastIndexOf(':'); const parts = source.slice(split + 1).split('.').map(Number); source = source.slice(0, split + 1) + ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16); }
    const [left, right] = source.split('::'), first = left ? left.split(':') : [], last = right ? right.split(':') : [];
    const parts = right !== undefined ? [...first, ...Array(8 - first.length - last.length).fill('0'), ...last] : first;
    const buffer = Buffer.alloc(17); buffer[0] = 4; parts.forEach((part, i) => buffer.writeUInt16BE(parseInt(part, 16), i * 2 + 1)); return buffer;
  }
  const domain = Buffer.from(domainToASCII(host)); if (!domain.length || domain.length > 255) throw new Error('Proxy için geçersiz sunucu adresi.');
  return Buffer.concat([Buffer.from([3, domain.length]), domain]);
}
async function connectProxy(proxy, host, port, password = '', timeout = 25000) {
  const socket = proxy.type === 'https' ? tls.connect({ host: proxy.host, port: proxy.port, servername: net.isIP(proxy.host) ? undefined : proxy.host }) : net.connect(proxy.port, proxy.host);
  const timer = setTimeout(() => socket.destroy(new Error('Proxy zamanında yanıt vermedi.')), timeout);
  let reader;
  try {
    await new Promise((resolve, reject) => { socket.once(proxy.type === 'https' ? 'secureConnect' : 'connect', resolve); socket.once('error', reject); socket.once('close', () => reject(new Error('Proxy bağlantısı kapandı.'))); });
    reader = new Reader(socket);
    if (proxy.type === 'socks5') {
      socket.write(proxy.username ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]));
      const greeting = await reader.read(2); if (greeting[0] !== 5 || ![0, 2].includes(greeting[1])) throw new Error('SOCKS5 proxy kimlik doğrulamayı reddetti.');
      if (greeting[1] === 2) {
        const user = Buffer.from(proxy.username || ''), secret = Buffer.from(password);
        if (!user.length || user.length > 255 || secret.length > 255) throw new Error('Proxy kullanıcı adı veya parolası geçersiz.');
        socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([secret.length]), secret]));
        const auth = await reader.read(2); if (auth[0] !== 1 || auth[1] !== 0) throw new Error('Proxy kullanıcı adı veya parolası kabul edilmedi.');
      }
      const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
      socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address(host), portBytes]));
      const response = await reader.read(4); if (response[0] !== 5 || response[1] !== 0) throw new Error(`SOCKS5 proxy hedefe bağlanamadı (${response[1]}).`);
      if (response[3] === 1) await reader.read(4); else if (response[3] === 4) await reader.read(16); else if (response[3] === 3) await reader.read((await reader.read(1))[0]); else throw new Error('Geçersiz SOCKS5 yanıtı.');
      await reader.read(2);
    } else {
      const target = `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
      const auth = proxy.username ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${password}`).toString('base64')}\r\n` : '';
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
      const header = await reader.header(); if (!/^HTTP\/1\.[01] 200\b/.test(header)) throw new Error(/^HTTP\/1\.[01] 407\b/.test(header) ? 'Proxy kullanıcı adı veya parolası kabul edilmedi.' : 'HTTP proxy hedefe bağlanamadı.');
    }
    reader.release(); clearTimeout(timer); return socket;
  } catch (error) { clearTimeout(timer); reader?.release(); socket.destroy(); throw error; }
}
module.exports = { connectProxy, Reader, address };
