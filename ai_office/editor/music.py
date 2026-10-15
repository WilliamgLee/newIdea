"""Pemilihan musik latar dari folder bgm (deterministik per judul)."""

from __future__ import annotations

from pathlib import Path

AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac")


def list_bgm(bgm_dir: Path) -> list[Path]:
    if not bgm_dir.exists():
        return []
    return sorted(p for p in bgm_dir.iterdir()
                  if p.is_file() and p.suffix.lower() in AUDIO_EXTS)


def pick_bgm(bgm_dir: Path, seed: str) -> Path | None:
    """Pilih satu lagu secara deterministik berdasarkan `seed` (mis. judul video)."""
    files = list_bgm(bgm_dir)
    if not files:
        return None
    h = 0
    for ch in seed:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return files[h % len(files)]
