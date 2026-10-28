const displayModes = new Set(['fullscreen', 'window', 'custom']);
// Values accepted by the RDP client for desktopscalefactor.
const scales = [100, 125, 150, 175, 200, 250, 300, 400, 500];
function cleanRDP(input = {}) {
  const displayMode = input.multimon ? 'fullscreen' : displayModes.has(input.displayMode) ? input.displayMode : 'fullscreen';
  const options = {
    displayMode, fullscreen: displayMode === 'fullscreen',
    // 'auto' follows the Windows display scale of the monitor VekoTerm is on.
    scale: scales.includes(Number(input.scale)) ? Number(input.scale) : 'auto',
    // 'dynamic' re-negotiates the remote resolution; 'smart' stretches the bitmap for hosts without scaling support.
    resize: input.resize === 'smart' ? 'smart' : 'dynamic',
    multimon: !!input.multimon, admin: !!input.admin, clipboard: input.clipboard !== false,
    drives: !!input.drives, printers: !!input.printers,
    audio: ['local', 'remote', 'off'].includes(input.audio) ? input.audio : 'local',
    width: Math.max(640, Math.min(7680, Math.round(Number(input.width) || 1440))),
    height: Math.max(480, Math.min(4320, Math.round(Number(input.height) || 900))),
    gateway: String(input.gateway || '').trim()
  };
  if (options.gateway && (!/^[a-zA-Z0-9.:-]+$/.test(options.gateway) || options.gateway.startsWith('-'))) throw new Error('RDP ağ geçidi adresini kontrol edin.');
  return options;
}
function screenRect(input) {
  if (!input || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(input[key])) || input.width <= 0 || input.height <= 0) return null;
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(input[key])]));
}
function nearestScale(factor) {
  const target = Number(factor) * 100;
  if (!Number.isFinite(target) || target <= 0) return 100;
  return scales.reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best, 100);
}
function effectiveScale(options, display = {}) { return options.scale === 'auto' ? nearestScale(display.scaleFactor) : options.scale; }
function rdpFile(profile, display = {}) {
  const p = cleanRDP(profile.rdp), safe = value => String(value || '').replace(/[\r\n\0]/g, '');
  const bounds = screenRect(display.bounds), workArea = screenRect(display.workArea);
  const scale = effectiveScale(p, display), smart = p.resize === 'smart';
  const lines = [
    'full address:s:' + safe(profile.host) + ':' + profile.port,
    'username:s:' + safe(profile.username),
    'screen mode id:i:' + (p.fullscreen ? 2 : 1),
    'use multimon:i:' + +p.multimon,
    'smart sizing:i:' + +smart,
    'dynamic resolution:i:' + +!smart,
    // Without these the remote desktop renders at 100% on a high-DPI screen and looks tiny.
    'desktopscalefactor:i:' + (smart ? 100 : scale),
    'devicescalefactor:i:100',
    'displayconnectionbar:i:1',
    'administrative session:i:' + +p.admin,
    'redirectclipboard:i:' + +p.clipboard,
    'redirectprinters:i:' + +p.printers,
    'drivestoredirect:s:' + (p.drives ? '*' : ''),
    'audiomode:i:' + { local: 0, remote: 1, off: 2 }[p.audio],
    'authentication level:i:2', 'enablecredsspsupport:i:1', 'prompt for credentials:i:1'
  ];
  // Screen rectangles are physical pixels; Electron window bounds alone are DIP.
  let dimensions = p.multimon ? null : p.displayMode === 'custom' ? p : p.fullscreen ? bounds : workArea || p;
  // Stretch mode for hosts without scaling support: request the logical size and let the client enlarge it.
  if (dimensions && smart && p.displayMode !== 'custom' && scale > 100) dimensions = { width: Math.round(dimensions.width * 100 / scale), height: Math.round(dimensions.height * 100 / scale) };
  if (dimensions) {
    lines.push('desktopwidth:i:' + Math.max(200, Math.min(8192, dimensions.width)), 'desktopheight:i:' + Math.max(200, Math.min(8192, dimensions.height)));
  }
  if (workArea && p.displayMode !== 'custom') {
    lines.push('winposstr:s:0,3,' + [workArea.x, workArea.y, workArea.x + workArea.width, workArea.y + workArea.height].join(','));
  }
  if (p.gateway) lines.push('gatewayhostname:s:' + p.gateway, 'gatewayusagemethod:i:1', 'gatewayprofileusagemethod:i:1');
  return lines.join('\r\n') + '\r\n';
}
function launchArgs(file, profile) {
  const p = cleanRDP(profile.rdp), args = [file];
  if (p.fullscreen) args.push('/f');
  if (p.multimon) args.push('/multimon');
  return args;
}
module.exports = { cleanRDP, rdpFile, launchArgs, nearestScale, effectiveScale };
