const { randomBytes, scryptSync, createCipheriv, createDecipheriv } = require('node:crypto');
const aad = Buffer.from('VekoTerm settings vault v1');
function derive(password, salt) {
  if (typeof password !== 'string' || password.length > 4096) throw new Error('Ana parola geçersiz.');
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function create(password) { if (typeof password !== 'string' || password.length < 8) throw new Error('Ana parola en az 8 karakter olmalı.'); const salt = randomBytes(16); return { key: derive(password, salt), salt }; }
function seal(data, vault) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', vault.key, iv); cipher.setAAD(aad);
  const content = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { format: 'vekoterm-vault', version: 1, salt: vault.salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), content: content.toString('base64') };
}
function unseal(envelope, password) {
  let key;
  try {
    if (envelope.version !== 1) throw new Error('Version');
    const salt = Buffer.from(envelope.salt, 'base64'), iv = Buffer.from(envelope.iv, 'base64'), tag = Buffer.from(envelope.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('Envelope');
    key = derive(password, salt); const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(aad); decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.content, 'base64')), decipher.final()]).toString('utf8');
    const data = JSON.parse(text); if (!data || !Array.isArray(data.profiles) || !data.preferences) throw new Error('Data');
    return { data, key, salt };
  } catch { key?.fill(0); throw new Error('Ana parola yanlış veya şifreli kayıt dosyası bozulmuş.'); }
}
module.exports = { create, seal, unseal };
