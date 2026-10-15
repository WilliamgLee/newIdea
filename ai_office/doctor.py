"""Pemeriksaan lingkungan untuk perintah `doctor`: Python, paket, ffmpeg, GPU, Ollama, dll.

Tiap pemeriksaan menghasilkan Check(status, label, detail, hint):
  ok   = siap
  warn = jalan, tapi ada yang sebaiknya dibenahi
  fail = fitur yang dibutuhkan config ini tidak akan jalan
"""

from __future__ import annotations

import importlib
import importlib.metadata as md
import os
import platform
import shutil
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .config import AppConfig

OK, WARN, FAIL = "ok", "warn", "fail"
ICON = {OK: "[OK]", WARN: "[!!]", FAIL: "[XX]"}


@dataclass
class Check:
    status: str
    label: str
    detail: str = ""
    hint: str = ""


def _run(cmd: list[str], timeout: float = 15) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              encoding="utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError):
        return None


def _version(dist: str) -> str | None:
    try:
        return md.version(dist)
    except md.PackageNotFoundError:
        return None


# ------------------------------------------------------------------ pemeriksaan
def check_python(config: AppConfig) -> list[Check]:
    v = sys.version_info
    where = Path(sys.prefix).name
    in_venv = sys.prefix != sys.base_prefix
    out = [Check(OK if v >= (3, 11) else FAIL, "Python",
                 f"{platform.python_version()} ({'venv ' + where if in_venv else 'TANPA venv'})",
                 "" if v >= (3, 11) else "Butuh Python 3.11 atau lebih baru")]
    if not in_venv:
        out[0].status = WARN
        out[0].hint = ("Aktifkan venv dulu: .venv-xtts\\Scripts\\Activate.ps1 (atau pakai start.ps1)")
    if config.voice.engine == "xtts" and v >= (3, 12):
        out.append(Check(FAIL, "Python untuk XTTS", f"{v.major}.{v.minor}",
                         "XTTS (coqui-tts) butuh Python 3.11: jalankan dari .venv-xtts"))
    return out


REQUIRED = [
    ("fastapi", "fastapi"), ("uvicorn", "uvicorn"), ("pydantic", "pydantic"),
    ("yaml", "PyYAML"), ("httpx", "httpx"), ("dotenv", "python-dotenv"),
    ("argon2", "argon2-cffi"), ("playwright", "playwright"), ("numpy", "numpy"),
]


def check_packages(config: AppConfig) -> list[Check]:
    out = []
    missing = []
    for module, dist in REQUIRED:
        try:
            importlib.import_module(module)
        except Exception:  # noqa: BLE001 - modul native bisa gagal dengan error apa pun
            missing.append(dist)
    if missing:
        out.append(Check(FAIL, "Paket Python", "belum terpasang: " + ", ".join(missing),
                         "pip install -r requirements.txt"))
    else:
        out.append(Check(OK, "Paket Python", f"{len(REQUIRED)} paket inti terpasang"))
    if config.voice.engine == "edge-tts":
        ok = _version("edge-tts") is not None
        out.append(Check(OK if ok else FAIL, "edge-tts", _version("edge-tts") or "tidak ada",
                         "" if ok else "pip install edge-tts"))
    return out


def check_xtts(config: AppConfig) -> list[Check]:
    if config.voice.engine != "xtts":
        return []
    out = []
    torch_v = _version("torch")
    if torch_v is None:
        return [Check(FAIL, "PyTorch", "tidak terpasang di Python ini",
                      "Jalankan dari .venv-xtts (lihat requirements-xtts.txt)")]
    try:
        import torch

        cuda = torch.cuda.is_available()
        gpu = torch.cuda.get_device_name(0) if cuda else "CPU saja"
    except Exception as exc:  # noqa: BLE001
        return [Check(FAIL, "PyTorch", f"gagal dimuat: {exc}")]
    out.append(Check(OK if cuda else WARN, "PyTorch", f"{torch_v}, {gpu}",
                     "" if cuda else "Tanpa CUDA, suara XTTS jauh lebih lambat"))
    tts_v = _version("coqui-tts")
    out.append(Check(OK if tts_v else FAIL, "coqui-tts (XTTS)", tts_v or "tidak ada",
                     "" if tts_v else "pip install -r requirements-xtts.txt"))
    tf_v = _version("transformers") or ""
    good = tf_v.startswith("4.56")
    out.append(Check(OK if good else WARN, "transformers", tf_v or "tidak ada",
                     "" if good else "XTTS paling stabil dengan transformers 4.56.x"))
    return out


def check_ffmpeg(config: AppConfig, deep: bool = True) -> list[Check]:
    out = []
    for tool in ("ffmpeg", "ffprobe"):
        path = shutil.which(tool)
        if not path:
            out.append(Check(FAIL, tool, "tidak ditemukan di PATH",
                             "winget install Gyan.FFmpeg, lalu buka terminal baru"))
            continue
        res = _run([path, "-version"])
        first = res.stdout.splitlines()[0] if res and res.stdout else path
        out.append(Check(OK, tool, first.replace(" Copyright", "  ©").split("  ©")[0]))
    if deep and shutil.which("ffmpeg") and config.video.encoder in ("auto", "h264_nvenc"):
        res = _run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "color=s=256x256:d=0.2", "-c:v", "h264_nvenc", "-f", "null", "-"], timeout=20)
        ok = res is not None and res.returncode == 0
        out.append(Check(OK if ok else WARN, "NVENC (encoder GPU)",
                         "tersedia" if ok else "tidak bisa dipakai, otomatis pakai libx264 (CPU)",
                         "" if ok else "Video tetap dibuat lewat CPU, hanya lebih lambat"))
    return out


def check_gpu() -> list[Check]:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return [Check(WARN, "GPU NVIDIA", "nvidia-smi tidak ditemukan", "Tanpa GPU tetap jalan, tapi lambat")]
    res = _run([smi, "--query-gpu=name,memory.total,memory.used,driver_version",
                "--format=csv,noheader,nounits"])
    if not res or res.returncode != 0 or not res.stdout.strip():
        return [Check(WARN, "GPU NVIDIA", "nvidia-smi gagal dijalankan")]
    name, total, used, driver = [x.strip() for x in res.stdout.splitlines()[0].split(",")]
    return [Check(OK, "GPU NVIDIA", f"{name}, VRAM {used}/{total} MB terpakai, driver {driver}")]


def check_chromium(deep: bool = True) -> list[Check]:
    if not deep:
        return []
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            exe = Path(p.chromium.executable_path)
        ok = exe.exists()
    except Exception as exc:  # noqa: BLE001
        return [Check(FAIL, "Chromium (animasi)", f"playwright error: {exc}",
                      "python -m playwright install chromium")]
    return [Check(OK if ok else FAIL, "Chromium (animasi)", "terpasang" if ok else "belum terpasang",
                  "" if ok else "python -m playwright install chromium")]


def check_llm(config: AppConfig) -> list[Check]:
    llm = config.llm
    if llm.provider == "gemini":
        ok = bool(os.environ.get("GEMINI_API_KEY"))
        return [Check(OK if ok else FAIL, "Gemini", f"model {llm.gemini_model}",
                      "" if ok else "Isi GEMINI_API_KEY di file .env")]
    out = []
    exe = shutil.which("ollama")
    out.append(Check(OK if exe else WARN, "Ollama (program)", exe or "tidak ada di PATH",
                     "" if exe else "winget install Ollama.Ollama"))
    try:
        import httpx

        r = httpx.get(llm.base_url.rstrip("/") + "/api/tags", timeout=3)
        names = [m.get("name", "") for m in r.json().get("models", [])]
    except Exception:  # noqa: BLE001
        out.append(Check(FAIL, "Ollama (server)", f"tidak bisa dihubungi di {llm.base_url}",
                         "Buka aplikasi Ollama atau jalankan: ollama serve"))
        return out
    out.append(Check(OK, "Ollama (server)", f"jalan, {len(names)} model terpasang"))
    want = llm.model if ":" in llm.model else llm.model + ":latest"
    has = want in names
    out.append(Check(OK if has else FAIL, f"Model {llm.model}", "sudah di-pull" if has else "belum ada",
                     "" if has else f"ollama pull {llm.model}"))
    return out


def check_project(config: AppConfig) -> list[Check]:
    from .backup import backup_time, latest_backup
    from .editor.music import list_bgm

    out = []
    admin = config.data_dir / "admin.json"
    out.append(Check(OK if admin.exists() else WARN, "Akun admin",
                     "sudah dibuat" if admin.exists() else "belum dibuat",
                     "" if admin.exists() else "python scripts/set_admin.py"))
    if config.music.enabled:
        n = len(list_bgm(config.resolve(config.music.bgm_dir)))
        out.append(Check(OK if n else WARN, "Musik latar", f"{n} lagu di {config.music.bgm_dir}",
                         "" if n else "python scripts/make_bgm.py"))
    fredoka = _font_installed("fredoka")
    out.append(Check(OK if fredoka else WARN, "Font Fredoka (teks video)",
                     "terpasang" if fredoka else "tidak ada, pakai font cadangan",
                     "" if fredoka else "Lihat ai_office/animation/fonts/README.md"))
    if config.backup.enabled:
        last = latest_backup(config)
        if last is None:
            out.append(Check(WARN, "Backup", "belum ada", "Dibuat otomatis saat server jalan, "
                             "atau sekarang: python -m ai_office.cli backup"))
        else:
            age_h = (datetime.now() - backup_time(last)).total_seconds() / 3600
            stale = age_h > config.backup.interval_hours * 2
            out.append(Check(WARN if stale else OK, "Backup",
                             f"terakhir {backup_time(last):%d-%m-%Y %H:%M} ({age_h:.0f} jam lalu)"))
    try:
        free_gb = shutil.disk_usage(config.output_dir if config.output_dir.exists()
                                    else config.base_dir).free / 1e9
        out.append(Check(OK if free_gb >= 5 else WARN, "Ruang disk", f"{free_gb:.0f} GB kosong",
                         "" if free_gb >= 5 else "Hapus folder output/job_* lama"))
    except OSError:
        pass
    return out


def _font_installed(name: str) -> bool:
    dirs = [Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts",
            Path.home() / ".fonts", Path.home() / ".local/share/fonts", Path("/usr/share/fonts"),
            Path.home() / "Library/Fonts"]
    for d in dirs:
        try:
            if d.is_dir() and any(name in p.name.lower() for p in d.rglob("*.ttf")):
                return True
        except OSError:
            continue
    return False


def run_checks(config: AppConfig, deep: bool = True) -> list[tuple[str, list[Check]]]:
    sections: list[tuple[str, Callable[[], list[Check]]]] = [
        ("Python & paket", lambda: check_python(config) + check_packages(config)),
        ("Suara (XTTS)", lambda: check_xtts(config)),
        ("Video & GPU", lambda: check_ffmpeg(config, deep) + check_gpu() + check_chromium(deep)),
        ("LLM", lambda: check_llm(config)),
        ("Proyek", lambda: check_project(config)),
    ]
    out = []
    for title, fn in sections:
        try:
            checks = fn()
        except Exception as exc:  # noqa: BLE001 - satu bagian gagal tidak menghentikan doctor
            checks = [Check(WARN, title, f"pemeriksaan error: {exc}")]
        if checks:
            out.append((title, checks))
    return out


def print_report(sections: list[tuple[str, list[Check]]]) -> int:
    """Cetak laporan. Mengembalikan jumlah pemeriksaan berstatus fail."""
    fails = 0
    for title, checks in sections:
        print(f"\n{title}")
        for c in checks:
            fails += c.status == FAIL
            line = f"  {ICON[c.status]} {c.label:<26} {c.detail}"
            print(line.rstrip())
            if c.hint and c.status != OK:
                print(f"       -> {c.hint}")
    return fails
