const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), destination = path.join(root, 'licenses');
fs.mkdirSync(destination, { recursive: true });
const visited = new Set(), manifest = [];
function collect(name, base) {
  let entry;
  try { entry = fs.realpathSync(path.join(base, 'node_modules', name)); } catch { return; }
  const pkg = JSON.parse(fs.readFileSync(path.join(entry, 'package.json'), 'utf8'));
  const key = pkg.name + '@' + pkg.version; if (visited.has(key)) return; visited.add(key);
  manifest.push({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository });
  const out = path.join(destination, pkg.name.replaceAll('/', '__').replaceAll('@', '') + '-' + pkg.version); fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(entry)) if (/^(license|licence|copying|notice|authors)/i.test(name) && fs.statSync(path.join(entry, name)).isFile()) fs.copyFileSync(path.join(entry, name), path.join(out, name));
  if (pkg.name === '@novnc/novnc') for (const dir of ['docs', 'vendor']) {
    const walk = base => { for (const e of fs.readdirSync(base, { withFileTypes: true })) { const src = path.join(base, e.name); if (e.isDirectory()) walk(src); else if (/license|copying|notice/i.test(e.name)) { const target = path.join(out, path.relative(entry, src)); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(src, target); } } }; walk(path.join(entry, dir));
  }
  const parent = path.dirname(entry); const depBase = parent.endsWith('node_modules') ? path.dirname(parent) : path.dirname(path.dirname(parent));
  for (const dependency of Object.keys(pkg.dependencies || {})) collect(dependency, depBase);
}
for (const name of Object.keys(require('../package.json').dependencies)) collect(name, root);
fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Lisans kaydı: ${manifest.length} bileşen`);
