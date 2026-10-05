"""Antarmuka mesin TTS. Tambah mesin baru (mis. Piper) dengan membuat subclass `TTSEngine`
lalu mendaftarkannya di `ai_office/tts/__init__.py`."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


class TTSError(Exception):
    """Gagal membuat suara."""


@dataclass(frozen=True)
class RawWord:
    """Batas kata dari mesin TTS (detik, relatif terhadap awal file audio)."""

    text: str
    start: float
    end: float


@dataclass
class SynthResult:
    audio_path: Path
    words: list[RawWord] = field(default_factory=list)  # kosong = mesin tidak memberi timing


class TTSEngine(ABC):
    name: str = "base"

    @abstractmethod
    def synthesize(self, text: str, out_path: Path, rate: str) -> SynthResult:
        """Tulis audio `text` ke `out_path` (format bebas, mis. mp3/wav)."""

    @property
    def audio_ext(self) -> str:
        return ".mp3"

    def is_available(self) -> bool:
        return True
