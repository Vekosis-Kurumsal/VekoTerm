const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { cleanProfile } = require('./store.cjs');

function importJSON(text) {
  const data = JSON.parse(text);
  if (data?.format === 'vekoterm-connection-backup') throw new Error('Bu dosya şifreli bir VekoTerm yedeği. Şifreli yedek seçeneğini kullanın.');
  if (!data || typeof data !== 'object') throw new Error('Geçerli VekoTerm bağlantı dosyası seçin.');
  if (!Array.isArray(data.profiles) || data.profiles.length > 5000) throw new Error('Geçerli VekoTerm bağlantı dosyası seçin.');
  if (data.folders !== undefined && (!Array.isArray(data.folders) || data.folders.length > 5000)) throw new Error('Geçerli klasör listesi bulunamadı.');
  const ids = new Map(), replacements = data.profiles.map(() => randomUUID());
  data.profiles.forEach((p, index) => { if (p.id) { if (ids.has(p.id)) throw new Error('Bağlantı dosyasında yinelenen kayıt kimliği var.'); ids.set(p.id, replacements[index]); } });
  const profiles = data.profiles.map((p, index) => { if (p.jumpProfileId && !ids.has(p.jumpProfileId)) throw new Error('Ara sunucu kaydı içe aktarım dosyasında bulunamadı.'); return cleanProfile({ ...p, id: replacements[index], jumpProfileId: ids.get(p.jumpProfileId) || '' }); });
  const folders = (data.folders || []).map(folder => cleanProfile({ type: 'local', folder }).folder);
  return { profiles, folders, warnings: [] };
}
function parseMoba(text, source = '') {
  // Field mapping: https://gist.github.com/Ruzgfpegk/ab597838e4abbe8de30d7224afd062ea
  // Only declarative connection data is imported; startup commands and macros are not executed/imported.
  const sections = []; let section;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (heading) { section = /^Bookmarks(?:_\d+)?$/i.test(heading[1]) ? { folder: '', lines: [] } : null; if (section) sections.push(section); continue; }
    if (!section || !line.trim() || /^[;#]/.test(line)) continue;
    const equal = line.indexOf('='); if (equal < 1) continue;
    const name = line.slice(0, equal).trim(), value = line.slice(equal + 1).trim();
    if (name === 'SubRep') section.folder = value.replace(/\\/g, ' / '); else if (name !== 'ImgNum') section.lines.push({ name, value });
  }
  if (!sections.length) throw new Error('MobaXterm Bookmarks bölümü bulunamadı. INI veya mxtsessions dışa aktarımını seçin.');
  const profiles = [], folders = [], warnings = [];
  const keyPath = value => String(value || '').replace(/_CurrentDrive_/g, path.win32.parse(source).root.replace(/\\$/, '') || 'C:');
  for (const group of sections) {
    // Named folders are kept even when empty; the unnamed root section only becomes a folder if it holds sessions.
    const folder = cleanProfile({ type: 'local', folder: group.folder || 'MobaXterm' }).folder;
    if (group.folder || group.lines.length) folders.push(folder);
    for (const row of group.lines) {
      try {
        const fields = row.value.split('#')[2]?.split('%');
        // MobaXterm session type codes: 0 SSH, 4 RDP, 5 VNC, 7 SFTP.
        const type = { 0: 'ssh', 4: 'rdp', 5: 'vnc', 7: 'sftp' }[fields?.[0]];
        if (!type) { warnings.push(`${row.name}: desteklenmeyen oturum türü atlandı.`); continue; }
        const p = { type, name: row.name, folder, host: fields[1], port: Number(fields[2]), username: type === 'vnc' || fields[3] === '<default>' ? '' : fields[3] };
        if (!fields[2]) warnings.push(`${row.name}: MobaXterm kaydında port yok; varsayılan port kullanıldı.`);
        if (p.type === 'ssh') {
          Object.assign(p, { x11: fields[5] === '-1', compression: fields[6] === '-1', keyPath: keyPath(fields[14]), auth: fields[14] ? 'key' : 'password', agentForward: fields[34] === '-1' });
          if (fields[7]) warnings.push(`${row.name}: otomatik giriş komutu aktarılmadı.`);
          if (fields[8]) { warnings.push(`${row.name}: ara sunucu içeren kayıt atlandı; bağlantıyı VekoTerm’de ara sunucusuyla yeniden oluşturun.`); continue; }
          if (fields[19] && fields[19] !== '0') {
            if (!['2', '3'].includes(fields[19])) { warnings.push(`${row.name}: desteklenmeyen proxy nedeniyle atlandı.`); continue; }
            p.proxy = { type: fields[19] === '2' ? 'socks5' : 'http', host: fields[20], port: Number(fields[21]), username: fields[22] };
          }
        } else if (type === 'rdp' && (fields[13] || fields[20])) { warnings.push(`${row.name}: ağ geçidi ayarları nedeniyle atlandı.`); continue; }
        profiles.push(cleanProfile(p));
      } catch (error) { warnings.push(`${row.name}: ${error.message}`); }
      if (profiles.length > 5000) throw new Error('En fazla 5000 bağlantı içe aktarılabilir.');
    }
  }
  return { profiles, folders: [...new Set(folders)], warnings };
}
function parseImport(buffer, filename) {
  if (buffer.length > 2 * 1024 * 1024) throw new Error('Bağlantı dosyası çok büyük.');
  let text;
  if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.subarray(2).toString('utf16le');
  // MobaXterm.ini uses the Windows ANSI code page; on Turkish systems that is 1254 (ş, ğ, ı, İ).
  else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { text = new TextDecoder('windows-1254').decode(buffer); } }
  return text.trimStart().startsWith('{') ? importJSON(text) : parseMoba(text, filename);
}
const connectionKey = p => [p.type, String(p.host || '').toLowerCase(), p.port, String(p.username || '').toLowerCase()].join('\n');
// Drops records that already exist (same type, address, port and user) so re-importing does not duplicate them.
// Jump references to a dropped record are pointed at the existing one.
function dropExisting(data, existing) {
  const known = new Map(existing.filter(p => !['local', 'serial'].includes(p.type)).map(p => [connectionKey(p), p.id]));
  const replaced = new Map(), profiles = [];
  for (const p of data.profiles) {
    const match = ['local', 'serial'].includes(p.type) ? undefined : known.get(connectionKey(p));
    if (match) replaced.set(p.id, match); else profiles.push(p);
  }
  return { ...data, profiles: profiles.map(p => replaced.has(p.jumpProfileId) ? { ...p, jumpProfileId: replaced.get(p.jumpProfileId) } : p), skipped: replaced.size };
}
module.exports = { parseImport, parseMoba, importJSON, dropExisting };
