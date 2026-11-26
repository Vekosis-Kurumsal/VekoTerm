const { randomUUID } = require('node:crypto');
const { stripEscapes } = require('./session-tools.cjs');

// The terminal's last line asks for something secret (password, passphrase, PIN, one-time code): what the user
// types next must not be stored. Broader than the password-paste check, which skips passphrases on purpose.
function secretPrompt(buffer) {
  const line = stripEscapes(String(buffer || '').slice(-2000)).replace(/\r\n/g, '\n').split('\n').pop().split('\r').pop().slice(-200);
  return /(password|passphrase|passcode|parola|şifre|\bpin\b|verification code|doğrulama kodu|\botp\b|token)[^\n]{0,80}[:：]\s*$/iu.test(line) || /\[sudo[^\]]*\][^\n]*:\s*$/i.test(line);
}

// Commands that usually carry a password, key or token on the command line are never stored.
const SENSITIVE = [
  /\b(passwd|chpasswd|htpasswd|sshpass|pwgen)\b/i,
  /\bsudo\s+(-\w*S|--stdin)\b/i,
  /\bmysql(dump|admin)?\b[^\n]*\s-p\S+/i,
  /--(password|passwd|passphrase|secret|token|api[-_]?key)[=\s]\S+/i,
  /\b(\w*PASS(WORD|WD)?|\w*TOKEN|\w*SECRET\w*|API_?KEY|PGPASSWORD|MYSQL_PWD)\s*=/i,
  /\bAuthorization:\s*(Bearer|Basic)\s+\S+/i,
  /\bcurl\b[^\n]*\s(-u|--user)\s+\S+:\S+/i,
  /\bopenssl\s+passwd\b/i,
  /:\/\/[^\s/@:]+:[^\s/@]+@/,
  /ConvertTo-SecureString\b[^\n]*-AsPlainText/i
];
function isSensitiveCommand(command) { return /^\s/.test(command) || SENSITIVE.some(pattern => pattern.test(command)); }

const MAX = 2000;

// Follows what the user types into one terminal and yields each finished command line.
// A line edited with arrow keys, Tab completion, history search or other keys is not followed: what runs is
// then decided by the shell and cannot be known here. Typing at a visible secret question is never kept.
function trackInput(s, data, onCommand) {
  // Replies the terminal sends by itself (cursor position, device attributes, focus, colours) are not typing.
  if (/^(?:\x1b\[\??[\d;]*[Rcn]|\x1b\[>[\d;]*c|\x1b\[[IO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/.test(data)) return;
  let line = s.historyLine || '', broken = !!s.historyBroken;
  const finish = () => {
    const command = line.trim();
    if (command && !broken && !isSensitiveCommand(line) && !secretPrompt(s.buffer)) onCommand(line.replace(/\s+$/, ''));
    line = ''; broken = false;
  };
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    if (char === '\x1b') {
      const escape = data.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/)?.[0];
      if (escape) { if (!['\x1b[200~', '\x1b[201~'].includes(escape)) broken = true; i += escape.length - 1; }
      else { broken = true; i++; }
    } else if (char === '\r' || char === '\n') { finish(); if (char === '\r' && data[i + 1] === '\n') i++; }
    else if (char === '\x7f' || char === '\b') line = line.slice(0, -1);
    else if (char === '\x03' || char === '\x15') { line = ''; broken = false; }
    else if (char >= ' ') line += char;
    else broken = true;
    if (line.length > 4000) { line = ''; broken = true; }
  }
  s.historyLine = line; s.historyBroken = broken;
}

function entryFor(s, command) {
  const local = s.profile.type === 'local';
  return { id: randomUUID(), command, name: s.profile.name || '', host: local ? '' : s.profile.host || '', username: local ? '' : s.profile.username || '', type: s.profile.type, time: Date.now(), count: 1 };
}

// Newest first; running the same command again on the same server moves it to the top and counts it.
function addEntry(list, entry) {
  const key = e => `${e.command}\u0000${e.host}\u0000${e.username}\u0000${e.type}`;
  const index = list.findIndex(e => key(e) === key(entry));
  if (index >= 0) { const [previous] = list.splice(index, 1); entry = { ...previous, time: entry.time, count: (previous.count || 1) + 1 }; }
  list.unshift(entry);
  if (list.length > MAX) list.length = MAX;
  return list;
}

module.exports = { isSensitiveCommand, secretPrompt, trackInput, entryFor, addEntry, MAX };
