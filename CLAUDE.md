# Kiki Classroom (dulu AI Office) — panduan untuk Claude

Pemilik proyek: William (GitHub `WilliamgLee`). Nama proyek: **Kiki Classroom** (paket Python tetap
`ai_office`; folder `newIdea` & repo GitHub akan di-rename sendiri oleh William). **Selalu balas dalam Bahasa Indonesia santai.**
Komentar kode, pesan log, dan teks UI proyek ini juga berbahasa Indonesia — ikuti gaya itu.

## Apa ini
Pipeline **multi-agent lokal** (Python 3.11, FastAPI) yang membuat **YouTube Shorts edukasi anak**
usia 3-6 (vertikal 1080x1920, ~30 detik), plus dashboard "kantor pixel 2.5D" real-time (SSE).

```
topik -> Penulis Naskah (LLM) -> Penasihat Keamanan (LLM + cek kode) -> [Gerbang 1: admin]
      -> Pengisi Suara (XTTS) -> Pembuat Animasi (SVG+Chromium) -> Editor (ffmpeg)
      -> [Gerbang 2: admin] -> Pengirim (salin ke ~/Videos/AI-Office) -> done
```
- AI hanya di 3 tempat: LLM (`qwen2.5:3b` via Ollama) di writer & safety, model suara XTTS di voice.
  Animasi/editor/delivery = kode deterministik. **Tidak ada training/fine-tuning** — inference +
  prompt engineering + JSON schema (structured output) + validasi/retry + LLM-as-judge.
- Mode `semi_auto` (2 gerbang) / `full_auto` (gerbang dilewati bila review lulus; disimpan di DB,
  bisa beda dengan `config.yaml`).
- Safety `revise` -> kembali ke writing (maks `max_safety_rounds`), lalu ke admin.

## Cara menjalankan (Windows, PowerShell)
- **Paling mudah:** `.\start.ps1` (opsi `-NoBrowser`, `-SkipDoctor`). Memilih `.venv-xtts`,
  cek ffmpeg, nyalakan Ollama, cek model, tawarkan buat admin, `doctor --quick`, cek port 8000,
  lalu `run.py --open`.
- Manual: `.venv-xtts\Scripts\Activate.ps1` lalu `python run.py --open`.
- **PENTING — dua venv:** `.venv` = Python 3.14 (tanpa PyTorch/XTTS); `.venv-xtts` = Python 3.11
  dengan PyTorch 2.6 cu124 + coqui-tts + semua requirements. **Server harus jalan dari `.venv-xtts`**
  karena `voice.engine: xtts`. Prompt tanpa `(.venv-xtts)` = Python sistem (tanpa argon2 dll.).
- Dashboard http://127.0.0.1:8000 (`?demo` = simulasi job), admin http://127.0.0.1:8000/admin.
- Reset password admin: `python scripts/set_admin.py` (username `william`, interaktif; jangan
  pernah mengetikkan password untuk user).

## Perintah penting
```
python -m pytest -q                         # ~270 test, ~1,5 menit, wajib hijau
python -m ai_office.cli doctor [--quick]    # cek lingkungan + agent
python -m ai_office.cli backup [--list]     # backup DB + admin.json ke data/backups
python -m ai_office.cli demo "learn colors" # 1 job sampai done di CLI
python -m ai_office.cli render-file examples/new_templates_en.json --no-voice  # cek animasi
python scripts/make_bgm.py [--force]        # buat 3 musik latar orisinal ke data/bgm
```
Untuk uji UI/agent tanpa menyentuh data user: buat config terpisah (port lain, `paths` ke folder
sementara, `agents.fake: [semua]`, `delivery.open_folder: false`) lalu `python run.py --config ...`.

## Peta kode
- `ai_office/orchestrator.py` state machine job + worker; `models.py` status/agent; `db.py` SQLite;
  `events.py` EventBus + AgentTracker (SSE); `config.py` dataclass config (kunci tak dikenal ditolak).
- `agents/` writer, safety, voice, animator, delivery, fake; `prompts/*_en.md|_id.md`;
  `facts.yaml` + `facts.py` = **kamus fakta** (warna wajar, bunyi hewan, sisi bentuk, hitungan)
  dicek tanpa LLM di `safety.automated_checks` (id kriteria en/id lewat alias `_criterion_id`).
- `schemas.py` Script/Scene (min 4-6 scene, durasi scene >= 2 dtk), `parse_script`,
  `normalize_age_group` ("6" -> "6-6"), `parse_safety_review` (duplikat kriteria digabung konservatif).
- `animation/catalog.yaml` = satu-satunya sumber nama template/objek/warna; harus cocok dengan
  `scenes/templates.js` dkk. (dites `test_animation.py`). 10 template: intro, show_object,
  count_objects, compare, guess, find_odd, pattern, color_change, sing_along, outro.
  Render JS wajib deterministik (tanpa Math.random/Date).
- `editor/` ffmpeg (subtitle highlight per kata, BGM loop + ducking); `tts/` edge & xtts.
- `web/api.py` FastAPI: CSP ketat (`default-src 'self'` — jangan pakai CDN/Google Fonts),
  `Cache-Control: no-cache` untuk UI, endpoint admin video `/api/admin/jobs/{id}/video|thumbnail`.
  `web/auth.py` argon2id, sesi HMAC, CSRF double-submit, rate-limit.
- `web/static/`: `office.js` (kantor pixel isometrik di kanvas 288x184, animasi serah-terima,
  font pixel 3x5 sendiri), `app.js` (dashboard + `?demo`), `sfx.js` (suara chiptune WebAudio,
  klik semua tombol, toggle M), `admin.js/html`, `style.css` (tema pixel, font Silkscreen lokal
  di `static/fonts/`, lisensi OFL).
- `backup.py` BackupScheduler (start bersama worker), `doctor.py` pemeriksaan lingkungan.
- `start.ps1` harus tetap **100% ASCII** (PowerShell 5.1 salah baca UTF-8 tanpa BOM).
- `.kiro/specs/ai-office-improvements/` = rencana peningkatan dari Kiro (requirements/design/tasks)
  — rujukan roadmap; sebagian sudah dikerjakan di luar spec (UI pixel, kamus fakta, BGM).

## Kebiasaan kerja yang disepakati
- Jangan commit/push tanpa diminta. Branch kerja saat ini `m7-office-polish`; remote GitHub
  `WilliamgLee/newIdea`. `data/`, `output/`, `.env`, `.venv*/` di-gitignore.
- Data user ada di `data/` (DB, admin.json, session key, bgm, backups) — jangan dihapus/ditimpa.
- Setelah ubah kode jalankan pytest; setelah ubah UI cek di browser (atau `?demo`).
  Setelah ubah static file, user cukup refresh (no-cache); perubahan Python butuh restart server.
- Upload YouTube ditunda (user masih ragu). Saringan topik berbahaya di awal belum dibuat
  (topik "kids porn" di DB adalah tes sengaja dari user). Mesin suara Piper sengaja TIDAK dibuat
  (user menunda). Proyek sengaja tidak dimonetisasi (lisensi XTTS non-komersial).
- Cerita portofolio (bahasa Inggris) ada di `docs/kiki-classroom-story.md`, disusun sebagai
  "Four rules the office follows" — sengaja tidak meniru kerangka jomontolalu.com/work. Latar
  cerita lengkap ada di memori `kiki-classroom-story`.
- Rencana berikutnya (hanya jika ada budget): fine-tuning model kecil dari naskah yang sudah
  di-approve, atau pindah ke API hosted + n8n sebagai orkestrator agar tidak jalan di laptop.
- Batasan yang tidak bisa diselesaikan lewat kode (VRAM 6 GB/RTX 4050, NVENC gagal di laptop ini,
  lisensi XTTS non-komersial, aturan YouTube, review manusia wajib) — lihat memori
  `ai-office-hard-limits`; pisahkan selalu "bisa dengan kode" vs "butuh biaya/di luar kendali".

## Masalah umum
- `ModuleNotFoundError: argon2` / `PyTorch not found` -> venv salah, pakai `.venv-xtts`.
- Tampilan web lama -> Ctrl+F5 sekali (versi lama tanpa no-cache).
- Job gagal di writing karena `age_group` -> sudah dinormalisasi; cek input usia.
- NVENC gagal -> otomatis libx264 (normal di laptop ini).
- Font Fredoka (teks video) belum terpasang -> pakai fallback; lihat `animation/fonts/README.md`.
