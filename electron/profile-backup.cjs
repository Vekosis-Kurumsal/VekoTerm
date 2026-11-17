const { randomBytes, scrypt, createCipheriv, createDecipheriv } = require('node:crypto');
const { promisify } = require('node:util');
const { cleanProfile } = require('./store.cjs');
const { parseImport } = require('./import-profiles.cjs');

const derive = promisify(scrypt);
const FORMAT = 'vekoterm-connection-backup';
const AAD = Buffer.from(FORMAT + ':1');
const MAX_FILE = 4 * 1024 * 1024;
const MAX_PAYLOAD = 2 * 1024 * 1024;
function passwordKey(password, salt) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 4096) throw new Error('Yedek parolası 8–4096 karakter olmalı.');
  return derive(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function unlocked(store) { if (store.locked) throw new Error('Önce uygulamanın kilidini açın.'); }

async function exportConnections(store, options = {}) {
  unlocked(store);
  const data = { version: 1, folders: store.folders(), profiles: store.list().map(cleanProfile) };
  if (data.profiles.length > 5000 || data.folders.length > 5000) throw new Error('Tek yedekte en fazla 5000 bağlantı ve klasör olabilir.');
  if (!options.encrypted) {
    const text = JSON.stringify(data, null, 2);
    if (Buffer.byteLength(text) > MAX_PAYLOAD) throw new Error('Bağlantı yedeği çok büyük.');
    return text;
  }
  const salt = randomBytes(16), key = await passwordKey(options.password, salt);
  let clear;
  try {
    unlocked(store);
    data.passwords = {};
    const unreadable = [];
    for (const profile of data.profiles) {
      if (!store.data.secrets[profile.id]) continue;
      try { data.passwords[profile.id] = store.secret(profile.id); }
      catch { unreadable.push(`“${profile.name}”`); }
    }
    if (unreadable.length) throw new Error(`Şu bağlantıların kayıtlı parolası bu Windows hesabında açılamıyor: ${unreadable.join(', ')}. Yedek oluşturulmadı. Bu bağlantıları düzenleyip parolayı yeniden kaydedin ya da “Bu oturumun kayıtlı parolasını sil” ile temizleyin.`);
    clear = Buffer.from(JSON.stringify(data));
    if (clear.length > MAX_PAYLOAD) throw new Error('Bağlantı yedeği çok büyük.');
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const content = Buffer.concat([cipher.update(clear), cipher.final()]);
    return JSON.stringify({ format: FORMAT, version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), content: content.toString('base64') });
  } finally { key.fill(0); clear?.fill(0); }
}

async function readConnections(buffer, filename, options = {}) {
  if (buffer.length > MAX_FILE) throw new Error('Bağlantı dosyası çok büyük.');
  if (!options.encrypted) {
    return { ...parseImport(buffer, filename), secretCount: 0 };
  }
  let key, clear;
  try {
    const envelope = JSON.parse(buffer.toString('utf8'));
    if (envelope.format !== FORMAT || envelope.version !== 1) throw new Error('Format');
    const decode = (name, length) => {
      const value = envelope[name];
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Encoding');
      const bytes = Buffer.from(value, 'base64');
      if (bytes.toString('base64') !== value || (length && bytes.length !== length)) throw new Error('Encoding');
      return bytes;
    };
    const salt = decode('salt', 16), iv = decode('iv', 12), tag = decode('tag', 16), content = decode('content');
    if (content.length > MAX_PAYLOAD) throw new Error('Size');
    key = await passwordKey(options.password, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(content), decipher.final()]);
    const original = JSON.parse(clear.toString('utf8'));
    if (!original.passwords || typeof original.passwords !== 'object' || Array.isArray(original.passwords)) throw new Error('Passwords');
    const data = parseImport(clear, 'VekoTerm-baglantilar.json');
    let secretCount = 0;
    data.profiles.forEach((profile, index) => {
      const id = original.profiles[index].id;
      if (Object.hasOwn(original.passwords, id)) {
        const password = original.passwords[id];
        if (typeof password !== 'string' || password.length > 65536) throw new Error('Password');
        if (password) { profile.password = password; profile.remember = true; secretCount++; }
      }
    });
    return { ...data, secretCount };
  } catch { throw new Error('Yedek parolası yanlış veya şifreli yedek dosyası geçersiz.'); }
  finally { key?.fill(0); clear?.fill(0); }
}

module.exports = { exportConnections, readConnections, MAX_FILE };
