# Üçüncü taraf bileşenler

VekoTerm'in özgün kodu MIT lisanslıdır. Kullanılan bileşenlerin telif ve lisansları kendi sahiplerine aittir; VekoTerm lisansı bunları değiştirmez.

| Bileşen | Lisans | Kaynak |
|---|---|---|
| Electron | MIT; Chromium ve diğer bileşenlerin ayrı lisansları | https://github.com/electron/electron |
| React / React DOM | MIT | https://github.com/facebook/react |
| xterm.js ve eklentileri | MIT | https://github.com/xtermjs/xterm.js |
| node-pty | MIT | https://github.com/microsoft/node-pty |
| ssh2 | MIT | https://github.com/mscdex/ssh2 |
| noVNC | MPL-2.0; vendor dizininin ek lisansları | https://github.com/novnc/noVNC/tree/v1.7.0 |
| ws | MIT | https://github.com/websockets/ws |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| CodeMirror, Lezer ve dil paketleri | MIT | https://github.com/codemirror |
| jsdiff | BSD-3-Clause | https://github.com/kpdecker/jsdiff |
| basic-ftp | MIT | https://github.com/patrickjuchli/basic-ftp |
| SerialPort ve bileşenleri | MIT | https://github.com/serialport/node-serialport |
| VcXsrv 21.1.16.1 ve X.org bileşenleri | Bileşene göre değişir; özgün lisansları korunur | https://github.com/marchaesen/vcxsrv/tree/21.1.16.1 |

Çalışma zamanı JavaScript bağımlılıklarının lisans metinleri paketleme sırasında (`pnpm package`) `licenses/` klasörüne toplanır ve uygulama paketinde bulunur. Electron/Chromium lisansları uygulama paketinde ayrıca bulunur. VcXsrv, `resources/vcxsrv/` altında değiştirilmemiş, ayrı bir program olarak çalışır.

VcXsrv sürümünün kaynak arşivi: https://github.com/marchaesen/vcxsrv/archive/refs/tags/21.1.16.1.tar.gz

noVNC'nin kaynak dosyalarında değişiklik yapılmamıştır. Kaynak arşivi: https://github.com/novnc/noVNC/archive/refs/tags/v1.7.0.tar.gz

MobaXterm, Mobatek'in markasıdır. VekoTerm bağımsızdır; MobaXterm'in kodunu, logosunu veya görsel dosyalarını içermez.
