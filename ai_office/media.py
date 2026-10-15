"""Pembungkus ffmpeg/ffprobe (dipakai Pengisi Suara & Editor)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


class MediaError(Exception):
    """ffmpeg/ffprobe gagal atau tidak terpasang."""


def find_tool(name: str) -> str | None:
    return shutil.which(name)


def require_tool(name: str) -> str:
    path = find_tool(name)
    if path is None:
        raise MediaError(
            f"'{name}' tidak ditemukan di PATH. Pasang ffmpeg (Windows: winget install "
            "Gyan.FFmpeg), lalu buka terminal baru."
        )
    return path


def run_tool(cmd: list[str], timeout: float = 600) -> subprocess.CompletedProcess[str]:
    kwargs: dict = {}
    if sys.platform == "win32":  # jangan munculkan jendela konsol saat jalan di latar
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=timeout, check=False, **kwargs)
    except subprocess.TimeoutExpired as exc:
        raise MediaError(f"{Path(cmd[0]).name} melebihi batas waktu {timeout:g} detik") from exc
    except OSError as exc:
        raise MediaError(f"Gagal menjalankan {cmd[0]}: {exc}") from exc
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-5:]
        raise MediaError(f"{Path(cmd[0]).name} gagal (kode {proc.returncode}): "
                         + " | ".join(tail))
    return proc


def normalize_cmd(ffmpeg: str, src: Path, dst: Path, lufs: float, sample_rate: int) -> list[str]:
    """Normalisasi loudness (EBU R128, filter loudnorm) ke WAV mono."""
    return [
        ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
        "-af", f"loudnorm=I={lufs:g}:TP=-1.5:LRA=11",
        "-ar", str(sample_rate), "-ac", "1", "-c:a", "pcm_s16le", str(dst),
    ]


class MediaTools:
    """Operasi media yang dipakai agent (bisa diganti versi palsu di test)."""

    def is_available(self) -> bool:
        return find_tool("ffmpeg") is not None and find_tool("ffprobe") is not None

    def normalize_audio(self, src: Path, dst: Path, lufs: float, sample_rate: int) -> None:
        run_tool(normalize_cmd(require_tool("ffmpeg"), src, dst, lufs, sample_rate))

    def probe_duration(self, path: Path) -> float:
        proc = run_tool([
            require_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ], timeout=60)
        try:
            return float(proc.stdout.strip())
        except ValueError as exc:
            raise MediaError(f"Durasi tidak terbaca dari {path.name}") from exc

    def build_timeline_audio(self, segments: list[tuple[Path, float]], total: float,
                             dst: Path, sample_rate: int) -> None:
        """Susun audio narasi pada posisi waktu masing-masing di atas keheningan `total` detik.

        segments: daftar (file_wav, waktu_mulai_detik).
        """
        ffmpeg = require_tool("ffmpeg")
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
               "-f", "lavfi", "-t", f"{total:.3f}",
               "-i", f"anullsrc=channel_layout=mono:sample_rate={sample_rate}"]
        for path, _ in segments:
            cmd += ["-i", str(path)]
        parts = []
        labels = ["[0:a]"]
        for i, (_, start) in enumerate(segments, start=1):
            delay_ms = round(start * 1000)
            parts.append(f"[{i}:a]adelay={delay_ms}|{delay_ms}[a{i}]")
            labels.append(f"[a{i}]")
        mix = ("".join(p + ";" for p in parts) + "".join(labels)
               + f"amix=inputs={len(segments) + 1}:normalize=0:dropout_transition=0[out]")
        cmd += ["-filter_complex", mix, "-map", "[out]",
                "-ar", str(sample_rate), "-ac", "1", "-c:a", "pcm_s16le", str(dst)]
        run_tool(cmd)

    def extract_thumbnail(self, video: Path, dst: Path, at_sec: float) -> None:
        run_tool([require_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error",
                  "-ss", f"{at_sec:.3f}", "-i", str(video), "-frames:v", "1",
                  "-q:v", "2", str(dst)])

    def mux(self, cmd_tail: list[str]) -> None:
        run_tool([require_tool("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", *cmd_tail],
                 timeout=900)
