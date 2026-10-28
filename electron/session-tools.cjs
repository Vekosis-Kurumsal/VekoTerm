const fs = require('node:fs');
const { stripVTControlCharacters } = require('node:util');
const { randomUUID } = require('node:crypto');
function recordedCommands(input) {
  const lines = []; let line = '', skipped = 0, unsupported = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '\x1b') {
      const escape = input.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z~]/)?.[0];
      if (escape) { if (!['\x1b[200~', '\x1b[201~'].includes(escape)) unsupported = true; i += escape.length - 1; } else unsupported = true;
    } else if (char === '\r' || char === '\n') { if (unsupported) skipped++; else if (line.trim()) lines.push(line); line = ''; unsupported = false; if (char === '\r' && input[i + 1] === '\n') i++; }
    else if (char === '\b' || char === '\x7f') line = line.slice(0, -1);
    else if (char === '\x03' || char === '\x15') { line = ''; unsupported = false; }
    else if (char >= ' ' || char === '\t') line += char;
    else unsupported = true;
  }
  return { commands: lines.join('\n'), skipped };
}
class PlainLog {
  constructor(filename) { this.file = fs.openSync(filename, 'w'); this.state = 'text'; }
  write(text) {
    let plain = '';
    for (const char of text) {
      if (this.state === 'text') { if (char === '\x1b') this.state = 'escape'; else if (char >= ' ' || '\r\n\t'.includes(char)) plain += char; }
      else if (this.state === 'escape') this.state = char === '[' ? 'csi' : [']','P','_','^'].includes(char) ? 'osc' : ['(',')'].includes(char) ? 'charset' : 'text';
      else if (this.state === 'csi' && char >= '@' && char <= '~') this.state = 'text';
      else if (this.state === 'osc') { if (char === '\x07') this.state = 'text'; else if (char === '\x1b') this.state = 'oscEscape'; }
      else if (this.state === 'oscEscape') this.state = char === '\\' ? 'text' : 'osc';
      else if (this.state === 'charset') this.state = 'text';
    }
    if (plain) fs.writeFileSync(this.file, plain, 'utf8');
  }
  close() { if (this.file !== null) { fs.closeSync(this.file); this.file = null; } }
}
// The terminal's last line when it is a password question. OpenSSH/scp name the target ("erp@10.0.0.5's password:");
// sudo names the user ("[sudo] password for erp:", "[sudo] erp için parola:") or nobody ("[sudo: authenticate] Password:").
function passwordPrompt(buffer) {
  const line = stripVTControlCharacters(String(buffer || '').slice(-2000)).replace(/\r\n/g, '\n').split('\n').pop().split('\r').pop();
  // The Windows console may redraw without line breaks, so only the end of the line is examined.
  const tail = line.slice(-200);
  const target = tail.match(/([^\s@'"/:\\]+)@([^\s@'"/:\\]+)'s password:\s*$/i);
  if (target) return { user: target[1], host: target[2] };
  if (/passphrase/i.test(tail) || !/(?:password|parola|şifre)[^\n]{0,80}:\s*$/iu.test(tail) || line.length > 200) return null;
  return { user: tail.match(/password for ([^\s:]+)/i)?.[1] || tail.match(/(\S+) için (?:parola|şifre)/iu)?.[1] || '', host: '' };
}
const methods = {
  duplicateSession(id) { const s = this.get(id); return this.open({ ...s.profile, password: s.authInput?.password }); },
  // Answers a password question with a password VekoTerm already holds, only when the user asks.
  // "user@host's password:" (ssh/scp, also in the local terminal) uses the saved connection with that user and address;
  // other questions in an SSH tab (sudo) use that tab's own connection password.
  // The password never reaches the renderer and bypasses macro recording and multi-command input.
  sendSavedPassword(id) {
    const s = this.get(id), local = s.profile.type === 'local';
    if (!(local && s.pty) && (s.profile.type !== 'ssh' || !s.stream)) throw new Error('Kayıtlı parola yalnız SSH ve yerel terminalde gönderilebilir.');
    if (s.status !== 'connected') throw new Error('Bağlantı açık değil.');
    const prompt = passwordPrompt(s.buffer);
    if (!prompt) throw new Error('Terminalde parola sorusu görünmüyor. Parola gönderilmedi.');
    let password;
    if (prompt.host) password = this.savedPasswordFor(prompt.user, prompt.host, s);
    else {
      if (local) throw new Error(`Parola sorusunun hangi sunucuya ait olduğu anlaşılmıyor. Yerel terminalde yalnız “kullanıcı@sunucu's password:” sorularına parola gönderilir.`);
      if (s.profile.auth !== 'password') throw new Error('Bu bağlantı parolayla açılmadı; gönderilecek sunucu parolası yok.');
      if (prompt.user && s.profile.username && prompt.user !== s.profile.username) throw new Error(`Sunucu ${prompt.user} kullanıcısının parolasını soruyor; bu bağlantının parolası ${s.profile.username} için. Parola gönderilmedi.`);
      password = s.authInput?.password || (this.store?.locked ? '' : this.store?.secret?.(s.profile.id)) || '';
      if (!password) throw new Error('Bu bağlantı için parola yok. Bağlantı ayarlarında “Parolayı sakla” seçeneğini işaretleyebilir veya bağlanırken yazabilirsiniz.');
    }
    if (s.pty) s.pty.write(password + '\r'); else s.stream.write(password + '\r');
    return true;
  },
  // The one password saved for user@host; refuses when there is none or when saved connections disagree.
  savedPasswordFor(user, host, s) {
    if (this.store?.locked) throw new Error('Uygulama kilitli. Kayıtlı parolalar için önce kilidi açın.');
    const target = `${user}@${host}`, same = p => ['ssh', 'sftp'].includes(p.type) && p.auth === 'password' && p.username === user && String(p.host).toLowerCase() === host.toLowerCase();
    const profiles = (this.store?.list?.() || []).filter(same);
    const passwords = new Set(profiles.map(p => this.store.secret(p.id)).filter(Boolean));
    // An SSH tab connected to the same user@host also knows the password typed at login.
    if (s.profile.type === 'ssh' && same(s.profile) && s.authInput?.password) passwords.add(s.authInput.password);
    if (!profiles.length && !passwords.size) throw new Error(`Kayıtlı bağlantılarda ${target} yok. Bu kullanıcı ve adresle bir bağlantı kaydedip parolasını saklayın. Parola gönderilmedi.`);
    if (!passwords.size) throw new Error(`${target} kayıtlı ama parolası saklanmamış. Bağlantı ayarlarında “Parolayı sakla” seçeneğini işaretleyin. Parola gönderilmedi.`);
    if (passwords.size > 1) throw new Error(`${target} için farklı parolalı birden çok kayıt var; hangisinin kullanılacağı belli değil. Parola gönderilmedi.`);
    return [...passwords][0];
  },
  transcript(id) { return stripVTControlCharacters(this.get(id).buffer); },
  startLog(id, filename) {
    const s = this.get(id); if (s.log) throw new Error('Bu oturumun kaydı zaten açık.');
    const log = new PlainLog(filename); try { log.write(s.buffer); } catch (error) { log.close(); throw error; }
    s.log = log; s.public = { ...s.public, logging: true }; this.emitState(s);
  },
  stopLog(id) { const s = this.get(id); s.log?.close(); s.log = null; s.public = { ...s.public, logging: false }; this.emitState(s); },
  startRecording(id) {
    const s = this.get(id); if (s.status !== 'connected' || !['ssh','local','telnet','serial'].includes(s.profile.type)) throw new Error('Makro kaydı için açık bir terminal seçin.');
    s.recording = ''; s.recordingActive = true; s.public = { ...s.public, recording: true }; this.emitState(s);
  },
  stopRecording(id) { const s = this.get(id), result = recordedCommands(s.recording || ''); s.recording = ''; s.recordingActive = false; s.public = { ...s.public, recording: false }; this.emitState(s); return result; },
  startMacro(macroId, ids) {
    const macro = this.store.data.macros?.find(m => m.id === macroId); if (!macro) throw new Error('Makro bulunamadı.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('Hedef terminal seçin.');
    const targets = [...new Set(ids)]; for (const id of targets) { const s = this.get(id); if (s.status !== 'connected' || !['ssh', 'local', 'telnet','serial'].includes(s.profile.type)) throw new Error('Yalnız açık terminaller seçilebilir.'); }
    this.macroJobs ||= new Map(); const id = randomUUID(), controller = new AbortController(); this.macroJobs.set(id, controller);
    const report = (status, message) => this.emit('event', { type: 'macroState', macro: { id, name: macro.name, status, message } });
    report('running');
    (async () => {
      try {
        for (const command of macro.commands.split(/\r?\n/)) {
          controller.signal.throwIfAborted();
          for (const target of targets) { if (this.get(target).status !== 'connected') throw new Error('Hedef bağlantı kapandı.'); this.input(target, command + '\r'); }
          await new Promise(resolve => { const timer = setTimeout(done, macro.delayMs); function done() { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); } controller.signal.addEventListener('abort', done, { once: true }); });
        }
        report(controller.signal.aborted ? 'cancelled' : 'done');
      } catch (error) { report(controller.signal.aborted ? 'cancelled' : 'error', error.message); }
      finally { this.macroJobs.delete(id); }
    })();
    return id;
  },
  stopMacro(id) { this.macroJobs?.get(id)?.abort(new Error('Makro durduruldu.')); }
};
module.exports = { methods, PlainLog, recordedCommands, passwordPrompt };
