const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
(async () => {
  const version = '21.1.16.1', dir = path.join(root, 'vendor/vcxsrv');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, 'vcxsrv.exe'))) {
    const url = `https://github.com/marchaesen/vcxsrv/releases/download/${version}/vcxsrv-64.${version}.installer.exe`;
    const response = await fetch(url); if (!response.ok) throw new Error('VcXsrv indirilemedi.');
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = 'df7fed8f49665d0592528ab6be9d07111ea73c6848283d128b77690e05b8f90b';
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('VcXsrv paket özeti eşleşmiyor.');
    const tools = path.join(root, '.tools'); fs.mkdirSync(tools, { recursive: true }); const archive = path.join(tools, 'vcxsrv.exe'); fs.writeFileSync(archive, bytes);
    execFileSync(process.env.SEVEN_ZIP || 'C:\\Program Files\\7-Zip\\7z.exe', ['x', archive, '-o' + dir, '-y'], { windowsHide: true, stdio: 'inherit' });
  }
  for (const [name, location] of [['xserver','xorg-server/COPYING'],['xlaunch','xlaunch/COPYING']]) {
    const response = await fetch(`https://raw.githubusercontent.com/marchaesen/vcxsrv/${version}/${location}`);
    if (response.ok) fs.writeFileSync(path.join(dir, 'LICENSE-' + name + '.txt'), await response.text());
  }
  fs.writeFileSync(path.join(dir, 'SOURCE.txt'), `VcXsrv ${version}, unmodified Windows release.\nProject: https://github.com/marchaesen/vcxsrv\nCorresponding source: https://github.com/marchaesen/vcxsrv/archive/refs/tags/${version}.tar.gz\nOriginal licenses apply; this separate executable is not relicensed under VekTerm's MIT license.\n`);
  console.log('VcXsrv paketi ve kaynak/lisans bilgisi hazır.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
