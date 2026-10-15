# AI Office - satu perintah untuk menyalakan semuanya (Windows PowerShell).
#
#   .\start.ps1               cek semua kebutuhan, lalu jalankan server + buka browser
#   .\start.ps1 -NoBrowser    tanpa membuka browser
#   .\start.ps1 -SkipDoctor   lewati pemeriksaan doctor (lebih cepat)
#
# Urutan: pilih venv -> cek ffmpeg -> cek/nyalakan Ollama -> cek model -> cek admin ->
#         doctor --quick -> cek port -> python run.py
# Jika PowerShell menolak script: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

param(
    [switch]$NoBrowser,
    [switch]$SkipDoctor
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Ok($text) { Write-Host "  [OK] $text" -ForegroundColor Green }
function Warn($text) { Write-Host "  [!!] $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "  [XX] $text" -ForegroundColor Red }
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function AskYes($question) {
    $answer = Read-Host "$question (y/N)"
    return $answer -match '^(y|ya|yes)$'
}

Say ""
Say "=== AI OFFICE ===" "Cyan"

# ---------------------------------------------------------------- 1. venv Python
Say "`n1. Python"
$venvs = @(".venv-xtts", ".venv")
$py = $null
foreach ($v in $venvs) {
    $candidate = Join-Path $PSScriptRoot "$v\Scripts\python.exe"
    if (Test-Path $candidate) { $py = $candidate; $venvName = $v; break }
}
if (-not $py) {
    Fail "Tidak ada venv (.venv-xtts atau .venv)."
    Say "     Buat dulu:  py -3.11 -m venv .venv-xtts"
    Say "                 .venv-xtts\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}
$pyVersion = & $py -c "import platform; print(platform.python_version())"
Ok "$venvName (Python $pyVersion)"
$engine = & $py -c "from ai_office.config import load_config; print(load_config().voice.engine)"
if ($engine -eq "xtts" -and $venvName -ne ".venv-xtts") {
    Warn "voice.engine = xtts tapi .venv-xtts tidak ada. Suara XTTS akan gagal."
}

# ---------------------------------------------------------------- 2. ffmpeg
Say "`n2. ffmpeg"
$missingFfmpeg = $false
foreach ($tool in @("ffmpeg", "ffprobe")) {
    if (Has $tool) { Ok $tool } else { Fail "$tool tidak ditemukan"; $missingFfmpeg = $true }
}
if ($missingFfmpeg) {
    Say "     Pasang:  winget install Gyan.FFmpeg   (lalu buka PowerShell baru)"
    exit 1
}

# ---------------------------------------------------------------- 3. Ollama
$provider = & $py -c "from ai_office.config import load_config; print(load_config().llm.provider)"
if ($provider -eq "ollama") {
    Say "`n3. Ollama"
    $model = & $py -c "from ai_office.config import load_config; print(load_config().llm.model)"
    $baseUrl = & $py -c "from ai_office.config import load_config; print(load_config().llm.base_url.rstrip('/'))"
    if (-not (Has "ollama")) {
        Fail "Ollama belum terpasang"
        Say "     Pasang:  winget install Ollama.Ollama   (lalu buka PowerShell baru)"
        exit 1
    }
    $tags = $null
    try { $tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -TimeoutSec 3 } catch { }
    if (-not $tags) {
        Warn "Server Ollama belum jalan, menyalakan..."
        Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
        for ($i = 0; $i -lt 20 -and -not $tags; $i++) {
            Start-Sleep -Milliseconds 750
            try { $tags = Invoke-RestMethod -Uri "$baseUrl/api/tags" -TimeoutSec 2 } catch { }
        }
    }
    if (-not $tags) {
        Fail "Ollama tidak bisa dihubungi di $baseUrl. Buka aplikasi Ollama lalu coba lagi."
        exit 1
    }
    Ok "Server Ollama jalan"
    $wanted = if ($model -like "*:*") { $model } else { "${model}:latest" }
    $names = @($tags.models | ForEach-Object { $_.name })
    if ($names -contains $wanted) {
        Ok "Model $model sudah ada"
    } else {
        Warn "Model $model belum di-pull"
        if (AskYes "     Unduh sekarang dengan 'ollama pull $model'?") {
            & ollama pull $model
            if ($LASTEXITCODE -ne 0) { Fail "Gagal mengunduh model"; exit 1 }
        } else {
            Say "     Lewati. Penulis & Penasihat Keamanan tidak akan jalan tanpa model ini."
        }
    }
} else {
    Say "`n3. LLM: $provider (bukan Ollama, dicek oleh doctor)"
}

# ---------------------------------------------------------------- 4. akun admin
Say "`n4. Akun admin"
$adminFile = & $py -c "from ai_office.config import load_config; print(load_config().data_dir / 'admin.json')"
if (Test-Path $adminFile) {
    Ok "Sudah dibuat"
} else {
    Warn "Belum ada akun admin (panel admin butuh login)"
    if (AskYes "     Buat sekarang?") {
        & $py scripts/set_admin.py
    }
}

# ---------------------------------------------------------------- 5. doctor
if (-not $SkipDoctor) {
    Say "`n5. Pemeriksaan lengkap (doctor --quick)"
    & $py -m ai_office.cli doctor --quick
    if ($LASTEXITCODE -ne 0) {
        Warn "Doctor menemukan masalah (lihat [XX] di atas)."
        if (-not (AskYes "     Tetap jalankan server?")) { exit 1 }
    }
}

# ---------------------------------------------------------------- 6. port & server
$port = & $py -c "from ai_office.config import load_config; print(load_config().server.port)"
$url = "http://127.0.0.1:$port"
$busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Warn "Port $port sudah dipakai. Mungkin AI Office sudah jalan di jendela lain."
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

Say "`n6. Menjalankan AI Office di $url  (Ctrl+C untuk berhenti)" "Cyan"
if ($NoBrowser) {
    & $py run.py
} else {
    & $py run.py --open
}
