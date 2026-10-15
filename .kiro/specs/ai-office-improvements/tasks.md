# Implementation Plan: AI Office Improvements

## Overview

Implementasi dalam Python (backend, test pytest + Hypothesis) dan JavaScript vanilla (Pustaka_JS animasi dan web statis), mengikuti pola kode yang sudah ada. Urutannya: fondasi (config, state machine, DB, helper murni), perbaikan folder pengiriman, suara/lisensi, profil channel, peringatan musik + agregator status, Penasihat Keamanan, batch + Penjadwal, Pengunggah_YouTube, katalog animasi, cache klip + render paralel + timing, rework web pixel-art, lalu dokumentasi. Setiap tugas dirangkai ke kode yang sudah ada, sehingga tidak ada kode yatim. Semua test berjalan tanpa jaringan, GPU, LLM, maupun kredensial asli (Req 10.1).

## Tasks

- [ ] 1. Fondasi config dan dependensi test
  - [-] 1.1 Tambahkan Hypothesis ke dependensi test dan profil `ci`
    - Tambahkan `hypothesis==6.168.5` di bagian Testing `requirements.txt` (versi dipin `==`)
    - Daftarkan `settings.register_profile("ci", max_examples=100, deadline=None)` di `tests/conftest.py` dan muat profilnya
    - _Requirements: 10.1_

  - [-] 1.2 Perluas `_build()` di `ai_office/config.py`
    - Dukung `X | None` untuk dataclass bersarang dan skalar
    - Cek tipe ketat `int`/`float`/`str`/`bool` (bool ditolak untuk int/float), terima `dict` untuk field `dict[...]`
    - Pertahankan penolakan kunci tidak dikenal
    - _Requirements: 10.9, 10.12_

  - [~] 1.3 Tambahkan dataclass config baru dan validasinya di `ai_office/config.py`
    - `SafetyLLMConfig`, `SafetyConfig.llm`/`facts_file`, `ScheduleConfig`, `YouTubeConfig`, `AnimationCacheConfig`, `AnimationConfig`, `ContentConfig.monetized`, `VoiceConfig.voices`/`block_noncommercial` (semua default mempertahankan perilaku lama)
    - `AppConfig.effective_safety_llm()` (merge per field, pemetaan `gemini_model`)
    - `validate()` + `validate_youtube(cfg) -> list[str]` untuk semua rentang baru; pesan `ConfigError` menyebut nama kunci dan nilai/rentang; override env `AI_OFFICE_YOUTUBE_DIR`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.18, 5.1, 5.7, 5.10, 5.11, 5.12, 5.20, 7.1, 7.2, 7.7, 7.11, 9.17, 10.12_

  - [~] 1.4 Tulis property test penggabungan `safety.llm`
    - **Property 8: Penggabungan `safety.llm` per field**
    - **Validates: Requirements 3.1, 3.2**
    - File: `tests/test_config_new.py`

  - [~] 1.5 Tulis property test penolakan nilai config tidak valid
    - **Property 9: Nilai config baru yang tidak valid ditolak dengan nama kunci**
    - **Validates: Requirements 3.3, 3.4, 4.18, 5.20, 7.11, 9.17, 10.12**
    - File: `tests/test_config_new.py`

  - [~] 1.6 Tulis unit test kompatibilitas config lama dan nilai default
    - `config.yaml` lama tanpa bagian baru dimuat tanpa error; default `monetized`, `block_noncommercial`, `voices`, `youtube.enabled`
    - _Requirements: 5.1, 7.1, 7.2, 7.7, 7.12, 10.9_
    - File: `tests/test_config_new.py`

- [ ] 2. State machine baru
  - [-] 2.1 Perbarui `ai_office/models.py`
    - Tambah `JobStatus.SCHEDULED`, `JobStatus.UPLOADING`, `AgentName.UPLOADER`, `STAGE_AGENT[UPLOADING]`
    - Tambah transisi `scheduled→queued`, `delivering→uploading`, `uploading→done|failed`
    - Tambah konstanta `PIPELINE_AGENTS` (6 agent) dan `PIPELINE_STAGES` (7 tahap)
    - _Requirements: 4.11, 5.2, 5.3, 5.17, 10.10_

  - [~] 2.2 Tulis unit test transisi baru
    - `scheduled` tidak runnable/tidak terminal, transisi ilegal ditolak, `failed→uploading` diizinkan
    - _Requirements: 4.11, 5.17_
    - File: `tests/test_state_machine.py`

- [ ] 3. Helper murni: penyamaran rahasia dan topik
  - [-] 3.1 Buat `ai_office/redact.py`
    - `mask_secrets(text, secrets)` menangani rahasia tumpang-tindih/berulang/bersambung (rahasia panjang ≥ 8)
    - `Redactor` (registry rahasia thread-safe) + `logging.Filter` untuk root logger
    - _Requirements: 5.13_

  - [~] 3.2 Tulis property test penyamaran rahasia
    - **Property 13: Penyamaran rahasia tidak membocorkan nilai lengkap**
    - **Validates: Requirements 5.13**
    - File: `tests/test_redact.py` (termasuk contoh filter logging)

  - [-] 3.3 Buat `ai_office/topics.py`
    - `normalize_topic`, `parse_topic_lines`, `LineOutcome`, `plan_batch` (konstanta `MAX_LINES=500`, `MAX_TOPIC_LEN=200`)
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9_

  - [~] 3.4 Tulis property test idempotensi normalisasi
    - **Property 1: Normalisasi topik idempoten**
    - **Validates: Requirements 4.9**
    - File: `tests/test_topics_batch.py`

  - [~] 3.5 Tulis property test klasifikasi batch
    - **Property 2: Klasifikasi batch lengkap dan konsisten**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
    - File: `tests/test_topics_batch.py`

  - [~] 3.6 Tulis property test metamorfik jumlah job batch
    - **Property 3: Jumlah job batch tidak melebihi topik unik**
    - **Validates: Requirements 4.8**
    - File: `tests/test_topics_batch.py`

- [ ] 4. Database: migrasi berversi dan Timing_Tahap
  - [~] 4.1 Ubah `Database._migrate` di `ai_office/db.py` menjadi migrasi berversi
    - `PRAGMA user_version` + cek `table_info` (idempoten untuk DB lama)
    - Kolom `normalized_topic`, `batch_id`, `released_at` + indeks; tabel `stage_timings` dan `youtube_slots`; backfill `normalized_topic` dalam satu transaksi
    - `Job` mendapat field baru; `create_job()` mengisi `normalized_topic`; `admin_dict()` menambah `batch_id`; `public_dict()` tidak berubah
    - _Requirements: 4.5, 4.14, 9.1, 10.9_

  - [~] 4.2 Tambahkan API timing dan log di `ai_office/db.py`
    - `record_stage(job_id, stage, duration, ok)` menulis `stage_timings` dan menambah `processing_sec` dalam satu transaksi (menggantikan `add_processing_time`)
    - `get_stage_timings(job_id)`, `timing_summary(n)`, `has_log(job_id, message)`
    - _Requirements: 9.1, 9.4, 9.6, 2.7_

  - [~] 4.3 Tulis property test ringkasan timing
    - **Property 21: Ringkasan timing sesuai oracle**
    - **Validates: Requirements 9.4**
    - File: `tests/test_timings.py`

  - [~] 4.4 Tulis unit test migrasi DB lama
    - DB versi lama (tanpa kolom baru) dimigrasi tanpa kehilangan data; migrasi kedua tidak mengubah apa pun
    - _Requirements: 10.9_
    - File: `tests/test_db_migration.py`

- [ ] 5. Orchestrator: fondasi tahap baru
  - [~] 5.1 Tambahkan `AgentContext.log_once(key, msg, level)` di `ai_office/agents/base.py`
    - Memakai `db.has_log` sehingga retry tidak menggandakan log
    - _Requirements: 2.7, 7.9_

  - [~] 5.2 Perbarui `ai_office/orchestrator.py`
    - `_next_after(stage)` (DELIVERING → UPLOADING bila `youtube.enabled`, selain itu DONE)
    - `_run_stage` memakai `record_stage` dengan `elapsed` yang sama, mengisi `active_job_id`, dan menyamarkan pesan error lewat `Redactor`
    - `progress()` dari `PIPELINE_STAGES` (total 6 atau 7); `__init__` mewajibkan `PIPELINE_AGENTS` (+ `UPLOADER` bila YouTube aktif); `AgentTracker.snapshot()` memakai `PIPELINE_AGENTS`
    - `_release_llm()` dedup per `(name, base_url, model)` dan lewati provider tanpa `release` (Gemini)
    - _Requirements: 3.14, 3.15, 5.2, 5.3, 5.4, 9.1, 9.6, 10.10, 11.25_

  - [~] 5.3 Tambahkan `FakeUploader` di `ai_office/agents/fake.py`
    - Daftarkan di `build_fake_agents` tanpa mengubah perilaku test lama
    - _Requirements: 5.21, 10.1_

  - [~] 5.4 Tulis property test invarian Timing_Tahap vs `processing_sec`
    - **Property 20: Jumlah Timing_Tahap sama dengan `processing_sec`**
    - **Validates: Requirements 9.6, 9.1**
    - File: `tests/test_timings.py`

- [~] 6. Checkpoint - Fondasi
  - Jalankan `pytest -q`. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Folder pengiriman unik (perbaikan bug)
  - [~] 7.1 Perbarui `ai_office/agents/delivery.py`
    - `folder_base_name(date_utc, job_id, title)` berformat `YYYYMMDD_<id>_<slug>`
    - `allocate_dest(root, base, job_id)`: `mkdir(exist_ok=False)` untuk `base`, `base-2`…`base-100`, file marker `.ai_office_job`, pakai ulang folder bermarker job yang sama
    - Retry memakai `artifacts.delivery.dest_dir` (dibuat ulang + salin ulang bila terhapus); `OSError` → `AgentError` dengan path tanpa mencatat artefak
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [~] 7.2 Tulis property test format dan keunikan nama folder
    - **Property 15: Nama Folder_Tujuan berformat benar dan unik per job**
    - **Validates: Requirements 6.1, 6.2**
    - File: `tests/test_delivery.py`

  - [~] 7.3 Tulis property test alokasi folder
    - **Property 16: Alokasi folder memilih nama kosong pertama tanpa menimpa**
    - **Validates: Requirements 6.3, 6.4, 6.5**
    - File: `tests/test_delivery.py`

  - [~] 7.4 Tulis unit test skenario pengiriman
    - Dua job judul sama di tanggal sama → dua folder berisi `video.mp4`/`script.json` identik byte dengan sumber masing-masing; retry tidak menambah folder; folder terhapus dibuat ulang; `dest_dir` tidak bisa ditulis
    - _Requirements: 6.6, 6.7, 6.8, 6.9, 6.10_
    - File: `tests/test_delivery.py`

- [ ] 8. Lisensi suara dan suara per bahasa
  - [~] 8.1 Perbarui `ai_office/agents/voice.py` dan engine edge-tts
    - `resolve_voice(voice_cfg, language) -> (nama, fallback)`; `EdgeTTSEngine.with_voice(name)` mengembalikan instance baru
    - Blokir XTTS (`monetized and block_noncommercial`) dengan `AgentError` sebelum `synthesize` pertama
    - Fallback → `ctx.log_once("voice_fallback", ...)` level WARNING
    - _Requirements: 7.6, 7.8, 7.9_

  - [~] 8.2 Perbarui perintah CLI `voice-file`/`build-file` di `ai_office/cli.py`
    - Pakai `script.language` untuk memilih suara
    - _Requirements: 7.8_

  - [~] 8.3 Tulis property test resolusi suara
    - **Property 17: Resolusi suara per bahasa**
    - **Validates: Requirements 7.8, 7.9, 7.10**
    - File: `tests/test_voice.py`

  - [~] 8.4 Tulis unit test blokir XTTS dan log fallback
    - Tidak ada file audio saat diblokir; log fallback tepat sekali walau retry
    - _Requirements: 7.6, 7.9_
    - File: `tests/test_voice.py`

- [ ] 9. Profil channel
  - [~] 9.1 Buat `ai_office/profile.py`
    - `ChannelProfile` (pydantic, `extra="ignore"`, validator usia), `ProfileResult`, `load_profile` (tidak raise, tidak menulis), `dump_profile`, `profile_display_name`
    - Error pydantic dikelompokkan per field (satu pesan per field)
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.11, 8.12, 8.13, 11.13_

  - [~] 9.2 Buat `content_profile.example.yaml`
    - Semua field terisi, minimal 1 item per daftar, lulus validasi
    - _Requirements: 8.1, 8.2_

  - [~] 9.3 Hubungkan profil ke `ai_office/agents/writer.py` dan startup (`run.py`)
    - Penulis memakai profil hanya bila `status == "ok"`; error profil dicetak ke log startup
    - _Requirements: 8.7, 8.8, 8.12, 8.13_

  - [~] 9.4 Tulis property test validasi profil per field
    - **Property 18: Validasi Profil_Channel per field, tanpa menulis file**
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7**
    - File: `tests/test_profile.py`

  - [~] 9.5 Tulis property test round-trip profil
    - **Property 19: Round-trip Profil_Channel**
    - **Validates: Requirements 8.11**
    - File: `tests/test_profile.py`

  - [~] 9.6 Tulis unit test profil
    - File contoh valid; file tidak ada; YAML rusak/bukan mapping; nama display "AI Office"; Penulis tanpa bagian profil
    - _Requirements: 8.1, 8.2, 8.8, 8.12, 8.13, 11.13_
    - File: `tests/test_profile.py`

- [ ] 10. Peringatan musik latar dan agregator status
  - [~] 10.1 Perbarui `ai_office/editor/music.py`
    - `BGM_EXTS = (".mp3", ".wav", ".m4a", ".ogg")`, `is_bgm_empty(bgm_dir)` hanya memindai file langsung, case-insensitive
    - _Requirements: 2.1_

  - [~] 10.2 Perbarui `ai_office/editor/editor.py`
    - Bila `music.enabled` dan BGM kosong: `ctx.log_once("bgm_empty", ...)` WARNING menyebut path, artefak `bgm_missing`, video tetap jadi tanpa musik
    - _Requirements: 2.7, 2.8, 2.9_

  - [~] 10.3 Buat `ai_office/status.py`
    - `Warning` dataclass, `collect_warnings(config, profile)` (bgm_empty, voice_license, voice_lang_mismatch, profile_*, youtube_credentials_missing), `public_flags(config)`; dihitung ulang setiap panggilan
    - _Requirements: 2.1, 2.2, 2.6, 2.9, 5.19, 7.3, 7.5, 7.10, 8.7, 8.9, 8.10, 8.12, 11.61_

  - [~] 10.4 Perbarui `cmd_doctor` di `ai_office/cli.py`
    - Cetak semua item `collect_warnings` per level; tangkap `ConfigError` sebagai error; exit code tetap hanya dari ketersediaan agent
    - _Requirements: 2.2, 2.3, 5.19, 5.20, 7.3, 8.7, 8.9, 8.10, 8.12, 8.13_

  - [~] 10.5 Tulis property test peringatan BGM kosong
    - **Property 10: Peringatan musik latar kosong muncul tepat pada kondisinya**
    - **Validates: Requirements 2.1, 2.9**
    - File: `tests/test_warnings.py`

  - [~] 10.6 Tulis unit test doctor dan peringatan lisensi
    - Exit code doctor tidak terpengaruh peringatan; lisensi suara (parametrize monetized × engine); BGM ditambah → peringatan hilang tanpa restart; log Editor sekali per job
    - _Requirements: 2.2, 2.3, 2.6, 2.7, 2.8, 7.3, 7.5_
    - File: `tests/test_warnings.py`

- [~] 11. Checkpoint - Pengiriman, suara, profil, peringatan
  - Jalankan `pytest -q`. Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Penasihat Keamanan: LLM terpisah dan Daftar_Fakta
  - [~] 12.1 Buat `ai_office/facts.py`
    - `FactEntry`, `FactsLoad`, `FactsError`, `parse_facts`, `dump_facts`, `load_facts` (tidak raise), `match_facts` (pakai `normalize_topic`)
    - _Requirements: 3.6, 3.7, 3.9, 3.10_

  - [~] 12.2 Perbarui `ai_office/agents/safety.py` dan `SafetyReport` di `ai_office/schemas.py`
    - Field `llm_provider`, `llm_model`, `facts_used` (default kompatibel)
    - Sisipkan blok `RUJUKAN FAKTA TERVERIFIKASI` + log jumlah; log INFO bila tidak cocok; tanpa log bila tidak dikonfigurasi; WARNING path + alasan bila file rusak
    - Bungkus `LLMError`/timeout menjadi `AgentError` yang menyebut `provider:model`
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.9, 3.11_

  - [~] 12.3 Pisahkan provider safety di `build_agents` (`ai_office/agents/__init__.py`)
    - `build_provider(config.effective_safety_llm())`, pakai instance yang sama bila identik dengan `config.llm`; `SafetyAgent.is_available()` memakai provider-nya sendiri
    - _Requirements: 3.1, 3.2, 3.12, 3.13, 3.14_

  - [~] 12.4 Tulis property test round-trip Daftar_Fakta
    - **Property 5: Round-trip Daftar_Fakta**
    - **Validates: Requirements 3.10**
    - File: `tests/test_facts.py`

  - [~] 12.5 Tulis property test pencocokan fakta
    - **Property 6: Pencocokan fakta tepat dan lengkap**
    - **Validates: Requirements 3.6, 3.7**
    - File: `tests/test_facts.py`

  - [~] 12.6 Tulis property test pemuatan fakta tanpa exception
    - **Property 7: Pemuatan Daftar_Fakta tidak pernah melempar**
    - **Validates: Requirements 3.9**
    - File: `tests/test_facts.py`

  - [~] 12.7 Tulis unit test Penasihat Keamanan
    - Log INFO/WARNING per cabang; provider/model di artefak; kegagalan LLM → `failed@safety_review`; availability offline/online; pelepasan VRAM dedup dan Gemini dilewati
    - _Requirements: 3.5, 3.7, 3.8, 3.9, 3.11, 3.12, 3.13, 3.14, 3.15_
    - File: `tests/test_facts.py`

- [ ] 13. Batch dan Penjadwal
  - [~] 13.1 Tambahkan operasi batch dan rilis di `ai_office/db.py`
    - `create_batch_jobs(...)` dalam satu `BEGIN IMMEDIATE` (baca `existing`, `plan_batch`, insert semua, `batch_id` UUID4 hex, status `scheduled` atau `queued`+`released_at`)
    - `release_scheduled(quota, day_start, day_end, now)` dengan UPDATE bersyarat `status='scheduled'`
    - _Requirements: 4.1, 4.5, 4.10, 4.11, 4.12, 4.14_

  - [~] 13.2 Buat `ai_office/batch.py`
    - `BatchReport`, `BatchError`, `BatchService.submit_text` (tolak > 500 baris sebelum menulis), `submit_file` (decode `utf-8-sig` strict, file tidak ada → `BatchError`)
    - _Requirements: 4.1, 4.2, 4.7, 4.15, 4.16_

  - [~] 13.3 Buat `ai_office/scheduler.py`
    - `local_day_bounds`, `plan_release`, `Scheduler(config, db, bus, clock)` dengan `tick()` yang mempublikasikan `job_status`; tanpa `jobs_per_day` semua `scheduled` dilepas
    - _Requirements: 4.10, 4.11, 4.12, 4.14_

  - [~] 13.4 Hubungkan Penjadwal ke worker di `ai_office/orchestrator.py`
    - `tick()` di awal `start_worker()` dan setiap putaran `_worker_loop`
    - _Requirements: 4.10, 4.13, 4.14_

  - [~] 13.5 Tambahkan perintah `batch <file> [--allow-duplicates]` di `ai_office/cli.py`
    - Cetak laporan; exit 0 bila berhasil, 2 bila `BatchError` dengan pesan ke stderr
    - _Requirements: 4.1, 4.6, 4.7, 4.15_

  - [~] 13.6 Tambahkan `POST /api/admin/batch` di `ai_office/web/api.py`
    - `require_admin` + `require_csrf`; batas 200.000 karakter; > 500 baris → 400 `maksimal 500 baris`; respons `BatchReport`
    - _Requirements: 4.2, 4.6, 4.7, 4.16, 4.17, 10.3, 10.4_

  - [~] 13.7 Tulis property test kuota Penjadwal
    - **Property 4: Penjadwal menghormati kuota per Hari_Lokal**
    - **Validates: Requirements 4.10, 4.11, 4.14**
    - File: `tests/test_scheduler.py` (clock tiruan, DB `tmp_path`, contoh tanpa `jobs_per_day`)

  - [~] 13.8 Tulis unit test edge case batch CLI dan API
    - File non-UTF-8/tidak ada/> 500 baris → nol job + exit ≠ 0; API 400/401/403 tanpa membuat job; laporan total = jumlah baris
    - _Requirements: 4.7, 4.15, 4.16, 4.17_
    - File: `tests/test_topics_batch.py`

- [ ] 14. Pengunggah YouTube
  - [~] 14.1 Buat `ai_office/youtube/__init__.py`, `client.py`, dan `upload.py`
    - `YouTubeError` + subkelas kuota/auth/jaringan, Protocol `YouTubeClient`
    - Fungsi murni `tags_length`, `fit_tags`, `build_upload_body` (`selfDeclaredMadeForKids: True` hardcode, `private` bila `publish_at`, `categoryId "27"`), `next_publish_slot`
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

  - [~] 14.2 Tambahkan `reserve_publish_slot(job_id, base, interval, now)` di `ai_office/db.py`
    - Tabel `youtube_slots` dalam `BEGIN IMMEDIATE`; pakai ulang slot job yang sama bila masih ≥ now+60 menit
    - _Requirements: 5.9_

  - [~] 14.3 Buat `ai_office/agents/uploader.py`
    - `UploaderAgent(config, client_factory)`: lewati upload bila artefak/`youtube_result.json` sudah ada; `validate_youtube` gagal → `AgentError` tanpa memanggil client; baca metadata + video dari Folder_Tujuan (fallback workdir); tulis `youtube_result.json` segera setelah id didapat
    - Daftarkan `client.secrets()` ke `Redactor`; kuota → `AgentError("kuota habis")`; error lain disamarkan
    - Artefak `{video_id, url, privacy, publish_at}`
    - _Requirements: 5.5, 5.9, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.20_

  - [~] 14.4 Buat `ai_office/youtube/google_client.py`, `requirements-youtube.txt`, dan perintah CLI `youtube-auth`
    - Import lazy Google API; refresh token + tulis ulang atomik; upload resumable; pemetaan `HttpError` ke error bertipe
    - `requirements-youtube.txt`: `google-api-python-client==2.201.0`, `google-auth-oauthlib==1.5.0`
    - `youtube-auth` di `ai_office/cli.py` memakai `InstalledAppFlow.run_local_server(host="127.0.0.1")` dengan scope `youtube.upload`
    - _Requirements: 5.11, 5.12, 5.15, 5.16_

  - [~] 14.5 Hubungkan uploader ke `build_agents` dan orchestrator
    - `ai_office/agents/__init__.py` membuat `UploaderAgent` hanya bila `youtube.enabled`; `ai_office/orchestrator.py` mewajibkan `UPLOADER` saat itu
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [~] 14.6 Tulis property test body unggah
    - **Property 11: Body unggah YouTube memenuhi batas dan aman anak**
    - **Validates: Requirements 5.5, 5.6, 5.9**
    - File: `tests/test_youtube.py`

  - [~] 14.7 Tulis property test slot publikasi
    - **Property 12: Slot publikasi paling awal, valid, dan unik**
    - **Validates: Requirements 5.9**
    - File: `tests/test_youtube.py`

  - [~] 14.8 Tulis property test satu job satu video
    - **Property 14: Satu job menghasilkan maksimal satu video YouTube**
    - **Validates: Requirements 5.18, 5.17**
    - File: `tests/test_youtube.py`

  - [~] 14.9 Tulis unit test uploader dengan `FakeYouTubeClient`
    - Sukses, kuota habis, auth, jaringan (pesan tersamar), retry hanya tahap unggah dengan artefak delivery tidak berubah, nol panggilan saat nonaktif, config tidak valid tanpa panggilan API
    - _Requirements: 5.4, 5.13, 5.14, 5.15, 5.16, 5.17, 5.20, 5.21, 10.10_
    - File: `tests/test_youtube.py`

  - [~] 14.10 Tulis property test gerbang persetujuan
    - **Property 28: Gerbang persetujuan tidak pernah dilewati secara tidak sah**
    - **Validates: Requirements 10.5, 10.6, 10.7, 10.8, 4.13, 5.2, 5.3**
    - File: `tests/test_gates.py`

- [~] 15. Checkpoint - Keamanan, batch, YouTube
  - Jalankan `pytest -q`. Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Perluasan katalog animasi
  - [~] 16.1 Perbarui `catalog.yaml`, `catalog.py`, dan `schemas.py`
    - Karakter `pipo`, `lala`; latar `forest`, `space`, `city`, `kitchen`, `snow`; kategori `kendaraan`, `anggota_tubuh`, `huruf` (26), `angka` (11), `emosi`; template `sequence` dan `match` (`pairs: true`)
    - `TemplateSpec.items_even`, tolak nama objek duplikat lintas kategori, pesan `scene_errors` untuk jumlah ganjil/di luar batas, `prompt_listing()` menyebut aturan pasangan
    - `SceneParams.items` dan `script_json_schema` `max 8`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 1.15, 1.16_

  - [~] 16.2 Tambahkan karakter dan latar baru di Pustaka_JS
    - `characters.js`: `pipo` dan `lala` via `makeChar` dengan pose/emosi bersama; `backgrounds.js`: 5 latar baru
    - _Requirements: 1.2, 1.3, 1.4, 1.13_

  - [~] 16.3 Tambahkan objek baru di `scenes/objects.js`
    - Kendaraan, anggota tubuh, emosi (SVG vektor); `huruf_a…z` dan `angka_0…10` dihasilkan dalam loop (ubin + `A.bigText`)
    - _Requirements: 1.5, 1.6, 1.7, 1.13_

  - [~] 16.4 Tambahkan template `T.sequence` dan `T.match` di `scenes/templates.js`
    - Sequence: pop-in berurutan + `A.numberBadge(i+1)`, tetap terlihat sampai akhir; Match: semua objek tampil lalu garis per pasangan selesai sebelum `dur − EXIT_SEC`
    - _Requirements: 1.10, 1.12, 1.13_

  - [~] 16.5 Tulis property test validator naskah
    - **Property 27: Validator naskah menolak nama dan jumlah item di luar Katalog**
    - **Validates: Requirements 1.15, 1.16**
    - File: `tests/test_animation.py`

  - [~] 16.6 Tulis unit test struktur katalog dan sinkronisasi Katalog/JS
    - Struktur 1.1–1.9; helper `catalog_diff` + `test_catalog_matches_js_library` per kategori dengan laporan nama yang hanya ada di satu sisi
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 1.14, 1.19, 1.20_
    - File: `tests/test_animation.py`

  - [~] 16.7 Tulis test Node untuk `sequence`, `match`, dan `validatePlan`
    - Via `tests/js_harness.mjs` (skip bila Node tidak ada): urutan pop-in dan badge, semua garis lengkap sebelum akhir scene, entri hilang ditolak dengan `scene <id>` + nama
    - _Requirements: 1.10, 1.12, 1.18_
    - File: `tests/test_animation.py`

- [ ] 17. Cache klip, render paralel, dan ringkasan timing
  - [~] 17.1 Buat `ai_office/animation/scene_render.py` (bagian murni)
    - `RENDERER_VERSION`, `library_hash()`, `canonical_json`, `split_frames(plan, fps)`, `scene_key(...)` mencakup scene, `prev`/`next`, plan non-scene, waktu frame, resolusi, fps, hash pustaka, tanda tangan renderer
    - _Requirements: 9.8, 9.13_

  - [~] 17.2 Buat `ai_office/animation/cache.py`
    - `ClipCache`: `get` (hapus entri 0 byte/tak terbaca, `os.utime`), `put` atomik via `os.replace` (tangani target sedang dibuka di Windows), `pin`/`unpin` dengan lock, `evict` LRU yang melewati pin
    - _Requirements: 9.7, 9.9, 9.11, 9.15, 9.18_

  - [~] 17.3 Perbarui `renderer/render.py` dan `renderer/encode.py`
    - `renderer.thread_session()` (thread-local `sync_playwright` + browser + page); callback `progress` setiap frame dan `RenderCancelled`
    - `encode_frames_to_mp4(..., cancel=None)` dengan `Popen` + `terminate()`/`kill()` setelah 2 detik; `concat_clips(paths, out)` via demuxer concat `-c copy`
    - _Requirements: 9.12, 9.14_

  - [~] 17.4 Tambahkan `ParallelSceneRenderer` di `ai_office/animation/scene_render.py`
    - `ThreadPoolExecutor(N)` menjaga `min(N, sisa)` tugas aktif; kegagalan pertama → `cancel.set()`, tunggu ≤ 10 detik, `AgentError` dengan indeks scene; hapus temp scene gagal
    - _Requirements: 9.12, 9.13, 9.14, 9.15_

  - [~] 17.5 Perbarui `ai_office/agents/animator.py`
    - Jalur lama dipertahankan persis bila cache mati dan `parallel_scenes == 1`
    - Jalur baru: split, kunci, pin, get/miss, render paralel, put, concat, unpin; log `Cache: <hit> ... <miss> ...` di `finally`; artefak `cache_hits`, `cache_misses`, `parallel`
    - _Requirements: 9.7, 9.10, 9.11, 9.12, 9.16, 9.18, 10.9_

  - [~] 17.6 Tambahkan perintah `timings [--last N]` di `ai_office/cli.py`
    - N 1..1000 (default 20), rata-rata 2 desimal + jumlah sampel per tahap; tanpa job done → `Belum ada job selesai.` exit 0
    - _Requirements: 9.4, 9.5_

  - [~] 17.7 Tulis property test Kunci_Scene
    - **Property 22: Kunci_Scene deterministik dan sensitif terhadap masukan**
    - **Validates: Requirements 9.8**
    - File: `tests/test_clip_cache.py`

  - [~] 17.8 Tulis property test pembagian frame
    - **Property 23: Pembagian frame mempertahankan timeline**
    - **Validates: Requirements 9.13, 1.17**
    - File: `tests/test_clip_cache.py`

  - [~] 17.9 Tulis property test round-trip cache dan pemakaian ulang
    - **Property 24: Round-trip Cache_Klip dan pemakaian ulang**
    - **Validates: Requirements 9.7, 9.9, 9.10**
    - File: `tests/test_clip_cache.py`

  - [~] 17.10 Tulis property test eviksi LRU
    - **Property 25: Eviksi LRU menghormati batas dan pin**
    - **Validates: Requirements 9.11**
    - File: `tests/test_clip_cache.py`

  - [~] 17.11 Tulis property test konfluensi render paralel
    - **Property 26: Render paralel konfluen dengan render berurutan**
    - **Validates: Requirements 9.12, 9.13**
    - File: `tests/test_clip_cache.py`

  - [~] 17.12 Tulis unit test edge case cache, render, dan CLI timings
    - Klip 0 byte dihitung miss; kegagalan paralel menyebut indeks, tanpa klip parsial, ≤ 10 detik; jalur lama tidak berubah; CLI `timings` tanpa job done; render Chromium + concat nyata opsional (skip bila dependensi tidak ada)
    - _Requirements: 1.17, 9.5, 9.14, 9.15, 9.16, 9.18_
    - File: `tests/test_clip_cache.py`

- [~] 18. Checkpoint - Animasi dan performa
  - Jalankan `pytest -q`. Ensure all tests pass, ask the user if questions arise.

- [ ] 19. Rework web pixel-art
  - [~] 19.1 Tambahkan data dan endpoint baru di `ai_office/web/api.py`
    - `public_status()` dipakai `/api/status` dan snapshot SSE: `channel_name`, `music_unavailable`, `progress`, `summary.scheduled_jobs`
    - `GET /api/jobs?status=` opsional; `GET /api/admin/warnings`; `stage_timings` di detail job admin; field baru di `/api/admin/settings`; kontrak lama tidak berubah
    - _Requirements: 2.4, 2.5, 9.2, 11.12, 11.13, 11.25, 11.33, 11.36, 11.61, 11.76, 10.3_

  - [~] 19.2 Tambahkan font pixel dan ikon lokal di `web/static/`
    - `fonts/PressStart2P-Regular.woff2` + `fonts/OFL.txt` (SIL OFL 1.1); unduhan sekali dari sumber resmi font, dicatat di commit
    - `icons/*.svg` 16×16 berbasis `<rect>` dengan `shape-rendering="crispEdges"` (kantor, buat, batch, daftar, detail, pengaturan, logout, peringatan, avatar)
    - _Requirements: 11.6, 11.9, 11.63, 11.73_

  - [~] 19.3 Tulis ulang `web/static/style.css`
    - Token_Desain di `:root` (nilai literal hanya di sana), `@font-face` lokal, panel pixel, `.badge--<status>`, `.sr-only`, `:focus-visible`, `.table-scroll`, media query `<768px`, `image-rendering: pixelated`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.7, 11.8, 11.10, 11.44, 11.45, 11.50, 11.66, 11.68, 11.72_

  - [~] 19.4 Buat `web/static/common.js`
    - `el()`, `fmtDuration()`, `STATUS_LABELS` (mencakup semua `JobStatus`), `badge()`, `live()` (throttle 1 detik), `fetchJSON`, `allowedActions(status)`, `backoffDelay(n) ≤ 10000`; semua data via `textContent`
    - _Requirements: 11.34, 11.50, 11.57, 11.58, 11.59, 11.60, 11.71, 11.77_

  - [~] 19.5 Buat `web/static/sprites.js` dan `web/static/office_model.js` (murni)
    - Peta pixel + palet sprite agent dan perabot; `layout()` dunia 320×180 dengan 6 meja + monitor + kursi, tanaman, rak buku, dispenser, sofa; `spriteFrame(state, tMs, reducedMotion)`; `STATE_LABEL`; `progressLabel`; pemecahan label per kata
    - _Requirements: 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.23, 11.25, 11.26_

  - [~] 19.6 Buat `web/static/office.js`
    - Canvas skala lebar kontainer aspek 16:9, `imageSmoothingEnabled=false`, letterbox, label nama + status di plat kontras, tunggu `document.fonts.load`; loop rAF hanya tanpa reduced motion (listener `change`); `setStates()` juga memperbarui `#office-list`
    - _Requirements: 11.10, 11.14, 11.15, 11.20, 11.21, 11.22, 11.23, 11.24, 11.66_

  - [~] 19.7 Tulis ulang `web/static/index.html` dan `web/static/app.js`
    - Urutan Top_Bar, Kantor_Pixel (`role="img"` + daftar sr-only), Bottom_Bar (`role="progressbar"` + `aria-*`, "Agent Bekerja x/6"), Kartu_Ringkasan (termasuk menunggu jadwal + indikator musik), daftar video selesai + empty state, `#live`
    - SSE manual dengan backoff, indikator terputus setelah 10 detik, `refreshAll()` saat `onopen`, debounce 200 ms; tanpa inline style/script/handler dan tanpa Aset_Eksternal
    - _Requirements: 2.5, 11.5, 11.11, 11.12, 11.13, 11.22, 11.24, 11.25, 11.26, 11.27, 11.28, 11.29, 11.30, 11.31, 11.32, 11.33, 11.34, 11.35, 11.36, 11.37, 11.71, 11.73, 11.79_

  - [~] 19.8 Tulis ulang `web/static/admin.html` dan `web/static/admin.js`
    - Top_Bar (brand, `<label>` + select job, tombol menu `aria-expanded`, avatar + "Admin"); Sidebar_Navigasi (Kantor, 5 Bagian_Admin, Log Out); router `showSection` dengan `aria-current` dan fokus heading
    - `api()` dengan timeout 30 detik, `X-CSRF-Token` untuk non-GET, 401 → `location.replace("/admin")`; `runAction` mempertahankan input dan mengaktifkan kembali tombol
    - Form batch + laporan; daftar job + empty state "belum ada job"; detail job (naskah, review + provider/model, tabel timing/"data timing belum tersedia", Folder_Tujuan, tautan YouTube tervalidasi, error tahap gagal, aksi sesuai `allowedActions`); Banner_Peringatan dari `/api/admin/warnings` dengan ikon + label
    - _Requirements: 2.4, 4.2, 4.6, 4.16, 7.4, 9.2, 9.3, 11.38, 11.39, 11.40, 11.41, 11.42, 11.43, 11.44, 11.45, 11.46, 11.47, 11.48, 11.49, 11.51, 11.52, 11.53, 11.54, 11.55, 11.56, 11.57, 11.58, 11.59, 11.60, 11.61, 11.62, 11.63, 11.64, 11.65, 11.67, 11.69, 11.70, 11.75, 11.77, 11.79_

  - [~] 19.9 Tulis property test data publik
    - **Property 29: Data publik tidak membocorkan informasi admin**
    - **Validates: Requirements 11.36**
    - File: `tests/test_api.py`

  - [~] 19.10 Tulis unit test API
    - Kontrak lama tetap ada; field baru `/api/status`; `?status=done`; warnings; `stage_timings`; test parametrik semua route `/api/admin/*` → 401 tanpa sesi dan 403 tanpa CSRF; server default bind `127.0.0.1`
    - _Requirements: 10.2, 10.3, 10.4, 11.36, 11.76_
    - File: `tests/test_api.py`

  - [~] 19.11 Tulis test statis web
    - Parsing `style.css` (token, HSL navy, kontras WCAG, literal hanya di `:root`); parsing HTML (tanpa `style=`, `<style>`, script inline, `on*`, URL eksternal; label input; ikon `alt=""`/`aria-hidden`); font + OFL dapat diambil dari server; CSP tanpa `unsafe-*`; `innerHTML` tidak dipakai untuk data
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.66, 11.69, 11.70, 11.73, 11.74, 11.77, 11.78_
    - File: `tests/test_web_static.py`

  - [~] 19.12 Tulis test JS murni web via Node
    - `tests/js_web_harness.mjs` + `tests/test_web_js.py` (skip bila Node tidak ada): `layout()`, `spriteFrame`, `progressLabel`, `fmtDuration`, `backoffDelay`, `allowedActions`, `STATUS_LABELS` mencakup semua `JobStatus`
    - _Requirements: 11.14, 11.15, 11.16, 11.17, 11.18, 11.19, 11.20, 11.23, 11.25, 11.26, 11.34, 11.37, 11.50, 11.57, 11.58, 11.59, 11.60_

- [ ] 20. Dokumentasi dan contoh config
  - [~] 20.1 Perbarui `config.yaml`
    - Bagian baru (`content.monetized`, `safety.llm`, `safety.facts_file`, `schedule`, `youtube`, `voice.voices`, `voice.block_noncommercial`, `animation`) dengan komentar Bahasa Indonesia; default mempertahankan perilaku lama
    - _Requirements: 10.9, 10.11_

  - [~] 20.2 Perbarui `README.md` dan `data/bgm/README.md`
    - Tabel pengaturan baru (nama, default, nilai diizinkan); panduan musik (YouTube Audio Library, Pixabay Music, format, lokasi); batch, Penjadwal, `youtube-auth` + `requirements-youtube.txt`, `timings`, profil contoh; catatan batasan pin cache antar-proses
    - _Requirements: 2.10, 10.11_

- [~] 21. Final checkpoint
  - Jalankan `pytest -q` dari root repo. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tugas bertanda `*` opsional dan bisa dilewati untuk MVP yang lebih cepat
- Setiap tugas merujuk kriteria requirement untuk keterlacakan
- Property test memakai Hypothesis (`max_examples=100`), satu test per properti, dengan komentar `# Feature: ai-office-improvements, Property <n>: <judul>`
- Unit test melengkapi property test untuk contoh spesifik dan edge case
- Kriteria visual/latensi (11.24, 11.29, 11.31, 11.72) dan uji pembaca layar tetap perlu verifikasi manual; validasi WCAG penuh butuh pengujian dengan teknologi bantu
- Task 19.2 membutuhkan unduhan file font sekali; test tidak membutuhkan jaringan

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "3.3", "7.1", "9.1", "10.1", "16.2", "16.3", "16.4", "17.2", "19.2"] },
    { "id": 1, "tasks": ["1.3", "2.2", "3.2", "3.4", "4.1", "7.2", "9.2", "12.1", "14.1", "16.1", "17.1", "19.3"] },
    { "id": 2, "tasks": ["1.4", "3.5", "4.2", "7.3", "8.1", "9.3", "9.4", "10.3", "12.4", "16.5", "17.3", "19.4"] },
    { "id": 3, "tasks": ["1.5", "3.6", "4.3", "4.4", "5.1", "7.4", "8.2", "9.5", "10.5", "12.2", "12.5", "13.1", "16.6", "17.4", "19.5"] },
    { "id": 4, "tasks": ["1.6", "5.2", "8.3", "9.6", "10.2", "12.3", "12.6", "13.2", "14.2", "16.7", "17.5", "19.6"] },
    { "id": 5, "tasks": ["5.3", "8.4", "10.4", "12.7", "13.3", "14.3", "17.7", "19.1"] },
    { "id": 6, "tasks": ["10.6", "13.4", "13.6", "14.4", "17.8", "19.7"] },
    { "id": 7, "tasks": ["13.5", "13.7", "14.5", "14.6", "17.9", "19.8"] },
    { "id": 8, "tasks": ["13.8", "14.7", "17.6", "17.10", "19.9"] },
    { "id": 9, "tasks": ["5.4", "14.8", "17.11", "19.10", "19.11"] },
    { "id": 10, "tasks": ["14.9", "14.10", "17.12", "19.12", "20.1", "20.2"] }
  ]
}
```
