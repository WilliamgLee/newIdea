# AI Office

Sistem multi-agent lokal untuk membuat video YouTube Shorts edukasi anak (1080x1920, ±30 detik),
lengkap dengan dashboard "kantor" yang menampilkan status tiap agent.

> **Status: M6.** Keenam agent asli, plus dashboard web dengan **panel admin berpassword**
> (buat job, approve/tolak dua gerbang, lihat log & review). Tersisa M7 (kantor 2.5D + poles).
> README lengkap di M7.

## Instalasi (Windows 11)

Prasyarat: Python 3.11+ (dites dengan 3.11 dan 3.14) dan Git.

```powershell
git clone https://github.com/WilliamgLee/newIdea.git
cd newIdea
py -m venv .venv
.venv/Scripts/Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

> Kalau PowerShell menolak menjalankan `Activate.ps1`, jalankan dulu sekali:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

### Ollama (LLM lokal, gratis)

1. Pasang Ollama: `winget install Ollama.Ollama` (atau unduh dari https://ollama.com/download).
2. Tutup lalu buka PowerShell baru, unduh model default (±4,7 GB, muat di VRAM 6 GB):
   ```powershell
   ollama pull qwen2.5:7b
   ```
3. Cek: `python -m ai_office.cli doctor` → writer & safety harus `siap`.

Ollama berjalan otomatis di latar (ikon di system tray). Model lain bisa dipakai dengan
mengubah `llm.model` di `config.yaml`.

**Opsional – Gemini free tier:** isi `GEMINI_API_KEY` di `.env`, lalu ubah `llm.provider: gemini`.

### Opsional: suara Coqui XTTS-v2 (lokal, kualitas tinggi)

> **Bahasa:** XTTS-v2 **tidak mendukung Bahasa Indonesia**. Bahasa yang didukung: en, es, fr,
> de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, hu, ko, ja, hi. Untuk konten **English**, XTTS bagus;
> untuk **Indonesia**, pakai edge-tts.
>
> **Lisensi:** XTTS-v2 (CPML) **melarang penggunaan komersial**. Untuk channel yang
> dimonetisasi, pakai edge-tts. XTTS cocok untuk pemakaian pribadi/belajar.

XTTS berjalan lokal tanpa internet dan bisa meniru suara (voice cloning), tapi berat
(~2 GB model, ~4 GB VRAM) dan belum mendukung Python 3.14. Pakai venv Python 3.11 terpisah:

```powershell
py -3.11 -m venv .venv-xtts
.venv-xtts\Scripts\Activate.ps1
pip install -r requirements.txt
# GPU (disarankan): torch DAN torchaudio versi CUDA
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements-xtts.txt
python -m playwright install chromium
```

Lalu di `config.yaml` set `voice.engine: xtts` dan pastikan `content.language` serta
`voice.xtts.language` **bukan `id`** (mis. `en`). Coba dengan naskah Inggris:
```powershell
python -m ai_office.cli build-file examples/colors_en.json
```
Pengaturan XTTS ada di `voice.xtts` (bahasa, `speaker` bawaan, atau `speaker_wav` berisi contoh
suara 6-15 detik untuk voice cloning, device).

**Windows + Smart App Control:** DLL matplotlib (`ft2font`) kadang diblokir dan menggagalkan
impor XTTS. Kode otomatis memasang matplotlib tiruan (`voice.xtts.stub_matplotlib: true`);
matplotlib tidak dipakai saat membuat suara, jadi ini aman. Jika tetap bermasalah, pakai
edge-tts. **Versi paket** yang terbukti jalan sudah dikunci di `requirements-xtts.txt`
(transformers 4.56.2; torch+torchaudio dari index cu124).

**VRAM 6 GB (RTX 4050):** Ollama (LLM) dan XTTS tidak muat bersamaan. Sistem otomatis
melepas Ollama dari VRAM sebelum tahap suara (`keep_alive=0`), dan melepas XTTS setelah
tiap job (`voice.xtts.unload_after_job: true`), sehingga keduanya bergantian memakai GPU.
Jika tetap kehabisan VRAM, set `voice.xtts.device: cpu` (lebih lambat).

**Mencoba tanpa Ollama:** tambahkan `writer` dan `safety` ke `agents.fake` di `config.yaml`.

### ffmpeg + suara (M2)

1. Pasang ffmpeg: `winget install Gyan.FFmpeg`, lalu buka PowerShell baru dan cek `ffmpeg -version`.
2. Suara memakai **edge-tts** (gratis, sudah ada di `requirements.txt`, butuh internet).
3. Coba suara dari naskah buatan tangan, tanpa LLM:
   ```powershell
   python -m ai_office.cli voice-file examples/mengenal_warna.json
   ```
   Hasil: `output/manual_mengenal_warna/audio/scene_*.wav` + `voice.json` (timing per kata).

Pengaturan suara ada di bagian `voice:` pada `config.yaml` (suara `id-ID-GadisNeural` /
`id-ID-ArdiNeural`, kecepatan, jeda antar-scene, target loudness). Durasi tiap scene mengikuti
panjang suara sebenarnya + jeda. Jika total < 25 detik, jeda ditambah; jika > 35 detik, suara
dipercepat sekali; jika tetap > 60 detik, job gagal dengan pesan "perpendek narasi".

### Animasi (M3)

1. Pasang browser untuk render (sekali saja, setelah `pip install`):
   ```powershell
   python -m playwright install chromium
   ```
2. Coba buat klip animasi dari naskah buatan tangan (tanpa LLM):
   ```powershell
   python -m ai_office.cli render-file examples/mengenal_warna.json            # dengan suara
   python -m ai_office.cli render-file examples/mengenal_warna.json --no-voice  # tanpa suara (cepat)
   ```
   Hasil: `output/manual_mengenal_warna/animation.mp4` (1080x1920, 30 fps, H.264, tanpa audio) +
   `plan.json`. Audio/subtitle/musik digabung Editor di M4.

Pustaka animasi ada di `ai_office/animation/`:
- `renderer/core.js` — inti (SVG, lip-sync, timeline); `characters/characters.js` — Kiki & Bubu;
  `scenes/backgrounds.js`, `scenes/objects.js`, `scenes/templates.js` — latar, 29 objek, 6 template.
- `style_guide.md` — aturan warna, font, dan gerak. `catalog.yaml` — daftar nama valid (yang
  dilihat Penulis). Test memastikan `catalog.yaml` selalu cocok dengan pustaka JS.
- Render **deterministik**: tiap frame = `renderFrame(plan, t)`, 30 fps, 1080x1920, lalu ffmpeg
  menyusun PNG jadi MP4 (NVENC bila GPU NVIDIA ada, jika tidak `libx264`).

### Video final (M4 - Editor)

Menggabungkan klip animasi + suara + subtitle + musik jadi `video.mp4`, plus thumbnail & metadata:

```powershell
python -m ai_office.cli build-file examples/mengenal_warna.json
```

Hasil di `output/manual_mengenal_warna/`: `video.mp4` (vertikal, ±30 detik, dengan suara & subtitle
sinkron), `thumbnail.png`, `metadata.txt`, `metadata.json`.

- **Subtitle**: besar, outline tebal, **kata yang sedang diucapkan di-highlight** (pakai timing
  per kata dari Pengisi Suara). Atur di bagian `subtitle:` pada `config.yaml`.
- **Musik latar**: taruh file di `data/bgm/` (lihat `data/bgm/README.md`). Satu lagu dipilih
  otomatis dan **volumenya turun saat ada narasi** (ducking). Atur di bagian `music:`.
  Jika `data/bgm/` kosong, video dibuat tanpa musik.
- **metadata.txt** memuat judul, deskripsi, hashtag, dan **pengingat menandai video "Made for
  kids"** saat upload.

## Menjalankan test

```powershell
pytest -q
```

Semua test LLM memakai mock, jadi tidak butuh Ollama.

## Cara pakai (M1)

```powershell
# terminal 1
python run.py

# terminal 2
python -m ai_office.cli create "hewan dan suaranya"
python -m ai_office.cli list            # tunggu status awaiting_script_approval
python -m ai_office.cli review 1        # baca naskah + hasil review keamanan
python -m ai_office.cli approve-script 1
python -m ai_office.cli approve-final 1 # setelah status awaiting_final_approval
```

Atau tanpa server: `python -m ai_office.cli demo "mengenal warna"` (gerbang disetujui otomatis).

Perintah CLI lain:

| Perintah | Fungsi |
|---|---|
| `review <id>` | naskah + hasil review keamanan per kriteria |
| `show <id>` | detail lengkap (JSON) + log |
| `approve-script <id> --file naskah.json` | setujui dengan naskah hasil editan (divalidasi) |
| `reject <id> --reason "..."` | tolak di gerbang |
| `retry <id>` | ulangi job gagal dari tahap yang gagal |
| `mode semi_auto` / `mode full_auto` | ganti mode tanpa restart |
| `doctor` | cek koneksi LLM, edge-tts, ffmpeg & status agent |
| `voice-file <naskah.json>` | buat suara + timing dari naskah buatan tangan (tanpa LLM) |
| `render-file <naskah.json> [--no-voice]` | buat klip animasi dari naskah buatan tangan (tanpa LLM) |
| `build-file <naskah.json>` | video final lengkap (suara+animasi+subtitle+musik) tanpa LLM |

## Alur naskah

1. **Penulis** meminta LLM membuat `script.json`. Hanya nama template/karakter/pose/objek dari
   `ai_office/animation/catalog.yaml` yang diterima. Output yang tidak valid dikirim balik ke LLM
   beserta pesan error (maks. `pipeline.max_llm_retries` = 2 kali).
2. **Penasihat Keamanan** menilai naskah per kriteria di `safety_rubric.yaml` (LLM) **ditambah**
   pemeriksaan otomatis (kata terlarang, link, email, nomor telepon, kalimat terlalu panjang).
   Lulus hanya jika keduanya ok.
3. Jika `revise`, naskah + alasan + saran dikirim balik ke Penulis (maks. 2 revisi). Jika masih
   gagal, job berhenti di Gerbang 1 menunggu admin — juga di mode `full_auto`.

## Konfigurasi

- `config.yaml` – semua pengaturan (mode, durasi, LLM, suara, folder tujuan, dll.).
- `safety_rubric.yaml` – rubrik keamanan anak + daftar kata terlarang (boleh diubah).
- `content_profile.yaml` – profil konten channel (boleh diisi belakangan).
- `.env` – rahasia (API key opsional, secret key sesi). Jangan di-commit.

## Endpoint API (publik & hanya-baca)

| Endpoint | Isi |
|---|---|
| `GET /api/health` | cek server hidup |
| `GET /api/status` | ringkasan + status 6 agent |
| `GET /api/jobs` | daftar job (data publik saja) |
| `GET /api/jobs/{id}` | status satu job |
| `GET /api/events` | stream SSE: `snapshot`, `job_created`, `job_status`, `agent_state` |

Endpoint yang mengubah data (aksi admin lewat web) baru tersedia di M6, dengan login.

## Panel admin & keamanan (M6)

Buat kredensial admin dulu (interaktif, password tidak tampil, hanya HASH argon2id disimpan):
```powershell
python scripts/set_admin.py
```
Lalu jalankan server dan buka panel admin:
```powershell
python run.py
```
- Dashboard publik (hanya-baca, tanpa login): http://127.0.0.1:8000
- Panel admin (wajib login): http://127.0.0.1:8000/admin

Di panel admin kamu bisa: buat job (topik/usia/gaya), approve/edit/tolak di Gerbang 1 & 2,
lihat log + hasil review keamanan, ubah mode semi/full-auto, dan retry job gagal. CLI lama
(`python -m ai_office.cli ...`) tetap berfungsi.

**Keamanan yang diterapkan:**
- Password di-hash **argon2id**; `data/admin.json` di-gitignore, izin file 600. Password tidak
  pernah ditulis ke kode/log/repo.
- Verifikasi login **hanya di server**. Sesi lewat cookie **HttpOnly + SameSite=Strict**
  (+`Secure` saat HTTPS), session id acak **ditandatangani (HMAC)**, dengan kedaluwarsa.
- **Proteksi CSRF** (double-submit token) untuk semua aksi yang mengubah data.
- **Rate-limit + lockout** sementara setelah beberapa kali gagal login; pesan error generik;
  perbandingan password **waktu-konstan**.
- Semua endpoint `/api/admin/*` mengecek sesi di server (bukan sekadar menyembunyikan tombol).
- Header keamanan (CSP, X-Frame-Options, dll.). Server **hanya bind ke localhost** secara default.

### Membuka ke publik dengan aman (opsional) — Cloudflare Tunnel

Server sengaja hanya di `127.0.0.1`. Untuk mengaksesnya dari luar **tanpa membuka port router**
dan **dengan HTTPS gratis**, pakai Cloudflare Tunnel:
```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel --url http://127.0.0.1:8000
```
Cloudflare memberi URL `https://...trycloudflare.com` yang meneruskan ke laptopmu lewat HTTPS.
Catatan: **laptop harus tetap menyala** selama tunnel aktif. Untuk URL tetap + kontrol akses,
buat named tunnel dan tambahkan Cloudflare Access di dashboard Cloudflare. Jangan set
`server.host: 0.0.0.0` kecuali kamu paham risikonya.

## Pengiriman hasil (M5)

Setelah video final disetujui (Gerbang 2) atau di mode `full_auto`, Pengirim menyalin hasil ke
`delivery.dest_dir` (default `~/Videos/AI-Office/<tanggal>_<judul-slug>/`): `video.mp4`,
`thumbnail.png`, `script.json`, `metadata.txt`. Lalu folder itu **dibuka otomatis** di file
explorer (bisa dimatikan dengan `delivery.open_folder: false`). Semua agent kini asli; untuk
mencoba sebagian tanpa Ollama/ffmpeg, isi `agents.fake` di `config.yaml` (mis. `[voice, animator,
editor]`).
