// In-app update: reads the latest published VekoTerm release on GitHub, downloads its installer, checks the SHA256
// digest published with the release and hands the verified file over to be started. Drafts and pre-releases are not
// returned by GitHub's "latest release" endpoint, so only releases that were reviewed and published are offered.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPOSITORY = 'Vekosis-Kurumsal/VekoTerm';
const API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES = `https://github.com/${REPOSITORY}/releases`;
// Only the version question goes out; nothing about the user or their connections.
const HEADERS = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'VekoTerm-update-check' };
const MAX_NOTES = 20000;

const parse = value => { const m = /^v?(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/.exec(String(value ?? '').trim()); return m ? m.slice(1).map(Number) : null; };
function isNewer(candidate, current) {
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function sha256File(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

class Updates {
  // api and the download prefix can be pointed at a local server by tests only (see main.cjs).
  constructor({ version, directory, api = API, fetch = globalThis.fetch }) {
    this.version = version; this.directory = directory; this.api = api; this.fetch = fetch;
    this.allowed = api === API ? `https://github.com/${REPOSITORY}/releases/` : new URL(api).origin + '/';
    this.release = null; this.installer = null; this.controller = null;
  }
  async check() {
    const response = await this.fetch(this.api, { headers: HEADERS, signal: AbortSignal.timeout(15000) }).catch(error => { throw new Error(`Güncelleme bilgisi alınamadı: ${error.cause?.code || error.message}`); });
    if (response.status === 404) { this.release = null; return { available: false, current: this.version, latest: null }; }
    if (response.status === 403 || response.status === 429) throw new Error('GitHub şu an çok sık soru aldığı için yanıt vermedi. Biraz sonra yeniden deneyin.');
    if (!response.ok) throw new Error(`Güncelleme bilgisi alınamadı (GitHub yanıtı ${response.status}).`);
    const release = await response.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (!parse(version)) throw new Error('Son sürümün numarası okunamadı.');
    const name = `VekoTerm-Setup-${version}-x64.exe`, assets = Array.isArray(release.assets) ? release.assets : [];
    const trusted = url => typeof url === 'string' && url.startsWith(this.allowed) ? url : null;
    const installer = assets.find(a => a?.name === name), checksum = assets.find(a => a?.name === `${name}.sha256`);
    this.release = {
      version, name,
      url: trusted(installer?.browser_download_url), size: Number(installer?.size) || 0,
      digest: /^sha256:([0-9a-f]{64})$/i.exec(String(installer?.digest || ''))?.[1]?.toLowerCase() || null,
      checksumUrl: trusted(checksum?.browser_download_url),
      page: trusted(release.html_url) || (this.api === API ? `${RELEASES}/tag/v${version}` : null)
    };
    return { available: isNewer(version, this.version), current: this.version, latest: version, notes: String(release.body || '').slice(0, MAX_NOTES), published: release.published_at || null, size: this.release.size, downloadable: !!this.release.url };
  }
  async expectedDigest() {
    const r = this.release;
    if (r.digest) return r.digest;
    if (r.checksumUrl) {
      const response = await this.fetch(r.checksumUrl, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: AbortSignal.timeout(15000) });
      if (response.ok) { const match = /^([0-9a-f]{64})\b/i.exec((await response.text()).trim()); if (match) return match[1].toLowerCase(); }
    }
    throw new Error('Bu sürüm için SHA256 özeti bulunamadı. Kurulum dosyası doğrulanamayacağı için indirilmedi.');
  }
  async download(onProgress = () => {}) {
    const r = this.release;
    if (!r || !isNewer(r.version, this.version)) throw new Error('İndirilecek yeni sürüm yok. Önce güncellemeleri denetleyin.');
    if (!r.url) throw new Error('Bu sürümde Windows kurulum dosyası yok.');
    if (this.controller) throw new Error('İndirme zaten sürüyor.');
    const expected = await this.expectedDigest();
    await fsp.mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, r.name), partial = `${target}.part`;
    this.controller = new AbortController(); this.installer = null;
    const signal = this.controller.signal;
    try {
      const response = await this.fetch(r.url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal });
      if (!response.ok || !response.body) throw new Error(`Kurulum dosyası indirilemedi (yanıt ${response.status}).`);
      const total = Number(response.headers.get('content-length')) || r.size;
      const hash = createHash('sha256'); let bytes = 0, last = 0;
      const meter = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); bytes += chunk.length; if (Date.now() - last > 200) { last = Date.now(); onProgress({ bytes, total }); } done(null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(partial), { signal });
      const actual = hash.digest('hex');
      if (actual !== expected) throw new Error('İndirilen dosyanın SHA256 özeti sürümde yayımlanan özetle uyuşmuyor. Dosya silindi; kurulum başlatılmadı.');
      await fsp.rm(target, { force: true }); await fsp.rename(partial, target);
      this.installer = { path: target, version: r.version, sha256: actual };
      onProgress({ bytes, total: bytes, done: true });
      return { version: r.version, sha256: actual };
    } catch (error) {
      await fsp.rm(partial, { force: true }).catch(() => {});
      throw signal.aborted ? new Error('İndirme iptal edildi.') : error;
    } finally { this.controller = null; }
  }
  cancel() { this.controller?.abort(); }
  // The file sits in a temporary folder between download and start, so its digest is checked once more.
  async verifiedInstaller() {
    const file = this.installer;
    if (!file) throw new Error('Önce güncellemeyi indirin.');
    if (await sha256File(file.path).catch(() => '') !== file.sha256) { this.installer = null; throw new Error('Kurulum dosyası indirildikten sonra değişmiş. Yeniden indirin.'); }
    return file.path;
  }
  releasePage() { return this.release?.page || (this.api === API ? RELEASES : null); }
}

module.exports = { Updates, isNewer, REPOSITORY };
