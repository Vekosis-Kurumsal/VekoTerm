# VekoTerm

Windows için açık kaynak terminal ve uzak bağlantı çalışma alanı. SSH, SFTP, RDP, VNC, Telnet, seri port ve FTP/FTPS bağlantılarını tek pencerede, klasörlü bir bağlantı ağacıyla yönetir. Arayüz MobaXterm kullanıcılarının alışık olduğu düzende, Türkçedir.

> **English:** VekoTerm is an open-source terminal and remote-connection workspace for Windows (SSH, SFTP, RDP, VNC, Telnet, serial, FTP/FTPS) with a MobaXterm-style layout. The user interface is currently Turkish only. Licensed under MIT.

## Özellikler

**Bağlantılar**
- SSH: parola, özel anahtar ve Windows SSH agent; sunucu anahtarı doğrulaması; en fazla 5 ara sunucu (jump host); parola/OTP gibi çok adımlı doğrulama; sıkıştırma, agent yönlendirme, keepalive
- HTTP CONNECT, HTTPS CONNECT ve SOCKS5 proxy
- SFTP dosya paneli, yerel terminal (PowerShell, cmd, kuruluysa WSL ve Git Bash)
- RDP (Windows Uzak Masaüstü penceresinde; Windows ölçeği otomatik, tam ekran / büyük pencere / özel çözünürlük)
- Uygulama içinde VNC (noVNC), Telnet, seri port, FTP/FTPS
- Yerel, uzak ve dinamik (SOCKS5) SSH tünelleri; kayıtlı tüneller ayrı başlatılıp durdurulabilir
- Pakete dahil X sunucusu (VcXsrv) ve SSH X11 yönlendirme

**Dosyalar**
- Dosya ve klasör yükleme/indirme, Windows'tan sürükle-bırak, çoklu seçim, izinler, yeni dosya, onaylı silme
- Aktarım iptali; tek dosyada SHA-256 doğrulamalı kaldığı yerden devam
- Yerleşik düzenleyici (CodeMirror; sözdizimi renklendirme, arama/değiştirme)
- Terminalin bulunduğu klasörü izleyen dosya paneli; yerel dosya/klasör karşılaştırma

**Oturum yönetimi**
- Klasörlü bağlantı ağacı, favoriler, arama, hızlı bağlan (`kullanıcı@sunucu[:port]` veya kayıtlı bağlantı adı)
- Numaralı sekmeler, yan yana / alt alta / dört bölmeli görünüm, adlandırılmış çalışma alanları
- MobaXterm'den alma: `MobaXterm.ini` otomatik bulunur; `.mxtsessions` dosyası da okunur (SSH, SFTP, RDP, VNC; tekrarlar atlanır). MobaXterm'de saklanan parolalar aktarılmaz.
- VekoTerm JSON içe/dışa aktarma ve parolaları da taşıyan, parola korumalı `.vekobak` yedeği

**Terminal**
- Çoklu komut (seçili terminallere aynı anda yazma), makro kaydı ve oynatma
- Çıktıyı dosyaya kaydetme ve dışa aktarma, terminalde arama, seçince kopyalama, geçmişte kaydırarak seçim, "Tümünü kopyala"
- Komutların ve önemli çıktıların renklendirilmesi (HATA, UYARI, TAMAM gibi durum etiketleri dahil); yalnız görüntüye uygulanır
- "Kayıtlı parolayı yapıştır" (Ctrl+Shift+P): sunucudaki sudo sorusuna bağlantının parolasını, yerel terminaldeki `kullanıcı@sunucu's password:` sorusuna eşleşen kayıtlı bağlantının parolasını gönderir

**Diğer**
- Uzak Linux sunucu için CPU, bellek, disk, ağ ve çalışma süresi çubuğu
- SSH anahtar aracı (Ed25519, RSA 4096, ECDSA 256), ağ araçları (port, DNS, ping, yol izleme)
- İsteğe bağlı ana parola ile uygulama kilidi, açık/koyu tema, `--portable` taşınabilir veri modu

## Kurulum

Hazır Windows x64 kurulum dosyası [Releases](../../releases) sayfasındadır. Kurulum dosyası şu an **imzasızdır**; Windows SmartScreen ilk açılışta uyarı gösterebilir. Dosyanın SHA256 özeti sürüm notunda verilir.

Kullanıcı verileri `%APPDATA%\VekTerm` altında tutulur; kaldırma işlemi bu verileri silmez.

## Güvenlik

- Kayıtlı parolalar Windows'un kullanıcıya bağlı koruması (DPAPI, Electron `safeStorage`) ile şifrelenir. İsteğe bağlı ana parola kasası kayıt dosyasının tamamını scrypt + AES-256-GCM ile korur.
- Arayüz (renderer) Node.js yetkisi olmadan çalışır; ayrıcalıklı işlemler yalnız preload'da tanımlı dar IPC metotlarıyla yapılır.
- "Kayıtlı parolayı yapıştır" parolayı arayüze getirmez; yalnız terminalin son satırında parola sorusu görünüyorsa ana süreçten doğrudan bağlantıya yazar. Makro kaydına ve çoklu komuta girmez.
- Güvenlik açığı bildirimi için: vekosis@vekosis.com

## Kaynaktan derleme

Gerekenler: Windows x64, Node.js 22 veya üzeri, pnpm. X sunucusunu pakete eklemek için 7-Zip.

```
pnpm install
pnpm prepare:x11
pnpm build
pnpm start
```

`pnpm prepare:x11` VcXsrv'yi resmî sürümünden indirip özetini doğrular (`vendor/vcxsrv`, depoya eklenmez). Geliştirme sırasında `pnpm dev` ile Vite sunucusunu (127.0.0.1:5178) açıp ayrı bir terminalde `VEKTERM_DEV=1` ortam değişkeniyle `pnpm start` çalıştırılabilir.

```
pnpm package
```

`pnpm package` kurulum dosyasını `release/<sürüm>/VekoTerm-Setup-<sürüm>-x64.exe` olarak üretir.

## Proje yapısı

- `electron/` — ana süreç: pencere, IPC, oturumlar (PTY, SSH/SFTP, Telnet, seri, FTP), tüneller, kayıt deposu ve kasa, X sunucusu, RDP/VNC
- `src/` — React arayüzü (xterm.js, CodeMirror, noVNC)
- `scripts/` — lisans dökümü ve VcXsrv hazırlığı

Sürüm notları [Releases](../../releases) sayfasındadır.

## Lisans

MIT — bkz. [LICENSE](LICENSE). Üçüncü taraf bileşenler [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dosyasında listelenir; lisans metinleri paketleme sırasında `licenses/` klasörüne toplanır ve kurulum dosyasına eklenir. VcXsrv değiştirilmeden, kendi lisansıyla dağıtılır.

MobaXterm, Mobatek'in ticari markasıdır; VekoTerm bağımsız bir projedir ve Mobatek ile bağlantısı yoktur.

Vekosis Kurumsal Bilgi Sistemleri · vekosis@vekosis.com
