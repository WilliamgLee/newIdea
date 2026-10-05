"""Mesin TTS edge-tts (gratis, memakai layanan suara online Microsoft Edge)."""

from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path
from typing import Any

from .base import RawWord, SynthResult, TTSEngine, TTSError

TICKS_PER_SEC = 10_000_000  # offset/durasi edge-tts dalam satuan 100 nanodetik


class EdgeTTSEngine(TTSEngine):
    name = "edge-tts"

    def __init__(self, voice: str, pitch: str = "+0Hz") -> None:
        self.voice = voice
        self.pitch = pitch

    def is_available(self) -> bool:
        return importlib.util.find_spec("edge_tts") is not None

    def synthesize(self, text: str, out_path: Path, rate: str) -> SynthResult:
        try:
            return asyncio.run(self._synthesize(text, out_path, rate))
        except TTSError:
            raise
        except Exception as exc:  # edge-tts memakai banyak jenis exception (jaringan, dll.)
            raise TTSError(f"edge-tts gagal: {type(exc).__name__}: {exc}. "
                           "Periksa koneksi internet.") from exc

    async def _synthesize(self, text: str, out_path: Path, rate: str) -> SynthResult:
        import edge_tts

        kwargs: dict[str, Any] = {"voice": self.voice, "rate": rate, "pitch": self.pitch}
        try:
            # edge-tts >= 7 default-nya hanya memberi batas kalimat; minta batas per kata
            communicate = edge_tts.Communicate(text, boundary="WordBoundary", **kwargs)
        except TypeError:  # versi lama: tidak ada parameter boundary, sudah per kata
            communicate = edge_tts.Communicate(text, **kwargs)

        words: list[RawWord] = []
        size = 0
        with out_path.open("wb") as fh:
            async for chunk in communicate.stream():
                kind = chunk.get("type")
                if kind == "audio":
                    data = chunk.get("data") or b""
                    fh.write(data)
                    size += len(data)
                elif kind == "WordBoundary":
                    start = chunk["offset"] / TICKS_PER_SEC
                    end = start + chunk["duration"] / TICKS_PER_SEC
                    words.append(RawWord(text=str(chunk["text"]), start=start, end=end))
        if size == 0:
            raise TTSError("edge-tts tidak mengirim audio")
        return SynthResult(audio_path=out_path, words=words)
