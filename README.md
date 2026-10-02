# 🛡️ Project-D Staff Item & Clothes/Block Editor

> **Web Admin Server khusus untuk Akun Staff Project-D GTPS.**  
> Digunakan oleh tim Staff (Owner, Developer, Administrator, Moderator) untuk mengedit atribut item Clothes/Wearables (Far Put, Far Punch, Break Hit, xGems, xEXP) serta mengonfigurasi Block menjadi Gacha Box dengan drop table kustom.

---

## ✨ Fitur Utama

### 1. 🔐 Autentikasi Khusus Role Staff
- Login langsung menggunakan akun GrowID & Password Growtopia Anda.
- **Validasi Role Ketat**: Hanya akun yang memiliki hak akses Staff yang dapat masuk:
  - `👑 Owner` (`Role.Owner_Server`)
  - `⚙️ Developer` (`Role.Developer`)
  - `🛡️ Administrator` (`Role.Administrator`)
  - `💻 Coder` (`Role.Coder`)
  - `⭐ Moderator` (`Role.Moderator`)
  - `🎖️ Staff` (`Role.Staff` & `Role.has_config_access`)
- Akun player biasa akan otomatis ditolak aksesnya dengan pesan peringatan resmi.

### 2. 👕 Clothes & Wearable Attributes Editor
Terapkan buff khusus untuk item pakaian / aksesoris (Hand, Shirt, Pants, Mask, Back, dll):
* **Far Put / Place Range (`Punch_Place`)**: Menentukan jarak jangkauan meletakkan balok dari kejauhan (0 - 20 blok).
* **Far Punch Reach (`Far_Punch`)**: Menentukan jangkauan pukulan / hancur balok dari kejauhan (0 - 20 blok).
* **Break Strength (`Punch_Hit`)**: Kekuatan pukulan per hit (misal: isi `1` untuk instant break 1 hit ala Rayman).
* **xGems Multiplier (`Gems`)**: Kelipatan bonus Gems yang jatuh saat memukul balok (misal: 2x, 5x, 20x).
* **xEXP Multiplier (`Xp`)**: Kelipatan bonus EXP player yang didapat (misal: 2x, 5x, 10x).
* **Punch Visual Effect (`Punch_Id`)**: Mengubah animasi pukulan (Rayman Fist, Flame, Cosmic, Golden Slash, dsb).

### 3. 🧱 Block & Gacha Configuration
Ubah balok biasa menjadi balok spesial dan interactive Gacha:
* **Set Block Menjadi GACHA (`property_gacha`)**:
  - Mengubah balok menjadi Mystery / Gacha Box.
  - **Extra Drops Table**: Tentukan daftar hadiah yang bisa didapat pemain saat balok dipecahkan (Item ID, Jumlah, dan Persentase Peluang Drop %).
  - Mode peluang drop acak (`ExtraDropsMode`).
* **Ketahanan Balok (`Break_Hits`)**: Atur jumlah pukulan yang dibutuhkan untuk menghancurkan balok.
* **Farmable Flag (`property_farmable`)**: Aktifkan agar balok dapat di-farm / pohon dapat dipanen.
* **Blocked Place (`property_blocked`)**: Cegah balok ditaruh di sembarang tempat.
* **Drop Seeds & Block Chance**: Atur persentase drop bibit dan balok.

### 4. ⚡ Sinkronisasi Langsung ke Server (Zero Restart)
- Perubahan disimpan secara atomik ke database `edit_itemv2.json`.
- Terintegrasi dengan port internal C++ server Project-D (`:8888`), sehingga modifikasi item dapat langsung aktif di dalam game tanpa perlu mematikan atau me-restart server.

---

## 🚀 Panduan Instalasi & Menjalankan

### Cara 1: Menjalankan di Linux VPS (Local Server)

```bash
# 1. Masuk ke direktori
cd /root/ProjectD-Admin

# 2. Install dependensi
npm install

# 3. Jalankan server (port 3001)
npm start

# Atau jalankan dengan PM2 agar aktif terus di latar belakang:
pm2 start server.js --name "projectd-admin"
```

Akses web admin di browser:
```
http://IP_VPS_ANDA:3001
```

### Cara 2: Deploy ke Vercel (Cloud Hosting)

1. Fork atau gunakan repositori ini di akun GitHub Anda: `ihyakdg/ProjectD-Admin`.
2. Buka [Vercel Dashboard](https://vercel.com) $\rightarrow$ **Add New Project**.
3. Import repositori `ProjectD-Admin`.
4. Tambahkan Environment Variable (opsional):
   - `REMOTE_GAME_SERVER`: `http://secretxz.duckdns.org`
   - `PROJECT_D_ADMIN_TOKEN`: Token admin server Anda.
5. Klik **Deploy**!

---

## 📁 Struktur Direktori

```
ProjectD-Admin/
├── data/
│   ├── items_dict.json       # Katalog 31,000+ item Growtopia
│   ├── edit_itemv2.json      # Database modifikasi item live
│   └── staff_audit_logs.json # Log riwayat perubahan oleh staff
├── public/
│   ├── index.html            # Web Dashboard SPA (Modern Dark UI)
│   └── js/
│       └── app.js            # Frontend Client Logic & Live Editor
├── server.js                 # Express Backend & API Engine
├── vercel.json               # Konfigurasi deployment Vercel
└── package.json              # Konfigurasi dependensi project
```

---

## 🔒 Keamanan
- Dilengkapi dengan sistem token sesi staff yang aman.
- Setiap aksi modifikasi item tercatat secara otomatis di sistem audit log (nama staff, role, ID item, dan waktu perubahan).

---
*Dibuat khusus untuk ekosistem Project-D GTPS.*
