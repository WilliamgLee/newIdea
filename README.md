# AI Office

Sistem **multi-agent lokal** untuk membuat video **YouTube Shorts edukasi anak** secara otomatis
(vertikal 1080x1920, sekitar 30 detik), lengkap dengan **dashboard "kantor" 2.5D** yang
menampilkan status tiap agent secara real-time.

Enam "pegawai" AI bekerja berurutan. Semua berjalan di komputermu sendiri dan **gratis**
(pembuatan video sehari-hari tidak memanggil API berbayar):

```
topik -> Penulis Naskah -> Penasihat Keamanan -> [Gerbang 1]
      -> Pengisi Suara -> Pembuat Animasi -> Editor -> [Gerbang 2] -> Pengirim -> video.mp4
```

---

## Daftar isi
1. [Konsep singkat](#konsep-singkat)
2. [Prasyarat](#prasyarat)
3. [Instalasi langkah demi langkah](#instalasi-langkah-demi-langkah)
4. [Membuat admin & menjalankan](#membuat-admin--menjalankan)
5. [Membuat video](#membuat-video)
6. [Pilihan suara (TTS)](#pilihan-suara-tts)
7. [Konfigurasi](#konfigurasi)
8. [Keamanan](#keamanan)
9. [Membuka ke publik (opsional)](#membuka-ke-publik-opsional)
10. [Menambah template, karakter, objek](#menambah-template-karakter-objek)
11. [Struktur proyek](#struktur-proyek)
12. [Testing & troubleshooting](#testing--troubleshooting)

---

## Konsep singkat

- **Input**: sebuah topik (mis. "learn colors") + usia + gaya. Niche belum dikunci; isi
  `content_profile.yaml` sesukamu.
- **Proses**: LLM lokal menulis naskah → diperiksa rubrik keamanan anak → suara dibuat per scene
  dengan timing per kata → animasi SVG dirender deterministik jadi klip → digabung dengan subtitle
  (highlight per kata) + musik → disalin ke folder tujuan dan dibuka otomatis.
- **Dua gerbang persetujuan** (mode `semi_auto`): setelah naskah, dan setelah video final.
  Mode `full_auto` melewati gerbang **hanya jika** review keamanan lulus.
- **Output**: `video.mp4` + `thumbnail.png` + `script.json` + `metadata.txt`.

---

## Prasyarat

- **Windows 11** (dites), juga jalan di macOS/Linux.
- **Python 3.11+** (dites 3.11 dan 3.14) dan **Git**.
- **ffmpeg** (untuk suara, animasi, video).
- **Ollama** (LLM lokal) — atau Gemini free tier.
- Opsional: **GPU NVIDIA** (encoding NVENC & LLM/XTTS lebih cepat). Tanpa GPU tetap jalan di CPU.

---

## Instalasi langkah demi langkah

```powershell
git clone https://github.com/WilliamgLee/newIdea.git
cd newIdea
py -m venv .venv
.venv/Scripts/Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m playwright install chromium
copy .env.example .env
```

> Jika PowerShell menolak `Activate.ps1`, jalankan sekali:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### ffmpeg

```powershell
winget install Gyan.FFmpeg
```
Tutup lalu buka PowerShell baru, cek: `ffmpeg -version`. (Varian "full" diperlukan agar NVENC
tersedia; jika tidak, encoding otomatis memakai `libx264` di CPU.)

### Ollama (LLM lokal, gratis)

```powershell
winget install Ollama.Ollama
```
Tutup lalu buka PowerShell baru, unduh model:
```powershell
ollama pull qwen2.5:3b
```
> **VRAM 6 GB (mis. RTX 4050):** `qwen2.5:3b` (±2 GB) muat PENUH di GPU dan cepat. Hindari
> `qwen2.5:7b` saat juga memakai XTTS: model bisa jatuh sebagian ke CPU dan membuat generate
> lambat/timeout. Cek beban dengan `ollama ps` (idealnya `100% GPU`).

Cek semua siap: `python -m ai_office.cli doctor`.

**Opsional — Gemini free tier** (lebih pintar soal fakta, tidak memakai VRAM): isi
`GEMINI_API_KEY` di `.env`, lalu set `llm.provider: gemini` di `config.yaml`.

---

## Membuat admin & menjalankan

Buat kredensial admin (interaktif; password tidak tampil, hanya **hash argon2id** disimpan):
```powershell
python scripts/set_admin.py
```

Jalankan semuanya dengan **satu perintah**:
```powershell
python run.py            # tamb. --open untuk membuka browser otomatis
```
- Dashboard publik (kantor 2.5D, hanya-baca): http://127.0.0.1:8000
- Panel admin (wajib login): http://127.0.0.1:8000/admin

---

## Membuat video

### Cara A — lewat panel admin (disarankan)
Buka `/admin`, login, isi topik lalu **Buat**. Di mode `semi_auto`, job berhenti di dua gerbang;
klik **Approve naskah** lalu **Approve final**. Lihat **Detail** untuk naskah + hasil review.

### Cara B — lewat CLI
```powershell
python -m ai_office.cli demo "learn colors"      # 1 job sampai done, gerbang auto-approve
python -m ai_office.cli create "animal sounds"   # buat job (diproses server)
python -m ai_office.cli list
python -m ai_office.cli review 3                 # naskah + review keamanan
python -m ai_office.cli approve-script 3
python -m ai_office.cli approve-final 3
python -m ai_office.cli mode full_auto           # lewati gerbang bila review lulus
```

### Tanpa LLM (dari naskah buatan tangan)
```powershell
python -m ai_office.cli build-file examples/colors_en.json   # suara+animasi+video final
python -m ai_office.cli render-file examples/colors_en.json --no-voice  # cek animasi cepat
```

> **Tips topik untuk model kecil (3B):** pilih yang konkret dan sederhana (warna, bentuk,
> hitung 1-5, nama buah, suara hewan). Topik yang butuh fakta rumit (mis. bendera negara)
> bisa ditolak Penasihat Keamanan karena model kecil rawan salah fakta — pakai Gemini untuk itu.

Hasil akhir muncul di `~/Videos/AI-Office/<tanggal>_<judul>/` dan foldernya terbuka otomatis.

---

## Pilihan suara (TTS)

Atur di `voice.engine` pada `config.yaml`:

| Engine | Bahasa | Catatan |
|---|---|---|
| `edge-tts` (default) | **ID & EN** | Gratis, natural, **butuh internet**. Pilihan terbaik untuk Bahasa Indonesia. |
| `xtts` | EN & 16 bahasa lain (**bukan ID**) | Lokal/offline, kualitas tinggi, berat (~4 GB VRAM). Lisensi **non-komersial**. Lihat `requirements-xtts.txt`. |

XTTS perlu Python 3.11 + venv terpisah (`requirements-xtts.txt`). Di GPU kecil, Ollama dilepas
dari VRAM sebelum tahap suara dan XTTS dilepas setelah job, agar bergantian memakai GPU.

---

## Konfigurasi

- **`config.yaml`** — semua pengaturan: mode, durasi, LLM, suara, subtitle, musik, folder tujuan,
  dan `agents.fake` (daftar agent yang disimulasikan, untuk mencoba tanpa Ollama/ffmpeg).
- **`.env`** — rahasia: `GEMINI_API_KEY` (opsional), `AI_OFFICE_SECRET_KEY` (opsional; untuk
  tanda tangan sesi — jika kosong dibuat otomatis di `data/`).
- **`safety_rubric.yaml`** / **`safety_rubric_en.yaml`** — rubrik Penasihat Keamanan + daftar kata
  terlarang, per bahasa. Boleh kamu ubah.
- **`content_profile.yaml`** — profil channel (nama, niche, nada, frasa khas).

Beralih ke **full-auto** tanpa mengubah kode: set `pipeline.mode: full_auto` di `config.yaml`,
atau `python -m ai_office.cli mode full_auto`, atau lewat panel admin.

### Musik latar
Taruh file bebas hak cipta di `data/bgm/` (`.mp3/.wav/...`). Satu lagu dipilih otomatis dan
volumenya **turun saat ada narasi** (ducking). Folder kosong = video tanpa musik.

---

## Keamanan

- Password admin di-hash **argon2id**; `data/admin.json` (di-gitignore, izin 600) hanya menyimpan
  hash. Password tidak pernah ditulis ke kode/log/repo.
- Verifikasi login **hanya di server**. Sesi: cookie **HttpOnly + SameSite=Strict** (+`Secure`
  saat HTTPS), session id acak **ditandatangani HMAC**, ber-kedaluwarsa.
- **CSRF** (double-submit token) untuk semua aksi yang mengubah data.
- **Rate-limit + lockout** login, pesan error generik, perbandingan password waktu-konstan.
- Semua endpoint `/api/admin/*` mengecek sesi di server. Header keamanan (CSP, X-Frame-Options,
  dll.). Server **bind ke localhost** secara default.

---

## Membuka ke publik (opsional)

Server sengaja hanya `127.0.0.1`. Untuk akses dari luar **tanpa buka port** dan **HTTPS gratis**:
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8000
```
Cloudflare memberi URL `https://...trycloudflare.com`. **Laptop harus tetap menyala.** Untuk URL
tetap + kontrol akses, buat named tunnel + Cloudflare Access. Jangan set `server.host: 0.0.0.0`
kecuali paham risikonya.

---

## Menambah template, karakter, objek

Pustaka animasi ada di `ai_office/animation/`:
- **Objek baru**: tambah `A.objects.<nama> = (ctx) => <svg>` di `scenes/objects.js`, lalu daftarkan
  namanya di `animation/catalog.yaml` (bagian `objects`).
- **Karakter / latar / template baru**: tambah di `characters/characters.js` /
  `scenes/backgrounds.js` / `scenes/templates.js`, lalu daftarkan di `catalog.yaml`.
- `style_guide.md` mengunci warna, font, dan gaya gerak.
- Test `tests/test_animation.py` memastikan `catalog.yaml` (yang dilihat LLM) **selalu cocok**
  dengan pustaka JS, jadi LLM tidak pernah memakai nama yang tak ada.

Karakter kantor 2.5D ada di `web/static/office.js` (6 agent, meja + properti per peran, animasi
mengetik/idle/offline mengikuti status SSE).

---

## Struktur proyek

```
ai-office/
  run.py                      # satu perintah menjalankan server + worker
  config.yaml, .env.example, content_profile.yaml, safety_rubric*.yaml
  requirements.txt, requirements-xtts.txt
  scripts/set_admin.py        # buat kredensial admin (argon2id)
  examples/                   # naskah buatan tangan (colors_en.json, mengenal_warna.json)
  ai_office/
    orchestrator.py           # "Manajer": state machine job + worker
    config.py, db.py, models.py, events.py, media.py, schemas.py, bootstrap.py, cli.py
    llm/                      # provider: ollama (default), gemini
    tts/                      # edge-tts (default), xtts
    agents/                   # writer, safety, voice, animator, editor, delivery (+ fake)
    animation/                # catalog + style_guide + characters/scenes/renderer (SVG->ffmpeg)
    editor/                   # subtitle (.ass highlight), musik (ducking), metadata
    web/                      # api.py, auth.py, static/ (dashboard 2.5D + panel admin)
  data/                       # db, admin.json, bgm, cache (di-gitignore)
  output/                     # hasil render sementara
  tests/
```

---

## Testing & troubleshooting

```powershell
pytest -q
```

- **`doctor`**: `python -m ai_office.cli doctor` mengecek koneksi LLM, TTS, ffmpeg, status agent.
- **Agent "offline"**: dependensinya tidak terbaca. Untuk suara, cek engine (XTTS perlu
  `.venv-xtts`) dan `ffmpeg -version`.
- **`ReadTimeout` ke Ollama**: model terlalu besar untuk VRAM (cek `ollama ps`). Pakai
  `qwen2.5:3b`, atau set `voice.xtts.device: cpu`, atau `voice.engine: edge-tts`.
- **Job `failed` di penulisan**: Penasihat Keamanan menolak (mis. fakta salah). Itu normal; coba
  topik lebih sederhana atau pakai Gemini.
- **GPU 0% saat render frame**: wajar — menggambar SVG via Chromium itu tugas CPU. GPU dipakai di
  tahap suara (XTTS) dan encoding (NVENC bila tersedia).

Lisensi aset: XTTS-v2 (CPML, non-komersial). Untuk channel yang dimonetisasi, pakai edge-tts.
