function cleanSerial(input = {}) {
  const name = String(input.path || '').trim();
  if (!/^COM\d{1,4}$/i.test(name) && !/^\/dev\/(?:tty|cu)[\w.\/-]+$/.test(name)) throw new Error('Geçerli bir seri port seçin.');
  const baudRate = Number(input.baudRate || 115200); if (!Number.isInteger(baudRate) || baudRate < 50 || baudRate > 4000000) throw new Error('Baud hızı 50–4000000 arasında olmalı.');
  return { path: name, baudRate, dataBits: [5,6,7,8].includes(Number(input.dataBits)) ? Number(input.dataBits) : 8, stopBits: [1,1.5,2].includes(Number(input.stopBits)) ? Number(input.stopBits) : 1, parity: ['none','even','odd','mark','space'].includes(input.parity) ? input.parity : 'none', rtscts: !!input.rtscts, xonxoff: !!input.xonxoff, lineEnding: ['cr','lf','crlf'].includes(input.lineEnding) ? input.lineEnding : 'cr', localEcho: !!input.localEcho };
}
async function openSerial(s) {
  const SerialPort = this.options.SerialPort || require('serialport').SerialPort, config = cleanSerial(s.profile.serial);
  const { localEcho, lineEnding, xonxoff, ...options } = config, port = new SerialPort({ ...options, xon: xonxoff, xoff: xonxoff, autoOpen: false });
  s.serial = port; s.resources.push({ close: () => { if (port.isOpen) port.close(() => {}); } });
  port.on('data', data => this.output(s, data));
  port.on('error', error => { if (s.status === 'connected') { s.status = 'error'; this.output(s, `\r\n${error.message}\r\n`); this.emitState(s); } });
  port.on('close', () => { if (this.items.get(s.id) === s && s.status === 'connected') { s.status = 'closed'; this.emitState(s); } });
  s.stream = { write: data => { const value = data.replace(/\r\n|\r/g, { cr: '\r', lf: '\n', crlf: '\r\n' }[lineEnding]); port.write(value, error => { if (error) this.output(s, `\r\n${error.message}\r\n`); }); if (localEcho) this.output(s, value.replace(/\r(?!\n)/g, '\r\n')); } };
  await new Promise((resolve, reject) => port.open(error => error ? reject(error) : resolve()));
  if (this.items.get(s.id) !== s) { port.close(() => {}); throw new Error('Seri bağlantı iptal edildi.'); }
}
module.exports = { cleanSerial, openSerial };
