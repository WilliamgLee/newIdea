"""Encode PNG sequence -> MP4 H.264. Pilih NVENC (GPU NVIDIA) bila ada, fallback libx264."""

from __future__ import annotations

import functools
import logging
from collections.abc import Callable
from pathlib import Path

from ...media import MediaError, require_tool, run_tool

log = logging.getLogger(__name__)


@functools.lru_cache(maxsize=1)
def _ffmpeg_encoders() -> frozenset[str]:
    try:
        proc = run_tool([require_tool("ffmpeg"), "-hide_banner", "-encoders"], timeout=30)
    except MediaError:
        return frozenset()
    found = set()
    for line in proc.stdout.splitlines():
        for enc in ("h264_nvenc", "libx264"):
            if enc in line:
                found.add(enc)
    return frozenset(found)


def choose_encoder(preferred: str = "auto") -> str:
    available = _ffmpeg_encoders()
    if preferred not in ("auto", "h264_nvenc", "libx264"):
        raise MediaError(f"encoder tidak dikenal: {preferred}")
    if preferred != "auto":
        return preferred  # dipaksa pengguna (dicoba apa adanya)
    if "h264_nvenc" in available:
        return "h264_nvenc"
    return "libx264"


def _encode_args(encoder: str) -> list[str]:
    if encoder == "h264_nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23",
                "-pix_fmt", "yuv420p"]
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]


def encode_frames_to_mp4(frames_dir: Path, out: Path, fps: int, encoder: str = "auto",
                         log_fn: Callable[[str], None] = print) -> str:
    ffmpeg = require_tool("ffmpeg")
    chosen = choose_encoder(encoder)
    pattern = str(frames_dir / "frame_%05d.png")
    cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
           "-framerate", str(fps), "-i", pattern, *_encode_args(chosen),
           "-movflags", "+faststart", str(out)]
    try:
        run_tool(cmd, timeout=900)
    except MediaError as exc:
        if encoder == "auto" and chosen == "h264_nvenc":
            log_fn(f"NVENC gagal ({exc}); fallback ke libx264")
            cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                   "-framerate", str(fps), "-i", pattern, *_encode_args("libx264"),
                   "-movflags", "+faststart", str(out)]
            run_tool(cmd, timeout=900)
            return "libx264"
        raise
    return chosen
