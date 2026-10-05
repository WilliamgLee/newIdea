# AI Office

Sistem multi-agent lokal untuk membuat video YouTube Shorts edukasi anak (1080x1920, ±30 detik),
lengkap dengan dashboard "kantor" yang menampilkan status tiap agent.

> **Status: M0 (kerangka).** Semua agent masih **palsu** (simulasi). Agent asli, dashboard
> lengkap, dan login admin menyusul di milestone berikutnya. README lengkap ditulis di M7.

## Instalasi (Windows 11)

Prasyarat: Python 3.11+ (sudah dites dengan 3.11 dan 3.14) dan Git.

```powershell
git clone https://github.com/WilliamgLee/newIdea.git
cd newIdea
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```

> Kalau PowerShell menolak menjalankan `Activate.ps1`, jalankan dulu sekali:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

Ollama dan ffmpeg **belum** diperlukan di M0.

## Menjalankan test

```powershell
pytest -q
```

## Mencoba M0

**Cara 1 – tanpa server (paling cepat):**

```powershell
python -m ai_office.cli demo "mengenal warna"
```

Satu job palsu dibuat, diproses semua agent, kedua gerbang disetujui otomatis, sampai `done`.

**Cara 2 – dengan server + API:**

```powershell
# terminal 1
python run.py

# terminal 2
python -m ai_office.cli create "hewan dan suaranya"
python -m ai_office.cli list                 # tunggu status awaiting_script_approval
python -m ai_office.cli approve-script 1
python -m ai_office.cli approve-final 1      # setelah status awaiting_final_approval
Invoke-RestMethod http://127.0.0.1:8000/api/jobs/1
```

Buka http://127.0.0.1:8000 di browser untuk melihat status agent berubah secara real-time (SSE).

Perintah CLI lainnya: `show <id>` (detail + log + review keamanan), `reject <id> --reason "..."`,
`retry <id>`, `mode semi_auto|full_auto`.

## Endpoint API (M0, publik & hanya-baca)

| Endpoint | Isi |
|---|---|
| `GET /api/health` | cek server hidup |
| `GET /api/status` | ringkasan + status 6 agent |
| `GET /api/jobs` | daftar job (data publik saja) |
| `GET /api/jobs/{id}` | status satu job |
| `GET /api/events` | stream SSE: `snapshot`, `job_created`, `job_status`, `agent_state` |

Belum ada endpoint yang mengubah data. Aksi admin lewat web baru tersedia di M6, dengan login.

## Konfigurasi

- `config.yaml` – semua pengaturan (mode, durasi, suara, LLM, folder tujuan, dll.).
- `.env` – rahasia (API key opsional, secret key sesi). Jangan di-commit.
- `content_profile.yaml` – profil konten channel (boleh diisi belakangan).

Ubah `pipeline.mode` ke `full_auto` (atau `python -m ai_office.cli mode full_auto`) untuk
melewati gerbang persetujuan. Gerbang hanya dilewati **jika review keamanan lulus**.
