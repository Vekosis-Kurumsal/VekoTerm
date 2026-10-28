const fs = require('node:fs/promises');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { createHash } = require('node:crypto');
const { utils } = require('ssh2');

function keyInfo(data, passphrase) {
  const result = utils.parseKey(data, passphrase); if (result instanceof Error) throw new Error('Anahtar okunamadı. Dosyayı ve anahtar parolasını kontrol edin.');
  const key = Array.isArray(result) ? result[0] : result;
  if (!key) throw new Error('SSH anahtarı bulunamadı.');
  return { type: key.type, fingerprint: 'SHA256:' + createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, ''), publicKey: `${key.type} ${key.getPublicSSH().toString('base64')}${key.comment ? ' ' + key.comment : ''}` };
}
async function generateKey(filename, input) {
  if (!input || !['ed25519', 'rsa', 'ecdsa'].includes(input.type)) throw new Error('Geçerli bir anahtar türü seçin.');
  const passphrase = String(input.passphrase || ''); if (passphrase.length > 4096) throw new Error('Anahtar parolası çok uzun.');
  const comment = String(input.comment || 'VekoTerm').replace(/[\r\n\0]/g, ' ').slice(0, 200);
  const options = { bits: 4096, comment, format: 'new', ...(input.type === 'ecdsa' ? { bits: 256 } : {}), ...(passphrase ? { passphrase, cipher: 'aes256-ctr', rounds: 32 } : {}) };
  const keys = await new Promise((resolve, reject) => utils.generateKeyPair(input.type, options, (e, k) => e ? reject(e) : resolve(k)));
  // Validate the generated pair before creating any files. A generator/parser
  // failure must not leave a key on disk that the application cannot use.
  const info = keyInfo(keys.private, passphrase);
  if (info.fingerprint !== keyInfo(keys.public).fingerprint) throw new Error('Üretilen açık ve özel anahtar eşleşmiyor. Dosya oluşturulmadı.');
  const privateFile = await fs.open(filename, 'wx', 0o600); let publicFile;
  try { publicFile = await fs.open(filename + '.pub', 'wx', 0o644); await privateFile.writeFile(keys.private + '\n'); await publicFile.writeFile(keys.public + '\n'); }
  catch (error) { await privateFile.close(); await fs.unlink(filename).catch(() => {}); if (publicFile) { await publicFile.close(); await fs.unlink(filename + '.pub').catch(() => {}); } throw error; }
  await privateFile.close(); await publicFile.close();
  return { path: filename, ...info };
}
function cleanHost(value) { const host = String(value || '').trim(); if (!host || host.length > 253 || /[\s\x00-\x1f/\\]/.test(host) || host.startsWith('-')) throw new Error('Geçerli bir sunucu veya IP adresi yazın.'); return host; }
async function portCheck(host, port, timeout = 4000) {
  host = cleanHost(host); port = Number(port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port 1–65535 arasında olmalı.');
  const started = performance.now();
  return new Promise(resolve => { const socket = net.connect(port, host); const done = (open, error) => { socket.destroy(); resolve({ open, ms: Math.round(performance.now() - started), error }); }; socket.once('connect', () => done(true)); socket.once('error', e => done(false, e.code)); socket.setTimeout(timeout, () => done(false, 'TIMEOUT')); });
}
async function networkTool(input) {
  const host = cleanHost(input?.host);
  if (input.kind === 'dns') { const records = await dns.lookup(host, { all: true }); return records.map(r => `IPv${r.family}  ${r.address}`).join('\n'); }
  if (input.kind === 'port') { const result = await portCheck(host, input.port); return `${host}:${input.port}\n${result.open ? 'Port açık' : 'Bağlantı kurulamadı'} · ${result.ms} ms${result.error ? '\n' + result.error : ''}`; }
  const win = process.platform === 'win32';
  if (!['ping', 'trace'].includes(input.kind)) throw new Error('Geçerli bir ağ aracı seçin.');
  const name = input.kind === 'ping' ? 'ping' : win ? 'tracert' : 'traceroute';
  const args = input.kind === 'ping' ? (win ? ['-n', '4', '-w', '1500', host] : ['-c', '4', host]) : win ? ['-d', '-h', '15', '-w', '500', host] : ['-n', '-m', '15', '-w', '1', host];
  const exe = win ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', name + '.exe') : name;
  return new Promise((resolve, reject) => execFile(exe, args, { windowsHide: true, timeout: 25000, maxBuffer: 256 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => { if (error?.code === 'ENOENT') reject(new Error('Bu ağ aracı sistemde kurulu değil.')); else resolve(stdout + (stderr ? '\n' + stderr : '') + (error?.killed ? '\nİşlem süre sınırında durduruldu.' : '')); }));
}
module.exports = { generateKey, keyInfo, cleanHost, portCheck, networkTool };
