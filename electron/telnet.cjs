const net = require('node:net');
const IAC = 255, WILL = 251, WONT = 252, DO = 253, DONT = 254, SB = 250, SE = 240;
const BINARY = 0, ECHO = 1, SGA = 3, TTYPE = 24, NAWS = 31;
class TelnetCodec {
  constructor(send, output) { this.send = send; this.output = output; this.state = 'data'; this.remote = new Set(); this.local = new Set(); this.refusedRemote = new Set(); this.refusedLocal = new Set(); this.cols = 100; this.rows = 28; this.sub = []; }
  escape(data) { const bytes = []; for (const b of data) { bytes.push(b); if (b === IAC) bytes.push(IAC); } return Buffer.from(bytes); }
  negotiate(command, option) {
    if (command === WILL) {
      if ([BINARY, ECHO, SGA].includes(option)) { if (!this.remote.has(option)) { this.remote.add(option); this.send(Buffer.from([IAC, DO, option])); } }
      else if (!this.refusedRemote.has(option)) { this.refusedRemote.add(option); this.send(Buffer.from([IAC, DONT, option])); }
    } else if (command === WONT) { this.refusedRemote.delete(option); if (this.remote.delete(option)) this.send(Buffer.from([IAC, DONT, option])); }
    else if (command === DO) {
      if ([BINARY, SGA, TTYPE, NAWS].includes(option)) { if (!this.local.has(option)) { this.local.add(option); this.send(Buffer.from([IAC, WILL, option])); if (option === NAWS) this.resize(this.cols, this.rows); } }
      else if (!this.refusedLocal.has(option)) { this.refusedLocal.add(option); this.send(Buffer.from([IAC, WONT, option])); }
    } else if (command === DONT) { this.refusedLocal.delete(option); if (this.local.delete(option)) this.send(Buffer.from([IAC, WONT, option])); }
  }
  feed(data) {
    const visible = [];
    for (const byte of data) {
      if (this.state === 'data') { if (byte === IAC) this.state = 'iac'; else if (!(byte === 0 && this.lastCR && !this.remote.has(BINARY))) { visible.push(byte); this.lastCR = byte === 13; } else this.lastCR = false; }
      else if (this.state === 'iac') { if (byte === IAC) { visible.push(IAC); this.state = 'data'; } else if ([WILL, WONT, DO, DONT].includes(byte)) { this.command = byte; this.state = 'option'; } else if (byte === SB) { this.sub = []; this.state = 'sub'; } else this.state = 'data'; }
      else if (this.state === 'option') { this.negotiate(this.command, byte); this.state = 'data'; }
      else if (this.state === 'sub') { if (byte === IAC) this.state = 'subIac'; else if (this.sub.length < 4096) this.sub.push(byte); }
      else if (this.state === 'subIac') {
        if (byte === SE) { if (this.sub[0] === TTYPE && this.sub[1] === 1 && this.local.has(TTYPE)) this.send(Buffer.concat([Buffer.from([IAC, SB, TTYPE, 0]), Buffer.from('xterm-256color'), Buffer.from([IAC, SE])])); this.state = 'data'; }
        else { if (byte === IAC && this.sub.length < 4096) this.sub.push(IAC); this.state = 'sub'; }
      }
    }
    if (visible.length) this.output(Buffer.from(visible));
  }
  write(text) {
    if (!this.remote.has(ECHO)) this.output(Buffer.from(text.replace(/\r(?!\n)/g, '\r\n')));
    const data = Buffer.from(this.local.has(BINARY) ? text : text.replace(/\r(?!\n)/g, '\r\n'));
    this.send(this.escape(data));
  }
  resize(cols, rows) { this.cols = cols; this.rows = rows; if (this.local.has(NAWS)) { const size = Buffer.alloc(4); size.writeUInt16BE(cols, 0); size.writeUInt16BE(rows, 2); this.send(Buffer.concat([Buffer.from([IAC, SB, NAWS]), this.escape(size), Buffer.from([IAC, SE])])); } }
}
async function openTelnet(s) {
  const socket = net.connect(s.profile.port, s.profile.host); s.resources.push(socket);
  const codec = new TelnetCodec(bytes => { if (!socket.destroyed) socket.write(bytes); }, bytes => this.output(s, bytes));
  s.stream = { write: data => codec.write(data), setWindow: (rows, cols) => codec.resize(cols, rows) };
  socket.on('data', data => codec.feed(data)); socket.on('end', () => this.close(s.id));
  socket.on('error', error => { if (s.status === 'connected') { s.status = 'error'; this.output(s, `\r\n${error.message}\r\n`); this.emitState(s); } });
  socket.on('close', () => { if (this.items.get(s.id) === s && s.status === 'connected') { s.status = 'closed'; this.emitState(s); } });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.destroy(); reject(new Error('Telnet bağlantısı zaman aşımına uğradı.')); }, (s.profile.connectTimeout || 25) * 1000); const done = fn => value => { clearTimeout(timer); fn(value); }; socket.once('connect', done(resolve)); socket.once('error', done(reject)); socket.once('close', done(() => reject(new Error('Telnet bağlantısı kapandı.')))); });
}
module.exports = { TelnetCodec, openTelnet };
