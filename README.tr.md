# 💥 BomPixel

**Tamamen tarayıcıda çalışan, gerçek zamanlı çok oyunculu 3D voxel FPS — CDN yok, harici servis yok, build adımı yok.**

[English README](README.md) · Node.js + Socket.IO + SQLite + Three.js · MIT Lisansı

## Hızlı Başlangıç

Gereksinim: Node.js **≥ 22.5** (yerleşik `node:sqlite` için; Node 24 önerilir).

```bash
npm install
npm start
```

- Oyun: **http://localhost:3000** · Admin: **http://localhost:3000/admin**
- Telefon/tablet (aynı Wi-Fi): konsolda yazan `http://<IP>:3000`
- Varsayılan admin: `admin` / `admin123` — **hemen değiştirin!**

## Öne Çıkanlar

- 🔫 **3 silahlık loadout** — `1/2/3/4`, scroll veya oyun içi mağaza (`B`); slot 4 daima C4
- 💣 **C4**: sağ tık ile kur (2.5 sn), 35 sn fitil + ekranda yanan sayaç, **50 m yarıçap** mesafeye göre hasar, patlama savrulması; düşman `E` ile çözerse **+3 puan**
- 🔭 **Dürbün** (keskin nişancı, sağ tık aç/kapat) · 🦘 **Space ile zıplama**
- 🏢 **Tek yönlü bina görüşü** — içeriden dışarısı görünür, tersi görünmez; ateş eden 1.2 sn ifşa olur
- 🤖 **Akıllı botlar** (Kolay/Normal/Zor) — devriye, görüş hattı, mesafe koruma; Zor botlar C4 kurar ve çözer
- 🗺️ **Çoklu arena** — her harita ayrı oda; lobiden canlı oyuncu sayısıyla seçilir
- 🎨 **Piksel skin editörü** — emoji basma, **fotoğrafı piksele çevirme**, şablonlar; kafa üstü **hareketli emoji**
- 💠 **Sticker'lı silah kaplamaları** — kendi silahına 3 emoji sticker, her biri **+%4 hasar**, oyunda animasyonlu
- 🛡️ **Gruplar** — oyun içinden davet (Tab), çevrimiçi/çevrimdışı durum, takım olunca dost ateşi kapalı
- 🧭 Minimap, kafa üstü can barları, canlı TOP-10, kill feed, 8 dk turlar + maç geçmişi
- 📢 **Canlı tabelalar/reklamlar** — admin panelden değiştirin, oyundaki herkese anında yansır
- 🗺️ **Admin harita editörü** — zemin/yol/su/park boya, tümsek, girilebilir bina, tabela, doğum noktası; boyut 16–256 m
- 📱 Masaüstü + mobil + tablet tek kod tabanı (joystick, sürükleyerek bakış, dokunmatik butonlar)
- 🔊 **Sıfır ses dosyası** — tüm sesler WebAudio ile sentezlenir ve **konumsal** (yön + mesafe)

## Kontroller

| | Masaüstü | Mobil |
|---|---|---|
| Hareket / Bakış | `WASD` / fare | Sol joystick / sağı sürükle |
| Ateş / Zıpla | Sol tık / `Space` | 🔥 / ⬆️ |
| Silah / Mağaza | `1-4`, scroll / `B` | Slotlara dokun / 🛒 |
| Dürbün / C4 kur | Sağ tık | 🔭 / 💣 |
| C4 çöz / Oyuncular | `E` basılı / `Tab` | ✂️ / 👥 |

## Test

Sunucu açıkken: `npm test` — 55 senaryoluk uçtan uca duman testi; kendi izole arenalarını kurar, canlı oyuncuları etkilemez.

## Katkı

Mimari, veri formatları, HTTP API ve socket protokolünün tam dokümantasyonu için [İngilizce README](README.md)'ye bakın. Altın kural: `server/game.js` ile `public/js/world.js` içindeki ikiz geometri fonksiyonları (`buildWalls` / `heightAt` / `insideBuilding`) birlikte değiştirilmelidir.

## Lisans

[MIT](LICENSE)
