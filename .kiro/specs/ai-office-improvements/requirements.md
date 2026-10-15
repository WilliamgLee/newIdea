# Requirements Document

## Introduction

Dokumen ini mendefinisikan sekumpulan peningkatan untuk **AI Office**, pipeline multi-agent lokal (Python) yang membuat video YouTube Shorts edukasi anak (usia 3-6, vertikal 1080x1920, sekitar 30 detik). Alur yang ada: topik -> Penulis Naskah -> Penasihat Keamanan -> [Gerbang 1] -> Pengisi Suara -> Pembuat Animasi -> Editor -> [Gerbang 2] -> Pengirim.

Peningkatan mencakup: perluasan katalog animasi, peringatan musik latar kosong, pemeriksaan fakta dengan LLM terpisah, produksi batch/terjadwal, unggah opsional ke YouTube, perbaikan bug tabrakan folder pengiriman, opsi lisensi suara untuk channel monetisasi, template profil channel, caching/paralelisasi render dan pengukuran waktu per tahap, serta rework tampilan web (Dashboard dan Panel_Admin) dengan gaya pixel-art retro bertema navy gelap. Elemen antarmuka yang diwajibkan requirement lain (peringatan musik latar kosong, peringatan lisensi suara, form batch, timing per tahap, status/URL YouTube, dan Status_Menunggu_Jadwal) ditempatkan di tampilan hasil rework (Requirement 11).

Semua peningkatan WAJIB mempertahankan postur keamanan yang ada (server bind ke localhost, autentikasi admin argon2id, CSRF, rate-limit), mempertahankan dua gerbang persetujuan, dan tidak merusak test yang sudah ada.

Kata kunci pola EARS (WHEN, WHILE, IF/THEN, WHERE, THE, SHALL) sengaja ditulis dalam bahasa Inggris agar polanya tetap jelas; isi requirement ditulis dalam Bahasa Indonesia.

## Glossary

- **AI_Office**: keseluruhan aplikasi (server web, worker, CLI, agent).
- **Orchestrator**: "Manajer", state machine job dan worker di `ai_office/orchestrator.py`.
- **Job**: satu permintaan pembuatan video dengan status di database SQLite.
- **Gerbang_1**: status `awaiting_script_approval` (persetujuan naskah).
- **Gerbang_2**: status `awaiting_final_approval` (persetujuan video final).
- **Katalog**: file `ai_office/animation/catalog.yaml`, satu-satunya sumber nama karakter, pose, emosi, latar, warna, objek, dan template yang boleh dipakai di naskah.
- **Pustaka_JS**: implementasi animasi SVG di `animation/characters/characters.js`, `scenes/objects.js`, `scenes/backgrounds.js`, dan `scenes/templates.js`.
- **Validator_Naskah**: validasi naskah terhadap Katalog (`schemas.parse_script`).
- **Penulis**: agent Penulis Naskah (`agents/writer.py`).
- **Penasihat_Keamanan**: agent review keamanan anak (`agents/safety.py`).
- **Pengisi_Suara**: agent suara (`agents/voice.py`) dengan engine `edge-tts`, `xtts`, atau `piper`.
- **Pembuat_Animasi**: agent animasi (`agents/animator.py`) yang merender frame SVG via Chromium lalu meng-encode dengan ffmpeg.
- **Editor**: agent penggabung video, subtitle, dan musik latar.
- **Pengirim**: agent `agents/delivery.py` yang menyalin hasil ke folder tujuan.
- **Pengunggah_YouTube**: agent/tahap baru opsional yang mengunggah video ke YouTube via YouTube Data API.
- **Doctor**: perintah `python -m ai_office.cli doctor` untuk mengecek kesiapan dependensi.
- **CLI**: antarmuka baris perintah `python -m ai_office.cli`.
- **Panel_Admin**: halaman `/admin` dan endpoint `/api/admin/*` yang wajib login.
- **Dashboard**: halaman publik hanya-baca (Kantor_Pixel) dengan pembaruan SSE.
- **Folder_BGM**: folder musik latar `music.bgm_dir` (default `data/bgm`).
- **File_Musik**: file yang berada langsung di dalam Folder_BGM (tanpa memindai subfolder) dengan ekstensi `.mp3`, `.wav`, `.m4a`, atau `.ogg` (tidak peka huruf besar/kecil).
- **Folder_BGM_Kosong**: kondisi ketika Folder_BGM tidak ada atau tidak berisi satu pun File_Musik.
- **Provider_LLM**: implementasi LLM (`ollama` atau `gemini`) beserta nama modelnya.
- **Daftar_Fakta**: file opsional (`safety.facts_file`) berisi entri fakta terverifikasi per topik yang dipakai sebagai rujukan oleh Penasihat_Keamanan; setiap entri memiliki satu topik dan daftar fakta.
- **Daftar_Topik**: input batch berupa daftar topik (satu topik per baris atau file teks).
- **Topik_Ternormalisasi**: topik setelah huruf kecil, spasi berlebih dihapus, dan tanda baca di awal/akhir dihapus.
- **Penjadwal**: komponen yang melepaskan job batch ke antrean sesuai kuota harian.
- **Status_Menunggu_Jadwal**: status job batch yang ditahan Penjadwal karena kuota harian sudah habis.
- **Hari_Lokal**: rentang 00:00:00 sampai 23:59:59 waktu lokal mesin pada satu tanggal kalender.
- **Kredensial_OAuth**: file client secret dan token OAuth YouTube milik pengguna, disimpan di luar repo.
- **Rahasia_OAuth**: access token, client secret, dan refresh token yang terkandung dalam Kredensial_OAuth.
- **Metadata_Video**: judul, deskripsi, dan tag yang dihasilkan Editor (`metadata.json`/`metadata.txt`).
- **Folder_Tujuan**: folder per job yang dibuat Pengirim di dalam `delivery.dest_dir` (default `~/Videos/AI-Office/`).
- **Slug_Judul**: bentuk judul yang hanya berisi huruf kecil, angka, dan tanda hubung, maksimal 50 karakter, tanpa tanda hubung di awal/akhir, bernilai `video` bila hasilnya kosong.
- **Profil_Channel**: file `content_profile.yaml`.
- **Mode_Monetisasi**: pengaturan `content.monetized` yang menandakan channel dimonetisasi.
- **Cache_Klip**: penyimpanan klip video per scene yang dapat dipakai ulang, dengan kunci berupa hash isi scene.
- **Kunci_Scene**: hash deterministik dari semua masukan yang memengaruhi piksel klip scene (data scene, durasi, timing, resolusi, fps, versi Pustaka_JS, dan versi renderer).
- **Timing_Tahap**: durasi eksekusi tiap tahap/agent per job yang tercatat di database.
- **Status_Akhir**: status job `done` atau `failed`.
- **Test_Suite**: kumpulan test pytest di folder `tests/`.
- **Kantor_Pixel**: peta kantor pixel-art tampak atas (top-down) di Dashboard yang digambar `web/static/office.js` pada `<canvas id="office">`, berisi lantai ubin, dinding, meja dengan monitor, kursi, dan perabot, dengan setiap Agent_Pipeline digambar sebagai Sprite_Agent di mejanya.
- **Sprite_Agent**: gambar karakter pixel-art untuk satu Agent_Pipeline di Kantor_Pixel, beserta label nama di bawahnya, yang tampilan atau animasinya mencerminkan Status_Agent.
- **Aset_Pixel**: sprite, ubin (tile), dan ikon pixel-art yang dipakai Dashboard dan Panel_Admin, yang digambar secara programatik di canvas atau disimpan sebagai file SVG/PNG lokal di repo.
- **Font_Pixel**: file font bergaya pixel/bitmap berlisensi terbuka yang disertakan di repo dan disajikan dari origin AI_Office, beserta file lisensinya.
- **Top_Bar**: bilah horizontal di bagian atas Dashboard dan Panel_Admin yang berisi nama brand/channel dan kontrol atau informasi ringkas.
- **Sidebar_Navigasi**: kolom navigasi di sisi kiri Panel_Admin berisi item navigasi dengan ikon pixel dan label teks untuk setiap Bagian_Admin, serta item Log Out di bagian bawah.
- **Bottom_Bar**: bilah horizontal di bawah Kantor_Pixel di Dashboard yang berisi bar Progres_Job dan penghitung Agent Bekerja.
- **Job_Aktif**: job yang salah satu tahap pipeline-nya sedang dieksekusi worker; bila lebih dari satu, job dengan waktu mulai tahap paling awal.
- **Progres_Job**: pasangan nilai (jumlah tahap pipeline Job_Aktif yang sudah selesai berhasil, jumlah tahap pipeline yang berlaku), dengan jumlah tahap yang berlaku 6 (penulisan naskah, pemeriksaan keamanan, suara, animasi, editing, pengiriman) atau 7 bila `youtube.enabled` bernilai true (ditambah unggah YouTube).
- **Status_Agent**: salah satu dari `working`, `idle`, `offline`, atau `just_done` untuk setiap agent.
- **Agent_Pipeline**: enam agent yang ditampilkan di Dashboard: Penulis, Penasihat_Keamanan, Pengisi_Suara, Pembuat_Animasi, Editor, dan Pengirim.
- **Token_Desain**: variabel CSS (custom properties) di `web/static/style.css` untuk palet navy gelap (warna latar, panel, dan border), warna utama, warna aksen, warna teks, jarak (spacing), radius sudut, dan keluarga font (Font_Pixel dan font isi), yang dipakai bersama oleh Dashboard dan Panel_Admin.
- **Kartu_Ringkasan**: elemen panel bergaya pixel di Dashboard yang menampilkan satu angka atau nilai ringkasan beserta labelnya.
- **Lencana_Status**: elemen penanda status job yang memiliki warna latar khas per status dan label teks status.
- **Banner_Peringatan**: area di bagian atas Panel_Admin yang menampilkan daftar peringatan aktif (musik latar, lisensi suara, Profil_Channel, Kredensial_OAuth).
- **Bagian_Admin**: salah satu bagian navigasi Panel_Admin: Buat job, Batch, Daftar job, Detail job, dan Pengaturan/Status.
- **Wilayah_Live**: elemen dengan atribut `aria-live="polite"` atau `role="status"` yang dibacakan pembaca layar saat isinya berubah.
- **Aset_Eksternal**: file font, skrip, stylesheet, atau gambar yang dimuat dari origin selain origin server AI_Office.
- **CSP**: header `Content-Security-Policy` yang dikirim server (`SECURITY_HEADERS` di `web/api.py`).
- **Kontrak_API**: path, metode HTTP, field permintaan, dan field respons endpoint `/api/*` yang sudah ada sebelum peningkatan.

## Requirements

### Requirement 1: Perluasan katalog animasi

**User Story:** Sebagai pembuat konten, saya ingin pilihan karakter, latar, objek, dan template yang lebih banyak, sehingga topik video bisa lebih bervariasi.

#### Acceptance Criteria

1. THE Katalog SHALL berisi minimal 4 karakter, termasuk `kiki` dan `bubu`, dan setiap karakter SHALL memiliki deskripsi yang tidak kosong.
2. THE Katalog SHALL memberi setiap karakter daftar pose yang identik dengan daftar pose `kiki` (`idle`, `wave`, `point`, `jump`, `think`, `clap`).
3. THE Katalog SHALL memberi setiap karakter daftar emosi yang identik dengan daftar emosi `kiki` (`happy`, `excited`, `surprised`, `thinking`, `calm`).
4. THE Katalog SHALL berisi minimal 10 latar, termasuk 6 latar yang sudah ada, dan setiap latar SHALL memiliki deskripsi yang tidak kosong.
5. THE Katalog SHALL berisi kategori objek baru `kendaraan`, `anggota_tubuh`, `huruf`, `angka`, dan `emosi` dengan minimal 5 objek per kategori baru, sambil mempertahankan kategori `hewan`, `buah`, `bentuk`, dan `benda` beserta isinya.
6. THE Katalog SHALL berisi tepat 26 objek di kategori `huruf` yang mewakili huruf A sampai Z.
7. THE Katalog SHALL berisi tepat 11 objek di kategori `angka` yang mewakili angka 0 sampai 10.
8. THE Katalog SHALL memakai nama objek yang unik di seluruh kategori objek.
9. THE Katalog SHALL berisi template `sequence` dengan batas `items` 2 sampai 5.
10. WHEN scene dengan template `sequence` dirender, THE Pembuat_Animasi SHALL memunculkan objek satu per satu sesuai urutan di naskah, menampilkan penanda urutan 1 sampai N di dekat setiap objek, dan mempertahankan semua objek terlihat sampai akhir scene.
11. THE Katalog SHALL berisi template `match` dengan batas 2 sampai 4 pasangan (4 sampai 8 `items`, berjumlah genap), dengan item ke-(2k-1) dan item ke-2k membentuk pasangan ke-k.
12. WHEN scene dengan template `match` dirender, THE Pembuat_Animasi SHALL menampilkan semua objek terlebih dahulu, lalu menggambar garis penghubung untuk setiap pasangan satu per satu, sehingga semua pasangan terhubung sebelum scene berakhir.
13. THE Pustaka_JS SHALL menyediakan implementasi untuk setiap karakter, pose, emosi, latar, objek, dan template yang tercantum di Katalog.
14. THE Katalog SHALL mencantumkan setiap karakter, pose, emosi, latar, objek, dan template yang diimplementasikan di Pustaka_JS.
15. IF naskah memakai template `sequence` atau `match` dengan jumlah `items` di luar batas Katalog, atau template `match` dengan jumlah `items` ganjil, THEN THE Validator_Naskah SHALL menolak seluruh naskah sebelum render dengan pesan error yang menyebut nomor scene, nama template, jumlah `items` yang diberikan, dan batas yang diizinkan.
16. IF naskah memakai nama karakter, pose, emosi, latar, objek, warna, atau template yang tidak tercantum di Katalog, THEN THE Validator_Naskah SHALL menolak seluruh naskah sebelum render dengan pesan error yang menyebut nomor scene, jenis entri, dan nama yang tidak dikenal.
17. WHEN sebuah scene yang memakai entri baru Katalog dirender, THE Pembuat_Animasi SHALL menghasilkan klip berukuran tepat `video.width` x `video.height` dengan durasi sama dengan `duration_sec` scene (toleransi 1 frame).
18. IF Pustaka_JS tidak memiliki implementasi untuk entri yang dipakai scene saat render, THEN THE Pembuat_Animasi SHALL menghentikan render scene tersebut tanpa menyisakan klip parsial dan melaporkan nomor scene serta nama entri.
19. THE Test_Suite SHALL memverifikasi bahwa himpunan nama di Katalog sama persis dengan himpunan nama di Pustaka_JS untuk setiap kategori (karakter, pose, emosi, latar, objek, template).
20. IF himpunan nama di Katalog berbeda dari himpunan nama di Pustaka_JS, THEN THE Test_Suite SHALL gagal dengan laporan yang menyebut kategori, nama yang hanya ada di Katalog, dan nama yang hanya ada di Pustaka_JS.

### Requirement 2: Peringatan musik latar kosong

**User Story:** Sebagai admin, saya ingin diberi tahu bila musik latar aktif tetapi folder musik kosong, sehingga saya tidak tanpa sadar membuat video tanpa musik.

#### Acceptance Criteria

1. THE AI_Office SHALL menganggap Folder_BGM_Kosong terjadi bila Folder_BGM tidak ada atau bila tidak ada file langsung di dalam Folder_BGM (tanpa memindai subfolder) yang berekstensi `.mp3`, `.wav`, `.m4a`, atau `.ogg` dengan pencocokan ekstensi tidak peka huruf besar/kecil.
2. WHILE `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, THE Doctor SHALL menampilkan tepat satu peringatan level WARNING yang menyebut path Folder_BGM yang sudah di-resolve dan merujuk ke `data/bgm/README.md`.
3. WHILE `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, THE Doctor SHALL menetapkan hasil keseluruhan tanpa menghitung peringatan musik latar kosong sebagai kegagalan.
4. WHILE `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, WHEN halaman Panel_Admin dimuat, THE Panel_Admin SHALL menampilkan peringatan musik latar kosong yang menyebut path Folder_BGM.
5. WHILE `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, WHEN halaman Dashboard dimuat, THE Dashboard SHALL menampilkan indikator bahwa musik latar tidak tersedia.
6. WHEN halaman Panel_Admin atau Dashboard dimuat ulang setelah minimal satu File_Musik ditambahkan ke Folder_BGM, THE AI_Office SHALL menampilkan halaman tanpa peringatan musik latar kosong tanpa memerlukan restart server.
7. WHEN Editor memproses job sementara `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, THE Editor SHALL menulis tepat satu log job level WARNING per job yang menyatakan video dibuat tanpa musik latar dan menyebut path Folder_BGM.
8. WHEN Editor memproses job sementara terjadi Folder_BGM_Kosong, THE Editor SHALL menyelesaikan video tanpa musik latar dengan narasi tetap utuh dan melanjutkan job ke tahap berikutnya tanpa menandai job `failed`.
9. WHILE `music.enabled` bernilai false, THE AI_Office SHALL menekan peringatan musik latar kosong di Doctor, Panel_Admin, Dashboard, dan log job, apa pun isi Folder_BGM.
10. THE AI_Office SHALL mempertahankan panduan musik bebas hak cipta di `data/bgm/README.md` dan di README utama yang mencantumkan minimal satu sumber musik, format file yang didukung, dan lokasi Folder_BGM.

### Requirement 3: LLM terpisah dan daftar fakta untuk Penasihat Keamanan

**User Story:** Sebagai admin, saya ingin Penasihat Keamanan memakai model yang lebih kuat dan rujukan fakta terverifikasi, sehingga kesalahan fakta dari model kecil lebih mungkin tertangkap.

#### Acceptance Criteria

1. WHERE bagian `safety.llm` dikonfigurasi, THE Penasihat_Keamanan SHALL memakai nilai `provider`, `model`, `base_url`, dan `timeout_sec` dari `safety.llm`, dan memakai nilai dari bagian `llm` untuk setiap field yang tidak diisi di `safety.llm`.
2. WHERE bagian `safety.llm` tidak dikonfigurasi, THE Penasihat_Keamanan SHALL memakai Provider_LLM, model, base URL, dan timeout yang identik dengan bagian `llm`.
3. IF konfigurasi dimuat dengan `safety.llm.provider` selain `ollama` atau `gemini`, THEN THE AI_Office SHALL menolak konfigurasi sebelum job apa pun diproses dengan pesan error yang menyebut nilai tersebut dan daftar nilai yang didukung.
4. IF konfigurasi dimuat dengan `safety.llm.timeout_sec` yang bukan angka atau di luar rentang 1 sampai 3600, THEN THE AI_Office SHALL menolak konfigurasi dengan pesan error yang menyebut nama field dan rentang yang diizinkan.
5. WHEN Penasihat_Keamanan menyelesaikan review, THE Penasihat_Keamanan SHALL mencatat nama Provider_LLM dan model yang benar-benar dipakai di artefak review dan log job.
6. WHERE `safety.facts_file` dikonfigurasi, WHEN Daftar_Fakta berisi minimal satu entri yang Topik_Ternormalisasi-nya sama persis dengan Topik_Ternormalisasi topik job, THE Penasihat_Keamanan SHALL menyertakan semua fakta dari semua entri yang cocok sebagai rujukan di prompt review dan menulis log job yang menyebut jumlah fakta yang disertakan.
7. WHERE `safety.facts_file` dikonfigurasi, WHEN Daftar_Fakta tidak berisi entri yang cocok dengan topik job, THE Penasihat_Keamanan SHALL menjalankan review tanpa rujukan fakta dan menulis log job level INFO yang menyatakan tidak ada rujukan fakta untuk topik tersebut.
8. WHERE `safety.facts_file` tidak dikonfigurasi, THE Penasihat_Keamanan SHALL menjalankan review tanpa rujukan fakta tanpa menulis log level WARNING terkait Daftar_Fakta.
9. IF file Daftar_Fakta tidak ada, tidak dapat dibaca, tidak dapat di-parse, atau berisi entri dengan topik kosong atau tanpa satu pun fakta yang tidak kosong, THEN THE Penasihat_Keamanan SHALL menulis log job level WARNING yang menyebut path file dan alasannya, lalu menjalankan review tanpa rujukan fakta tanpa menandai job `failed`.
10. FOR ALL Daftar_Fakta yang valid, memuat lalu menyerialisasi lalu memuat ulang SHALL menghasilkan jumlah entri, topik, serta urutan dan teks fakta yang identik (properti round-trip).
11. IF panggilan Provider_LLM Penasihat_Keamanan gagal atau melewati timeout, THEN THE Penasihat_Keamanan SHALL menandai tahap keamanan `failed` dengan pesan error yang menyebut Provider_LLM dan model, dan THE Orchestrator SHALL menahan konten job dari tahap berikutnya selama review belum lulus.
12. WHILE pemeriksaan ketersediaan terakhir untuk Provider_LLM Penasihat_Keamanan gagal, THE Dashboard SHALL menampilkan Penasihat_Keamanan sebagai offline.
13. WHEN pemeriksaan ketersediaan Provider_LLM Penasihat_Keamanan berhasil setelah sebelumnya gagal, THE Dashboard SHALL menampilkan Penasihat_Keamanan sebagai online.
14. WHEN tahap suara dimulai dengan engine `xtts`, THE Orchestrator SHALL melepaskan dari VRAM setiap model `ollama` yang dipakai, termasuk model Penasihat_Keamanan bila berbeda dari model `llm`, sebelum sintesis XTTS pertama dimulai.
15. WHEN tahap suara dimulai dengan engine `xtts` sementara Provider_LLM bernilai `gemini`, THE Orchestrator SHALL melanjutkan tahap suara tanpa operasi pelepasan untuk Provider_LLM `gemini` tersebut.

### Requirement 4: Produksi batch dan terjadwal

**User Story:** Sebagai pembuat konten, saya ingin membuat banyak job sekaligus dari daftar topik dan menjadwalkannya, sehingga produksi berjalan rutin tanpa input manual tiap video.

#### Acceptance Criteria

1. WHEN admin menjalankan `python -m ai_office.cli batch <file>` dengan file teks UTF-8 berisi satu topik per baris dan maksimal 500 baris, THE AI_Office SHALL membuat satu job untuk setiap topik unik yang tidak kosong dengan panjang Topik_Ternormalisasi 1 sampai 200 karakter.
2. WHEN admin yang sudah login mengirim Daftar_Topik maksimal 500 baris lewat Panel_Admin dengan token CSRF yang valid, THE AI_Office SHALL membuat satu job untuk setiap topik unik yang tidak kosong dengan panjang Topik_Ternormalisasi 1 sampai 200 karakter.
3. WHEN Daftar_Topik berisi baris kosong, baris yang hanya berisi spasi, atau baris yang Topik_Ternormalisasi-nya kosong, THE AI_Office SHALL melewati baris tersebut dan menghitungnya sebagai baris kosong.
4. WHEN Daftar_Topik berisi beberapa baris dengan Topik_Ternormalisasi yang sama, THE AI_Office SHALL membuat job hanya untuk kemunculan pertama dan menghitung kemunculan berikutnya sebagai duplikat.
5. WHEN topik di Daftar_Topik memiliki Topik_Ternormalisasi yang sama dengan job di database yang berstatus selain `failed` dan `rejected`, THE AI_Office SHALL melewati topik tersebut dan melaporkannya sebagai duplikat beserta id job sebelumnya.
6. WHERE opsi `--allow-duplicates` (CLI) atau pilihan setara di Panel_Admin diaktifkan, THE AI_Office SHALL membuat job untuk setiap baris yang tidak kosong, termasuk duplikat di dalam Daftar_Topik dan duplikat terhadap job di database.
7. WHEN batch selesai diproses, THE AI_Office SHALL melaporkan jumlah job dibuat beserta id-nya, jumlah topik duplikat beserta id job sebelumnya, jumlah baris kosong, dan jumlah topik yang dilewati karena lebih dari 200 karakter, dengan total keempat jumlah sama dengan jumlah baris di Daftar_Topik.
8. FOR ALL Daftar_Topik, jumlah job yang dibuat tanpa `--allow-duplicates` SHALL kurang dari atau sama dengan jumlah Topik_Ternormalisasi unik di Daftar_Topik (properti metamorfik).
9. FOR ALL topik, menormalisasi Topik_Ternormalisasi SHALL menghasilkan nilai yang sama dengan Topik_Ternormalisasi tersebut (properti idempoten).
10. WHERE `schedule.jobs_per_day` dikonfigurasi dengan bilangan bulat N antara 1 dan 100, THE Penjadwal SHALL melepaskan maksimal N job batch ke antrean per Hari_Lokal, dimulai dari job yang dibuat paling awal.
11. WHILE kuota harian Penjadwal sudah habis, THE Penjadwal SHALL menahan job batch berikutnya dengan Status_Menunggu_Jadwal dan melepaskannya paling cepat pada pukul 00:00 Hari_Lokal berikutnya.
12. WHERE `schedule.jobs_per_day` tidak dikonfigurasi, THE AI_Office SHALL memasukkan semua job batch langsung ke antrean.
13. THE Orchestrator SHALL memproses job batch melalui Gerbang_1 dan Gerbang_2 dengan perilaku yang sama seperti job tunggal pada mode pipeline yang berlaku.
14. WHEN server dimulai ulang, THE Penjadwal SHALL menghitung sisa kuota harian dari jumlah job batch yang sudah dilepaskan pada Hari_Lokal saat ini di database, mempertahankan job berstatus Status_Menunggu_Jadwal, dan melepaskan job tanpa melebihi kuota maupun membuat job duplikat.
15. IF file batch CLI tidak ada, tidak ber-encoding UTF-8, atau berisi lebih dari 500 baris, THEN THE CLI SHALL menolak seluruh batch tanpa membuat job, menampilkan pesan error yang menyebut penyebabnya, dan keluar dengan kode keluar bukan nol.
16. IF Daftar_Topik yang dikirim lewat Panel_Admin berisi lebih dari 500 baris, THEN THE Panel_Admin SHALL menolak seluruh batch tanpa membuat job dan menampilkan pesan error yang menyebut batas 500 baris.
17. IF permintaan batch ke Panel_Admin tidak memiliki sesi admin yang valid atau token CSRF yang valid, THEN THE AI_Office SHALL menolak permintaan tanpa membuat job dan mengembalikan error otorisasi.
18. IF `schedule.jobs_per_day` bukan bilangan bulat atau di luar rentang 1 sampai 100, THEN THE AI_Office SHALL menolak konfigurasi saat startup dengan pesan error yang menyebut nilai tersebut.

### Requirement 5: Unggah opsional ke YouTube

**User Story:** Sebagai pemilik channel, saya ingin video yang sudah disetujui bisa diunggah otomatis ke YouTube dengan pengaturan aman untuk anak, sehingga saya tidak perlu mengunggah manual.

#### Acceptance Criteria

1. WHERE kunci `youtube.enabled` tidak ada di konfigurasi, THE AI_Office SHALL menonaktifkan Pengunggah_YouTube.
2. WHERE `youtube.enabled` bernilai true, THE Orchestrator SHALL menjalankan Pengunggah_YouTube hanya untuk job yang disetujui di Gerbang_2 dan tahap Pengirim-nya berhasil.
3. IF job ditolak atau tahap Pengirim gagal, THEN THE Orchestrator SHALL menghentikan job tanpa menjalankan Pengunggah_YouTube.
4. WHERE `youtube.enabled` bernilai false, THE Orchestrator SHALL menyelesaikan job dengan status berhasil setelah tahap Pengirim dengan nol panggilan ke YouTube Data API.
5. WHEN Pengunggah_YouTube mengunggah video, THE Pengunggah_YouTube SHALL memakai judul dari Metadata_Video yang dipotong menjadi maksimal 100 karakter, deskripsi yang dipotong menjadi maksimal 5000 karakter, dan tag dari Metadata_Video setelah membuang tag dari urutan paling akhir sampai total panjang tag maksimal 500 karakter.
6. WHEN Pengunggah_YouTube mengunggah video, THE Pengunggah_YouTube SHALL menetapkan `selfDeclaredMadeForKids: true`, apa pun nilai konfigurasi lain.
7. WHERE `youtube.privacy` tidak dikonfigurasi, THE Pengunggah_YouTube SHALL mengunggah video dengan status privasi `private`.
8. WHERE `youtube.privacy` dikonfigurasi, THE Pengunggah_YouTube SHALL menerima nilai `private`, `unlisted`, atau `public` sebagai status privasi.
9. WHERE `youtube.publish_at` dikonfigurasi, THE Pengunggah_YouTube SHALL mengunggah video berstatus `private` (mengabaikan `youtube.privacy`) dengan waktu publikasi terjadwal pada slot paling awal `publish_at + k × youtube.publish_interval_minutes` (k ≥ 0) yang minimal 60 menit setelah waktu unggah dan belum dipakai job lain, sehingga setiap video batch mendapat waktu publikasi yang berbeda.
10. WHERE `youtube.publish_interval_minutes` tidak dikonfigurasi, THE Pengunggah_YouTube SHALL memakai interval 1440 menit.
11. THE Pengunggah_YouTube SHALL membaca Kredensial_OAuth dari path yang ditentukan di konfigurasi atau `.env`, di luar folder yang di-commit ke repo.
12. THE AI_Office SHALL menetapkan path default Kredensial_OAuth di folder yang tercantum di `.gitignore`.
13. THE AI_Office SHALL menyamarkan Rahasia_OAuth di semua log, artefak job, dan respons API sehingga nilai lengkap Rahasia_OAuth tidak pernah muncul.
14. WHEN Pengunggah_YouTube berhasil mengunggah, THE Pengunggah_YouTube SHALL menyimpan id video YouTube, URL video, status privasi yang dipakai, dan waktu publikasi terjadwal (bila ada) di artefak job, lalu menandai job berhasil.
15. IF YouTube Data API mengembalikan error kuota habis, THEN THE Pengunggah_YouTube SHALL menandai job `failed` di tahap unggah dengan pesan "kuota habis" sambil mempertahankan artefak sebelumnya, dan worker SHALL terus memproses job lain.
16. IF YouTube Data API mengembalikan error autentikasi atau jaringan, THEN THE Pengunggah_YouTube SHALL menandai job `failed` di tahap unggah dengan pesan error yang sudah disamarkan sambil mempertahankan artefak sebelumnya, dan worker SHALL terus memproses job lain.
17. WHEN admin melakukan retry pada job yang gagal di tahap unggah, THE Orchestrator SHALL menjalankan ulang hanya tahap unggah dengan artefak Pengirim tetap tidak berubah.
18. IF artefak job sudah berisi id video YouTube saat tahap unggah dimulai, THEN THE Pengunggah_YouTube SHALL melewati panggilan unggah ke API dan menandai tahap unggah berhasil dengan id video yang sudah ada, sehingga satu job menghasilkan maksimal satu video YouTube.
19. WHERE `youtube.enabled` bernilai true, IF Kredensial_OAuth tidak ditemukan, THEN THE Doctor SHALL menampilkan peringatan yang menyebut path Kredensial_OAuth yang diharapkan.
20. IF `youtube.privacy` bernilai selain `private`, `unlisted`, atau `public`, `youtube.publish_at` bukan waktu ISO 8601 dengan zona waktu, atau `youtube.publish_interval_minutes` di luar rentang 15 sampai 10080, THEN THE Doctor SHALL menampilkan error yang menyebut nama kunci tersebut, dan THE Pengunggah_YouTube SHALL menandai job `failed` di tahap unggah tanpa memanggil YouTube Data API.
21. THE Test_Suite SHALL menguji Pengunggah_YouTube dengan klien YouTube tiruan tanpa panggilan jaringan, mencakup skenario unggah berhasil, kuota habis, error autentikasi, error jaringan, dan retry setelah unggah berhasil.

### Requirement 6: Folder pengiriman unik (perbaikan bug)

**User Story:** Sebagai pembuat konten, saya ingin setiap video tersimpan di folder sendiri, sehingga dua video dengan judul sama di hari yang sama tidak saling menimpa.

#### Acceptance Criteria

1. WHEN Pengirim membuat Folder_Tujuan, THE Pengirim SHALL membuat folder di dalam `delivery.dest_dir` dengan nama berformat `<tanggal>_<id-job>_<Slug_Judul>`, dengan `<tanggal>` berformat `YYYYMMDD` dalam UTC pada saat pengiriman dan `<id-job>` berupa id job apa adanya.
2. FOR ALL pasangan job dengan id berbeda, THE Pengirim SHALL menghasilkan nama Folder_Tujuan yang berbeda, termasuk saat judul dan tanggal sama (properti invarian keunikan).
3. WHEN Pengirim membuat Folder_Tujuan baru, THE Pengirim SHALL membuat folder hanya bila nama tersebut belum ada dan SHALL menulis hasil hanya ke folder yang dibuat untuk job tersebut atau tercatat di artefak job tersebut.
4. IF folder dengan nama Folder_Tujuan sudah ada, THEN THE Pengirim SHALL menambahkan akhiran angka berurutan (`-2`, `-3`, dan seterusnya sampai `-100`) dan memakai nama pertama yang belum ada.
5. IF semua nama sampai akhiran `-100` sudah ada, THEN THE Pengirim SHALL menggagalkan tahap pengiriman dengan pesan error tanpa menimpa folder mana pun.
6. WHEN Pengirim dijalankan ulang untuk job yang artefaknya sudah mencatat Folder_Tujuan, THE Pengirim SHALL memakai Folder_Tujuan tersebut tanpa membuat folder baru atau akhiran baru.
7. IF Folder_Tujuan yang tercatat di artefak job sudah terhapus saat retry, THEN THE Pengirim SHALL membuat ulang folder dengan nama yang sama dan menyalin ulang semua hasil job.
8. IF `delivery.dest_dir` tidak dapat ditulisi, THEN THE Pengirim SHALL menggagalkan tahap pengiriman dengan pesan error yang menyebut path tujuan tanpa mencatat Folder_Tujuan di artefak job.
9. THE Test_Suite SHALL berisi test yang membuktikan dua job berbeda berjudul sama pada tanggal yang sama menghasilkan dua Folder_Tujuan yang masing-masing berisi `video.mp4` dan `script.json` yang identik secara byte dengan sumber job masing-masing.
10. THE Test_Suite SHALL berisi test yang membuktikan retry Pengirim memakai Folder_Tujuan yang sama dan jumlah folder di `delivery.dest_dir` tidak bertambah.

### Requirement 7: Lisensi suara dan suara per bahasa

**User Story:** Sebagai pemilik channel yang ingin monetisasi, saya ingin diperingatkan atau dicegah memakai engine suara berlisensi non-komersial, dan ingin suara edge-tts otomatis sesuai bahasa, sehingga saya tidak melanggar lisensi dan tidak memakai suara bahasa yang salah.

#### Acceptance Criteria

1. WHERE `content.monetized` tidak dikonfigurasi, THE AI_Office SHALL memakai nilai boolean false untuk `content.monetized`.
2. WHERE `voice.block_noncommercial` tidak dikonfigurasi, THE AI_Office SHALL memakai nilai boolean false untuk `voice.block_noncommercial`.
3. WHILE `content.monetized` bernilai true dan `voice.engine` bernilai `xtts`, THE Doctor SHALL menampilkan tepat satu peringatan (bukan error) yang menyebut bahwa XTTS-v2 berlisensi CPML non-komersial dan menyebut `edge-tts` sebagai alternatif, sambil tetap menyelesaikan pemeriksaan lainnya.
4. WHILE `content.monetized` bernilai true dan `voice.engine` bernilai `xtts`, THE Panel_Admin SHALL menampilkan peringatan lisensi non-komersial di halaman pengaturan suara secara otomatis saat halaman dimuat.
5. WHILE `content.monetized` bernilai false atau `voice.engine` bernilai selain `xtts`, THE AI_Office SHALL menekan peringatan lisensi non-komersial di Doctor dan Panel_Admin.
6. WHERE `content.monetized` bernilai true dan `voice.block_noncommercial` bernilai true, IF tahap suara dimulai dengan engine `xtts`, THEN THE Pengisi_Suara SHALL menggagalkan tahap suara sebelum sintesis apa pun, menandai job `failed` tanpa membuat file audio, dengan pesan error yang menyebut lisensi non-komersial dan engine alternatif `edge-tts`.
7. WHERE `voice.voices` tidak dikonfigurasi, THE AI_Office SHALL memakai pemetaan default `id: id-ID-GadisNeural` dan `en: en-US-AnaNeural`.
8. WHEN Pengisi_Suara dengan engine `edge-tts` memproses job, THE Pengisi_Suara SHALL memakai nama suara dari entri `voice.voices` yang kuncinya sama persis dengan kode bahasa job.
9. IF `voice.voices` tidak berisi kunci untuk bahasa job, THEN THE Pengisi_Suara SHALL memakai nilai `voice.voice`, melanjutkan tahap suara, dan menulis tepat satu log job level WARNING per job yang menyebut bahasa tersebut.
10. WHEN prefiks lokal nama suara edge-tts yang terpilih (bagian sebelum tanda `-` pertama, tidak peka huruf besar/kecil) berbeda dari kode bahasa konten, THE Doctor SHALL menampilkan peringatan ketidakcocokan yang menyebut bahasa konten dan nama suara.
11. IF `content.monetized` atau `voice.block_noncommercial` bukan boolean, atau `voice.voices` bukan pemetaan kode bahasa ke teks yang tidak kosong, THEN THE AI_Office SHALL menolak konfigurasi dengan pesan error yang menyebut nama kunci tersebut.
12. WHEN `config.yaml` lama yang hanya berisi `voice.voice` tanpa `voice.voices` dimuat, THE AI_Office SHALL memuat konfigurasi tanpa error dan menerapkan nilai default untuk pengaturan baru.

### Requirement 8: Template dan validasi profil channel

**User Story:** Sebagai pembuat konten, saya ingin contoh profil channel yang sudah terisi dan validasi isinya, sehingga saya mudah menentukan nilai final dan kesalahan isi cepat terdeteksi.

#### Acceptance Criteria

1. THE AI_Office SHALL menyediakan file `content_profile.example.yaml` berisi nilai tidak kosong untuk `channel_name`, `niche`, `target_age_group`, `language`, `tone`, `recurring_phrases`, `avoid_topics`, dan `example_topics`, dengan minimal 1 item di setiap field daftar.
2. THE AI_Office SHALL menyediakan `content_profile.example.yaml` yang lulus semua aturan validasi Profil_Channel.
3. THE AI_Office SHALL mempertahankan isi `content_profile.yaml` milik pengguna identik secara byte, tanpa membuat, menimpa, atau menyalin otomatis file tersebut.
4. WHEN Profil_Channel dimuat, THE AI_Office SHALL memvalidasi bahwa `language` bernilai tepat `id` atau `en`, dan `target_age_group` berformat `<n>-<n>` dengan kedua angka bilangan bulat 0 sampai 99 dan angka pertama kurang dari atau sama dengan angka kedua.
5. WHEN Profil_Channel dimuat, THE AI_Office SHALL memvalidasi bahwa `channel_name`, `niche`, dan `tone`, bila ada, berupa teks maksimal 100 karakter.
6. WHEN Profil_Channel dimuat, THE AI_Office SHALL memvalidasi bahwa `recurring_phrases`, `avoid_topics`, dan `example_topics`, bila ada, berupa daftar maksimal 50 item dengan setiap item berupa teks tidak kosong maksimal 200 karakter.
7. IF Profil_Channel tidak valid, THEN THE AI_Office SHALL menampilkan satu pesan error per field yang tidak valid, berisi nama field dan alasannya, di Doctor dan log startup.
8. IF Profil_Channel tidak valid, THEN THE AI_Office SHALL melanjutkan startup tanpa bagian profil di prompt Penulis dan tanpa mengubah file Profil_Channel.
9. WHILE `channel_name` atau `niche` di Profil_Channel kosong (tidak ada, null, atau hanya spasi), THE Doctor SHALL menampilkan peringatan (bukan error) yang menyebut setiap field yang kosong dan merujuk ke `content_profile.example.yaml`.
10. WHEN Profil_Channel yang valid memiliki `language` berbeda dari `content.language` di `config.yaml`, THE Doctor SHALL menampilkan peringatan ketidakcocokan bahasa yang menyebut kedua nilai.
11. FOR ALL Profil_Channel yang valid, memuat lalu menyerialisasi lalu memuat ulang SHALL menghasilkan himpunan field, nilai, dan urutan item daftar yang identik (properti round-trip).
12. IF file Profil_Channel tidak ada, THEN THE AI_Office SHALL melanjutkan startup tanpa bagian profil di prompt Penulis, dan THE Doctor SHALL menampilkan saran level INFO untuk membuat Profil_Channel dari `content_profile.example.yaml`.
13. IF file Profil_Channel tidak dapat di-parse sebagai YAML atau tingkat teratasnya bukan pemetaan, THEN THE AI_Office SHALL menampilkan error berisi alasannya di Doctor dan log startup, lalu melanjutkan startup tanpa bagian profil di prompt Penulis.

### Requirement 9: Performa render dan pengukuran waktu per tahap

**User Story:** Sebagai admin, saya ingin render animasi lebih cepat dan bisa melihat waktu tiap tahap, sehingga bottleneck bisa diprofilkan dan perbaikan bisa diukur.

#### Acceptance Criteria

1. WHEN tahap pipeline (penulisan naskah, pemeriksaan keamanan, suara, animasi, editing, pengiriman, dan unggah YouTube bila aktif) selesai atau gagal, THE Orchestrator SHALL menyimpan satu entri Timing_Tahap berisi nama tahap, durasi dalam detik dengan presisi minimal 0,01 detik, dan status `berhasil` atau `gagal` di database sebelum tahap berikutnya dimulai.
2. WHEN halaman detail job dibuka, THE Panel_Admin SHALL menampilkan semua entri Timing_Tahap job sesuai urutan eksekusi dengan nama tahap, durasi (2 angka desimal), dan status.
3. WHEN halaman detail job dibuka untuk job tanpa entri Timing_Tahap, THE Panel_Admin SHALL menampilkan pesan "data timing belum tersedia".
4. WHEN admin menjalankan perintah ringkasan timing di CLI dengan N antara 1 dan 1000 (default 20), THE CLI SHALL menampilkan rata-rata durasi (2 angka desimal) dan jumlah sampel per tahap dari entri Timing_Tahap berstatus `berhasil` milik N job `done` dengan waktu selesai terbaru.
5. WHEN perintah ringkasan timing dijalankan dan tidak ada job `done`, THE CLI SHALL menampilkan pesan bahwa belum ada job selesai dan keluar dengan kode keluar 0.
6. FOR ALL job dengan Status_Akhir, jumlah durasi semua entri Timing_Tahap job SHALL sama dengan `processing_sec` job dengan toleransi 0,5 detik (properti invarian).
7. WHERE `animation.cache.enabled` bernilai true, WHEN Pembuat_Animasi memproses scene yang klip lengkap untuk Kunci_Scene-nya sudah ada di Cache_Klip, THE Pembuat_Animasi SHALL memakai klip dari Cache_Klip tanpa render Chromium dan tanpa encode ulang ffmpeg.
8. FOR ALL dua scene dengan masukan identik (data scene, durasi, timing, resolusi, fps, versi Pustaka_JS, dan versi renderer), THE Pembuat_Animasi SHALL menghasilkan Kunci_Scene yang sama; FOR ALL dua scene yang berbeda pada salah satu masukan tersebut, THE Pembuat_Animasi SHALL menghasilkan Kunci_Scene yang berbeda (properti invarian).
9. FOR ALL Kunci_Scene, klip yang dikembalikan Cache_Klip SHALL identik secara byte dengan klip yang ditulis untuk Kunci_Scene tersebut pada render pertama (properti round-trip), tanpa mensyaratkan render ulang dengan NVENC atau libx264 menghasilkan byte yang identik.
10. WHEN tahap animasi berakhir dengan berhasil atau gagal, THE Pembuat_Animasi SHALL mencatat jumlah scene yang diambil dari Cache_Klip dan jumlah scene yang dirender baru di log job, dengan total keduanya sama dengan jumlah scene yang diproses.
11. WHERE `animation.cache.max_size_mb` dikonfigurasi dengan bilangan bulat 1 sampai 1.000.000, WHEN Pembuat_Animasi selesai menulis klip dan total ukuran Cache_Klip melebihi batas, THE Pembuat_Animasi SHALL menghapus klip yang paling lama tidak dipakai sampai ukuran Cache_Klip kurang dari atau sama dengan batas, dengan tetap mempertahankan klip yang sedang dipakai job yang berjalan.
12. WHERE `animation.parallel_scenes` dikonfigurasi dengan bilangan bulat N antara 2 dan 16, THE Pembuat_Animasi SHALL merender maksimal N scene secara bersamaan dan minimal min(N, jumlah scene tanpa cache yang tersisa) scene secara bersamaan selama masih ada scene yang belum dirender.
13. FOR ALL naskah, video hasil render paralel SHALL memiliki urutan scene, jumlah frame per scene, dan durasi total (toleransi 1 frame) yang sama dengan hasil render berurutan (properti confluence).
14. IF render salah satu scene gagal saat render paralel, THEN THE Pembuat_Animasi SHALL berhenti memulai scene baru, menghentikan scene yang sedang dirender dalam 10 detik, dan menggagalkan tahap animasi dengan pesan yang menyebut indeks scene yang gagal.
15. IF render scene gagal atau dihentikan, THEN THE Pembuat_Animasi SHALL membiarkan Cache_Klip tanpa klip parsial untuk scene tersebut sambil mempertahankan klip lengkap milik scene lain yang sudah selesai.
16. WHERE `animation.parallel_scenes` tidak dikonfigurasi atau bernilai 1, THE Pembuat_Animasi SHALL merender scene satu per satu sesuai urutan naskah.
17. IF `animation.parallel_scenes` atau `animation.cache.max_size_mb` bukan bilangan bulat atau di luar rentang yang diizinkan, THEN THE AI_Office SHALL menolak konfigurasi saat startup dengan pesan error yang menyebut nama kunci tersebut.
18. IF klip di Cache_Klip tidak dapat dibaca atau berukuran 0 byte, THEN THE Pembuat_Animasi SHALL menghapus entri tersebut, merender ulang scene, dan menghitungnya sebagai scene yang dirender baru.

### Requirement 10: Kompatibilitas, keamanan, dan regresi

**User Story:** Sebagai pengembang, saya ingin semua peningkatan tidak merusak perilaku dan keamanan yang sudah ada, sehingga sistem tetap stabil.

#### Acceptance Criteria

1. WHEN `pytest -q` dijalankan dari root repo setelah semua peningkatan diterapkan, THE Test_Suite SHALL selesai dengan 0 kegagalan dan 0 error, mempertahankan semua test yang sudah ada tanpa menghapus atau melewatinya, dan berjalan tanpa jaringan, GPU, layanan LLM, maupun Kredensial_OAuth asli.
2. WHERE `server.host` tidak dikonfigurasi, THE AI_Office SHALL bind server ke `127.0.0.1` sehingga hanya dapat diakses dari loopback.
3. IF endpoint baru di bawah `/api/admin/*` (metode apa pun) menerima permintaan tanpa cookie sesi, dengan sesi tidak dikenal, dengan sesi kedaluwarsa, atau dengan sesi yang sudah logout, THEN THE AI_Office SHALL menolak permintaan dengan status HTTP 401 tanpa menjalankan aksi dan tanpa mengubah data.
4. IF endpoint baru di bawah `/api/admin/*` dengan metode POST, PUT, PATCH, atau DELETE menerima permintaan dengan sesi admin valid tetapi header CSRF tidak ada atau tidak cocok dengan cookie CSRF, THEN THE AI_Office SHALL menolak permintaan dengan status HTTP 403 tanpa mengubah data.
5. WHILE mode pipeline bernilai `semi_auto`, THE Orchestrator SHALL menahan setiap job, termasuk job batch dan job dengan Pengunggah_YouTube aktif, di Gerbang_1 dan Gerbang_2 tanpa batas waktu sampai admin menyetujui (job berlanjut) atau menolak (job berhenti).
6. WHILE mode pipeline bernilai `semi_auto`, THE Orchestrator SHALL menjalankan Pengunggah_YouTube hanya setelah admin menyetujui job di Gerbang_2.
7. WHILE mode pipeline bernilai `full_auto`, THE Orchestrator SHALL melewati Gerbang_1 dan Gerbang_2 hanya untuk job yang review keamanannya lulus.
8. WHILE mode pipeline bernilai `full_auto`, IF review keamanan job tidak lulus, THEN THE Orchestrator SHALL menahan job di gerbang sampai admin menyetujui atau menolak.
9. WHEN `config.yaml` yang tidak berisi bagian konfigurasi baru dimuat, THE AI_Office SHALL memulai tanpa error dengan nilai default yang terdokumentasi, dan fitur lama SHALL berperilaku identik dengan sebelum peningkatan.
10. IF agent baru atau tahap baru gagal, THEN THE Orchestrator SHALL menandai job `failed` dengan nama tahap dan pesan error, mempertahankan artefak job, dan memungkinkan retry, sementara worker SHALL terus memproses job berikutnya tanpa restart.
11. THE AI_Office SHALL mendokumentasikan setiap pengaturan baru di README (nama, nilai default, dan nilai yang diizinkan) dan di `config.yaml` dengan komentar berbahasa Indonesia di atas atau di samping setiap kunci baru.
12. IF pengaturan baru berisi nilai yang tidak valid, THEN THE AI_Office SHALL menggagalkan startup dengan pesan error yang menyebut nama kunci tersebut tanpa memulai server maupun worker.

### Requirement 11: Rework tampilan web bergaya pixel-art retro (Dashboard dan Panel_Admin)

**User Story:** Sebagai admin dan pengamat, saya ingin Dashboard dan Panel_Admin bertampilan pixel-art retro bertema navy gelap, dengan kantor pixel berisi para agent, Top_Bar, Sidebar_Navigasi, dan Bottom_Bar, sehingga status produksi terasa hidup, mudah dibaca, dan aksi admin mudah ditemukan.

Elemen antarmuka yang diwajibkan Requirement 2 (peringatan musik latar kosong), Requirement 4 (form batch dan Status_Menunggu_Jadwal), Requirement 5 (status dan URL YouTube, peringatan Kredensial_OAuth), Requirement 7 (peringatan lisensi suara), Requirement 8 (peringatan Profil_Channel), dan Requirement 9 (Timing_Tahap) SHALL ditempatkan di tampilan hasil rework sesuai kriteria di bawah.

#### Acceptance Criteria

**Sistem desain dan aset pixel**

1. THE AI_Office SHALL mendefinisikan Token_Desain di `web/static/style.css` yang dipakai bersama oleh Dashboard dan Panel_Admin, mencakup minimal: warna latar navy, warna panel navy, warna border navy yang lebih terang daripada warna panel, tepat satu warna utama, minimal dua warna aksen, warna teks, jarak, radius sudut, keluarga Font_Pixel, dan keluarga font isi.
2. THE AI_Office SHALL mendefinisikan Token_Desain warna latar navy dan warna panel navy dengan rona (hue) HSL antara 200 dan 250 derajat dan kecerahan (lightness) HSL maksimal 25%.
3. THE AI_Office SHALL mendefinisikan Token_Desain warna utama dan warna aksen yang, bila dipakai sebagai warna teks, memiliki rasio kontras minimal 4.5:1 terhadap warna latar navy dan warna panel navy, dan bila dipakai sebagai elemen non-teks (border, isian bar, ikon), memiliki rasio kontras minimal 3:1 terhadap warna di sekitarnya.
4. THE AI_Office SHALL menetapkan nilai warna, jarak, radius, dan font pada aturan CSS komponen baru melalui referensi Token_Desain (`var(--...)`), dengan nilai literal hanya muncul di definisi Token_Desain.
5. THE AI_Office SHALL menyajikan file HTML Dashboard dan Panel_Admin tanpa atribut `style` inline, tanpa elemen `<style>`, tanpa elemen `<script>` inline, tanpa atribut handler event inline (`onclick` dan sejenisnya), dan tanpa memuat Aset_Eksternal, sehingga halaman berjalan di bawah CSP yang ada tanpa pelanggaran CSP tercatat di konsol browser.
6. THE AI_Office SHALL menyertakan Font_Pixel di folder aset statis repo beserta file lisensinya di folder yang sama, dan menyajikan Font_Pixel dari origin AI_Office.
7. THE AI_Office SHALL mendefinisikan keluarga Font_Pixel di Token_Desain dengan tumpukan font monospace sistem sebagai fallback.
8. THE AI_Office SHALL memakai Font_Pixel untuk judul, label, item navigasi, label status, dan label Bottom_Bar, dan memakai keluarga font isi yang bukan Font_Pixel dengan ukuran minimal 14px untuk teks isi dan teks panjang (naskah, narasi, pesan error, hasil review, dan laporan batch).
9. THE AI_Office SHALL membuat setiap Aset_Pixel di dalam repo, baik digambar secara programatik di canvas maupun sebagai file SVG atau PNG lokal yang disajikan dari origin AI_Office.
10. THE AI_Office SHALL merender Kantor_Pixel dan Aset_Pixel raster dengan penskalaan nearest-neighbor (`imageSmoothingEnabled` bernilai false pada konteks canvas dan `image-rendering: pixelated` pada elemen yang diskalakan) sehingga tepi pixel tetap tajam.

**Dashboard: tata letak**

11. THE Dashboard SHALL menampilkan tata letak berurutan dari atas ke bawah: Top_Bar, Kantor_Pixel, Bottom_Bar, area Kartu_Ringkasan, dan daftar video selesai, tanpa Sidebar_Navigasi admin.
12. THE Dashboard SHALL menampilkan di Top_Bar nilai `channel_name` dari Profil_Channel di sisi kiri dalam Font_Pixel, dan mode pipeline yang berlaku.
13. IF Profil_Channel tidak ada, tidak valid, atau `channel_name` kosong, THEN THE Dashboard SHALL menampilkan teks "AI Office" sebagai nama di Top_Bar.

**Dashboard: Kantor_Pixel**

14. THE Kantor_Pixel SHALL menggambar peta kantor tampak atas berisi lantai ubin abu-abu terang, dinding, 6 meja dengan monitor dan kursi, serta minimal satu tanaman, satu rak buku, satu dispenser air, dan satu sofa.
15. THE Kantor_Pixel SHALL menampilkan satu Sprite_Agent untuk setiap Agent_Pipeline di mejanya masing-masing, dengan label nama di bawah Sprite_Agent berbunyi "Penulis", "Penasihat Keamanan", "Pengisi Suara", "Pembuat Animasi", "Editor", dan "Pengirim".
16. WHILE Status_Agent sebuah agent bernilai `working`, THE Kantor_Pixel SHALL menampilkan Sprite_Agent tersebut dengan animasi mengetik di meja.
17. WHILE Status_Agent sebuah agent bernilai `idle`, THE Kantor_Pixel SHALL menampilkan Sprite_Agent tersebut dalam pose diam di meja.
18. WHILE Status_Agent sebuah agent bernilai `offline`, THE Kantor_Pixel SHALL menampilkan Sprite_Agent tersebut dalam warna redup keabu-abuan.
19. WHILE Status_Agent sebuah agent bernilai `just_done`, THE Kantor_Pixel SHALL menampilkan indikator perayaan di dekat Sprite_Agent tersebut.
20. THE Kantor_Pixel SHALL menampilkan label teks Status_Agent di dekat setiap Sprite_Agent, sehingga keempat Status_Agent (`working`, `idle`, `offline`, dan `just_done`) dapat dibedakan tanpa mengandalkan warna maupun animasi.
21. THE Kantor_Pixel SHALL menskalakan peta kantor mengikuti lebar kontainernya dengan rasio aspek tetap.
22. THE Dashboard SHALL menyediakan padanan teks Kantor_Pixel berupa daftar yang dapat dibaca pembaca layar, berisi nama dan Status_Agent setiap Agent_Pipeline, dengan isi yang sama dengan yang digambar di Kantor_Pixel.
23. WHILE preferensi pengguna `prefers-reduced-motion: reduce` aktif, THE Kantor_Pixel SHALL menghentikan semua loop animasi Sprite_Agent dan menampilkan setiap Status_Agent dengan frame statis beserta label teksnya.
24. WHEN server mengirim event SSE yang mengubah Status_Agent, THE Dashboard SHALL memperbarui Sprite_Agent, label teks Status_Agent, dan padanan teks Kantor_Pixel dalam 2 detik sejak event diterima tanpa memuat ulang halaman.

**Dashboard: Bottom_Bar**

25. WHILE Job_Aktif ada, THE Bottom_Bar SHALL menampilkan bar progres berisian warna aksen hijau yang panjangnya sebanding dengan Progres_Job, beserta label teks berformat "Progres job #<id> <selesai>/<total>".
26. WHILE Job_Aktif tidak ada, THE Bottom_Bar SHALL menampilkan bar progres kosong dengan label teks "Tidak ada job aktif".
27. THE Bottom_Bar SHALL menampilkan penghitung berformat "Agent Bekerja <x>/6", dengan x sama dengan jumlah Agent_Pipeline yang Status_Agent-nya `working`.
28. THE Bottom_Bar SHALL mengekspos bar progres ke teknologi bantu dengan `role="progressbar"` beserta atribut `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, dan `aria-valuetext` yang sesuai dengan label teks.
29. WHEN server mengirim event SSE yang mengubah Progres_Job atau Status_Agent, THE Bottom_Bar SHALL memperbarui bar progres dan penghitung Agent Bekerja dalam 2 detik sejak event diterima tanpa memuat ulang halaman.

**Dashboard: ringkasan dan daftar video**

30. THE Dashboard SHALL menampilkan Kartu_Ringkasan bergaya panel pixel untuk mode pipeline, jumlah job aktif, jumlah job dalam antrean, jumlah job menunggu persetujuan, jumlah job `done`, jumlah job `failed`, dan waktu proses terakhir, dengan nilai 0 ditampilkan sebagai angka "0" dan waktu proses terakhir yang belum ada ditampilkan sebagai tanda kosong ("–").
31. WHEN server mengirim event SSE yang mengubah ringkasan, THE Dashboard SHALL memperbarui nilai Kartu_Ringkasan dalam 2 detik sejak event diterima tanpa memuat ulang halaman.
32. WHILE `music.enabled` bernilai true dan terjadi Folder_BGM_Kosong, THE Dashboard SHALL menampilkan indikator musik latar tidak tersedia (Requirement 2.5) di area Kartu_Ringkasan.
33. WHILE job berada di Status_Menunggu_Jadwal, THE Dashboard SHALL menghitung job tersebut di Kartu_Ringkasan terpisah berlabel menunggu jadwal.
34. THE Dashboard SHALL menampilkan daftar video selesai dengan judul atau topik, Lencana_Status, dan durasi dalam format menit:detik untuk setiap job.
35. IF belum ada job selesai, THEN THE Dashboard SHALL menampilkan pesan keadaan kosong (empty state) di tempat daftar video selesai.
36. THE Dashboard SHALL menampilkan hanya data publik (nama channel, mode pipeline, Status_Agent, Progres_Job beserta id Job_Aktif, ringkasan, judul/topik, status, dan durasi job) dan SHALL menampilkan nol informasi admin, termasuk isi naskah, alasan penolakan, path folder lokal, Kredensial_OAuth, dan token sesi atau CSRF.
37. IF koneksi SSE Dashboard terputus atau belum tersambung dalam 10 detik sejak halaman dimuat, THEN THE Dashboard SHALL menampilkan indikator koneksi terputus berlabel teks, tetap menampilkan data terakhir yang diketahui, mencoba menyambung ulang dengan jeda antar-percobaan maksimal 10 detik tanpa batas jumlah percobaan dan tanpa muat ulang manual, lalu menyembunyikan indikator dan memperbarui Kantor_Pixel, Bottom_Bar, serta Kartu_Ringkasan dalam 2 detik setelah koneksi pulih.

**Panel_Admin: tata letak dan navigasi**

38. THE Panel_Admin SHALL menampilkan Top_Bar berisi nama brand dalam Font_Pixel di sisi kiri, select untuk memilih job yang akan dibuka di Detail job, dan indikator admin berupa avatar pixel beserta label teks peran admin di sisi kanan.
39. WHEN admin memilih job di select Top_Bar, THE Panel_Admin SHALL menampilkan Detail job untuk job tersebut tanpa memuat ulang halaman.
40. THE Panel_Admin SHALL menampilkan Sidebar_Navigasi berisi item dengan ikon pixel dan label teks untuk Kantor (tautan ke Dashboard), Buat job, Batch, Daftar job, Detail job, dan Pengaturan/Status, serta item Log Out di bagian bawah Sidebar_Navigasi.
41. THE Panel_Admin SHALL membuat setiap item Sidebar_Navigasi dapat diaktifkan dengan mouse dan keyboard.
42. WHEN admin memilih Bagian_Admin di Sidebar_Navigasi, THE Panel_Admin SHALL menampilkan Bagian_Admin tersebut tanpa memuat ulang halaman, menyembunyikan Bagian_Admin lain, dan menandai hanya item navigasi yang aktif dengan atribut `aria-current`.
43. WHEN admin mengaktifkan item Log Out, THE Panel_Admin SHALL mengirim permintaan logout ke endpoint logout yang sudah ada dengan header `X-CSRF-Token`, lalu mengarahkan browser ke halaman login.
44. WHILE lebar viewport kurang dari 768px, THE Panel_Admin SHALL menyembunyikan Sidebar_Navigasi di balik tombol menu di Top_Bar yang memiliki label teks dan atribut `aria-expanded` yang mencerminkan keadaan buka/tutup Sidebar_Navigasi.
45. THE Panel_Admin SHALL menampilkan isi setiap Bagian_Admin di dalam panel bergaya pixel yang memakai Token_Desain.
46. THE Panel_Admin SHALL menempatkan form batch Requirement 4.2, termasuk pilihan izinkan duplikat (Requirement 4.6), di Bagian_Admin Batch.
47. WHEN Panel_Admin menerima respons berhasil dari pengiriman batch, THE Panel_Admin SHALL menampilkan laporan batch Requirement 4.7 (job dibuat beserta id, duplikat beserta id job sebelumnya, baris kosong, dan topik terlalu panjang) di Bagian_Admin Batch.
48. THE Panel_Admin SHALL menampilkan setiap job di Daftar job dengan id, judul atau topik, dan Lencana_Status.
49. IF belum ada job, THEN THE Panel_Admin SHALL menampilkan pesan keadaan kosong "belum ada job" di Daftar job.
50. THE AI_Office SHALL menampilkan Lencana_Status di Dashboard dan Panel_Admin dengan warna latar khas per status dan label teks status, sehingga setiap status (termasuk Gerbang_1, Gerbang_2, Status_Menunggu_Jadwal, `done`, `failed`, dan `rejected`) dapat dibedakan tanpa mengandalkan warna.

**Panel_Admin: detail job**

51. WHEN admin membuka Detail job, THE Panel_Admin SHALL menampilkan naskah per scene dengan nomor scene, narasi, dan durasi setiap scene dalam detik.
52. WHEN admin membuka Detail job yang sudah melewati tahap keamanan, THE Panel_Admin SHALL menampilkan hasil review Penasihat_Keamanan beserta Provider_LLM dan model yang dipakai (Requirement 3.5).
53. WHEN admin membuka Detail job, THE Panel_Admin SHALL menampilkan tabel Timing_Tahap atau pesan "data timing belum tersedia" sesuai Requirement 9.2 dan 9.3.
54. WHEN admin membuka Detail job yang tahap Pengirim-nya berhasil, THE Panel_Admin SHALL menampilkan path Folder_Tujuan job tersebut.
55. WHEN admin membuka Detail job yang tahap unggahnya berhasil, THE Panel_Admin SHALL menampilkan URL video YouTube sebagai tautan, status privasi, dan waktu publikasi terjadwal bila ada (Requirement 5.14).
56. WHEN admin membuka Detail job yang gagal, THE Panel_Admin SHALL menampilkan nama tahap yang gagal dan pesan error yang sudah disamarkan.
57. WHILE job berada di Gerbang_1, THE Panel_Admin SHALL menampilkan aksi Approve naskah dan Reject untuk job tersebut.
58. WHILE job berada di Gerbang_2, THE Panel_Admin SHALL menampilkan aksi Approve final dan Reject untuk job tersebut.
59. WHILE job berstatus `failed`, THE Panel_Admin SHALL menampilkan aksi Retry untuk job tersebut.
60. WHILE job berada di status yang tidak mengizinkan suatu aksi gerbang (Approve naskah, Approve final, Reject, Retry), THE Panel_Admin SHALL menyembunyikan aksi tersebut untuk job itu.

**Panel_Admin: peringatan**

61. WHILE minimal satu kondisi peringatan aktif menurut data status terbaru dari server (dimuat saat Panel_Admin dibuka dan setelah setiap aksi admin selesai), THE Panel_Admin SHALL menampilkan Banner_Peringatan di setiap Bagian_Admin yang berisi tepat satu butir per peringatan aktif dari kondisi berikut: musik latar kosong (Requirement 2.4), lisensi suara non-komersial (Requirement 7.4), Profil_Channel tidak valid atau kosong (Requirement 8.7 dan 8.9), dan Kredensial_OAuth tidak ditemukan saat `youtube.enabled` true (Requirement 5.19).
62. WHILE tidak ada kondisi peringatan aktif, THE Panel_Admin SHALL menyembunyikan Banner_Peringatan.
63. THE Panel_Admin SHALL menampilkan setiap butir Banner_Peringatan dengan ikon pixel dan label teks jenis peringatan selain warna.

**Penanganan error**

64. IF permintaan aksi admin (buat job, batch, Approve naskah, Approve final, Reject, Retry, simpan pengaturan, atau Log Out) gagal atau tidak mendapat respons dalam 30 detik, THEN THE Panel_Admin SHALL menampilkan pesan error di Bagian_Admin aktif beserta alasan dari server bila ada, mempertahankan isi input form, dan mengaktifkan kembali kontrol aksi yang dinonaktifkan selama permintaan berjalan.
65. IF server merespons permintaan Panel_Admin dengan status 401 (sesi tidak valid atau kedaluwarsa), THEN THE Panel_Admin SHALL mengarahkan browser ke halaman login dalam 2 detik tanpa menampilkan data admin tambahan dan tanpa mengulang aksi yang ditolak.

**Aksesibilitas dan tata letak**

66. THE AI_Office SHALL menampilkan teks isi di Dashboard dan Panel_Admin, termasuk label dalam Font_Pixel dan label nama Sprite_Agent, dengan rasio kontras minimal 4.5:1 terhadap latar belakangnya, dan teks berukuran besar (minimal 24px, atau 18.66px tebal) dengan rasio kontras minimal 3:1.
67. THE AI_Office SHALL membuat setiap kontrol interaktif di Dashboard dan Panel_Admin (termasuk item Sidebar_Navigasi, select Top_Bar, dan tombol menu) dapat dijangkau dengan tombol Tab sesuai urutan visual dan dapat diaktifkan dengan Enter atau Spasi.
68. WHEN kontrol interaktif menerima fokus keyboard, THE AI_Office SHALL menampilkan indikator fokus yang terlihat dengan rasio kontras minimal 3:1 terhadap latar navy di sekitarnya.
69. THE Panel_Admin SHALL mengaitkan setiap input, select, dan textarea, termasuk select job di Top_Bar, dengan label teks melalui elemen `<label>` atau atribut `aria-label`/`aria-labelledby`.
70. THE AI_Office SHALL memberi setiap ikon pixel yang menyertai label teks atribut `aria-hidden="true"` atau teks alternatif kosong, sehingga pembaca layar membacakan label teksnya saja.
71. WHEN status job, Status_Agent, atau Progres_Job berubah, atau aksi admin selesai atau gagal, THE AI_Office SHALL menulis pesan perubahan tersebut ke Wilayah_Live.
72. WHILE lebar viewport minimal 360px, THE AI_Office SHALL menampilkan Dashboard dan Panel_Admin tanpa scroll horizontal pada level halaman, dengan tabel lebar diizinkan scroll horizontal di dalam kontainernya sendiri.

**Offline, keamanan, dan kompatibilitas**

73. THE AI_Office SHALL menyajikan Dashboard dan Panel_Admin dengan nol Aset_Eksternal, memakai Font_Pixel lokal dan tumpukan font sistem sehingga tampilan berfungsi tanpa koneksi internet.
74. THE AI_Office SHALL mengirim CSP untuk Dashboard dan Panel_Admin yang identik dengan atau lebih ketat daripada CSP sebelum peningkatan (`default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'self'`), tanpa `'unsafe-inline'` maupun `'unsafe-eval'`.
75. WHEN Panel_Admin mengirim permintaan POST, PUT, PATCH, atau DELETE ke `/api/admin/*`, THE Panel_Admin SHALL menyertakan header `X-CSRF-Token` yang berisi nilai cookie CSRF.
76. THE AI_Office SHALL mempertahankan Kontrak_API yang sudah ada sehingga rework tampilan tidak mengubah, mengganti nama, atau menghapus path, metode, maupun field yang sudah ada; field baru dan endpoint baru (misalnya data Progres_Job dan nama channel untuk Dashboard) boleh ditambahkan.
77. THE AI_Office SHALL merender teks yang berasal dari data job (topik, judul, naskah, pesan error, alasan penolakan) di Dashboard dan Panel_Admin sebagai teks biasa, sehingga markup HTML di data tersebut ditampilkan sebagai teks dan tidak dieksekusi.
78. THE Test_Suite SHALL memverifikasi bahwa respons halaman Dashboard dan Panel_Admin memuat CSP yang memenuhi kriteria 74, bahwa file HTML Dashboard dan Panel_Admin memenuhi kriteria 5 dan 73, dan bahwa file Font_Pixel beserta file lisensinya ada di repo dan dapat diambil dari server AI_Office.

**Batasan cakupan**

79. THE AI_Office SHALL tidak menambahkan panel chat, panel umpan aktivitas (activity feed), popup detail saat agent di Kantor_Pixel diklik, pengalih tema terang/gelap (tema hanya navy gelap), pratinjau video, maupun pilihan bahasa antarmuka sebagai bagian dari Requirement 11.
