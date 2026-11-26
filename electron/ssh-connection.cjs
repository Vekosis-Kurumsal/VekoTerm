const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { Client, utils } = require('ssh2');

module.exports = async function connectSSH(s, profile, input = {}, chain = []) {
  if (chain.length >= 5 || chain.includes(profile.id)) throw new Error('Ara sunucu zinciri döngü içeriyor veya çok uzun.');
  // An automatic reconnect never opens a question window by itself; it gives up instead.
  const promptAuth = s.noPrompt ? undefined : this.options.promptAuth;
  const client = new Client(); s.resources.push({ destroy: () => client.end() });
  let socket;
  if (profile.jumpProfileId) {
    const jump = this.store.list().find(p => p.id === profile.jumpProfileId && p.type === 'ssh');
    if (!jump) throw new Error('Seçili ara sunucu kaydı bulunamadı.');
    const jumpInput = {};
    if (jump.auth === 'password' && !jump.hasSecret) {
      if (!promptAuth) throw new Error('Ara sunucunun parolasını kaydedin veya SSH anahtarı kullanın.');
      const answers = await promptAuth(s.id, `${jump.name} · Ara sunucu`, [{ prompt: 'Parola', echo: false }]); jumpInput.password = answers[0];
    }
    const gateway = await connectSSH.call(this, s, jump, jumpInput, [...chain, profile.id]);
    socket = await new Promise((resolve, reject) => gateway.forwardOut('127.0.0.1', 0, profile.host, profile.port, (error, channel) => error ? reject(error) : resolve(channel)));
    s.resources.push(socket);
  } else if (profile.proxy) {
    let secret = '';
    if (profile.proxy.username) {
      if (!promptAuth) throw new Error('Proxy parolası için kimlik doğrulama penceresi gerekiyor.');
      const answers = await promptAuth(s.id, `${profile.proxy.host} · Proxy`, [{ prompt: 'Proxy parolası', echo: false }]); secret = answers[0];
    }
    socket = await require('./proxy.cjs').connectProxy(profile.proxy, profile.host, profile.port, secret, (profile.connectTimeout || 25) * 1000); s.resources.push(socket);
  }
  // A saved password Windows can no longer open is asked for instead (a key passphrase is asked for by the key check).
  const unreadable = !input.password && !!this.store.secretUnreadable?.(profile.id);
  if (unreadable && profile.auth === 'password' && !promptAuth) throw this.store.unreadableSecretError(profile.id);
  let password = input.password || (unreadable ? '' : this.store.secret(profile.id));
  if (!password && profile.auth === 'password' && promptAuth) { const answers = await promptAuth(s.id, `${profile.name} · ${unreadable ? 'Kayıtlı parola açılamadı, parolayı yazın' : 'Bağlantı parolası'}`, [{ prompt: 'Parola', echo: false }]); password = answers[0]; if (s.authInput && profile.id === s.profile.id) s.authInput.password = password; }
  const cfg = {
    host: profile.host, port: profile.port, username: profile.username, sock: socket,
    readyTimeout: (profile.connectTimeout || 25) * 1000,
    keepaliveInterval: (profile.keepaliveSeconds ?? 15) * 1000, keepaliveCountMax: 3,
    tryKeyboard: true,
    hostVerifier: (key, done) => {
      const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''), known = this.store.known(profile.host, profile.port);
      if (known) { if (known !== fingerprint) s.trustError = 'Sunucunun kimlik anahtarı değişti. Bağlantı durduruldu.'; done(known === fingerprint); return; }
      if (s.noPrompt) { s.trustError = 'Sunucu kimliği daha önce doğrulanmamış; otomatik bağlantı kurulmadı.'; done(false); return; }
      Promise.resolve(this.options.verifyHost?.({ host: profile.host, port: profile.port, fingerprint })).then(ok => { if (ok) this.store.trust(profile.host, profile.port, fingerprint); done(!!ok); }).catch(() => done(false));
    }
  };
  if (profile.compression) cfg.algorithms = { compress: { prepend: ['zlib@openssh.com', 'zlib'] } };
  if (profile.auth === 'key') {
    if ((await fs.stat(profile.keyPath)).size > 1024 * 1024) throw new Error('SSH anahtar dosyası çok büyük.');
    cfg.privateKey = await fs.readFile(profile.keyPath);
    const key = utils.parseKey(cfg.privateKey, password || undefined);
    if (!password && key instanceof Error && /encrypted|passphrase/i.test(key.message) && promptAuth) { password = (await promptAuth(s.id, `${profile.name} · Anahtar parolası`, [{ prompt: 'Anahtar parolası', echo: false }]))[0]; if (s.authInput && profile.id === s.profile.id) s.authInput.password = password; }
    cfg.passphrase = password || undefined;
  }
  else if (profile.auth === 'agent') cfg.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined);
  else if (profile.auth !== 'interactive') cfg.password = password;
  if (profile.agentForward) { cfg.agent ||= process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined); cfg.agentForward = true; }
  client.on('keyboard-interactive', async (name, instructions, _language, prompts, finish) => {
    try {
      if (!promptAuth) { finish([]); return; }
      const answers = await promptAuth(s.id, name || `${profile.name} · Kimlik doğrulama`, prompts, instructions);
      finish(answers);
    } catch { finish([]); client.end(); }
  });
  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (settled) return; settled = true; reject(new Error(s.trustError || error?.message || 'SSH bağlantısı kurulmadan kapandı.')); };
    client.once('ready', () => { if (settled) return; settled = true; resolve(); });
    client.on('error', fail); client.once('close', () => fail());
    if (this.items.get(s.id) !== s) { fail(new Error('Bağlantı iptal edildi.')); return; }
    client.connect(cfg);
  });
  return client;
};
