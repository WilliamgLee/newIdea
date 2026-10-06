"""Mesin TTS Coqui XTTS-v2 (lokal, kualitas tinggi, berat).

PERINGATAN LISENSI: XTTS-v2 memakai Coqui Public Model License (CPML) yang MELARANG
penggunaan komersial. Jangan pakai untuk channel yang dimonetisasi.

Model ~2 GB (diunduh saat pertama dipakai) dan butuh VRAM ~4 GB. Agar muat berbarengan
dengan Ollama di GPU 6 GB, model dilepas dari VRAM setelah tiap job (`unload_after_job`).

XTTS tidak memberi timing per kata; timing diperkirakan oleh VoiceAgent (align_words) dari
durasi audio. Jadi highlight subtitle di M4 tetap jalan, hanya kurang presisi dibanding edge-tts.
"""

from __future__ import annotations

import importlib.util
import logging
import wave
from pathlib import Path

from ..config import XTTSConfig
from .base import SynthResult, TTSEngine, TTSError

log = logging.getLogger(__name__)


def _resolve_device(pref: str) -> str:
    if pref in ("cuda", "cpu"):
        return pref
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


class XTTSEngine(TTSEngine):
    name = "xtts"

    def __init__(self, cfg: XTTSConfig, base_dir: Path | None = None) -> None:
        self.cfg = cfg
        self.base_dir = base_dir or Path.cwd()
        self._tts = None
        self._device: str | None = None

    @property
    def audio_ext(self) -> str:
        return ".wav"  # XTTS menghasilkan WAV

    def is_available(self) -> bool:
        # Paket bisa bernama 'TTS' (coqui asli) atau tersedia via fork 'coqui-tts' (impor sama).
        return importlib.util.find_spec("TTS") is not None

    # ------------------------------------------------------------ model
    def _load(self):
        if self._tts is not None:
            return self._tts
        try:
            from TTS.api import TTS
        except Exception as exc:
            raise TTSError(
                "Paket XTTS belum terpasang. Jalankan: pip install -r requirements-xtts.txt "
                "(butuh Python 3.11, lihat README)."
            ) from exc
        self._device = _resolve_device(self.cfg.device)
        log.info("Memuat XTTS (%s) di %s", self.cfg.model, self._device)
        try:
            tts = TTS(self.cfg.model)
            tts.to(self._device)
        except Exception as exc:
            raise TTSError(f"Gagal memuat model XTTS: {exc}") from exc
        self._tts = tts
        return tts

    def unload(self) -> None:
        """Lepaskan model dari memori/VRAM (dipanggil setelah job bila unload_after_job)."""
        if self._tts is None:
            return
        self._tts = None
        try:
            import gc

            import torch

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            log.debug("gagal empty_cache", exc_info=True)
        log.info("XTTS dilepas dari VRAM")

    # -------------------------------------------------------- sintesis
    def _speaker_kwargs(self) -> dict:
        if self.cfg.speaker_wav:
            path = Path(self.cfg.speaker_wav)
            if not path.is_absolute():
                path = self.base_dir / path
            if not path.exists():
                raise TTSError(f"speaker_wav tidak ditemukan: {path}")
            return {"speaker_wav": str(path)}
        return {"speaker": self.cfg.speaker}

    def synthesize(self, text: str, out_path: Path, rate: str) -> SynthResult:
        tts = self._load()
        try:
            tts.tts_to_file(
                text=text,
                file_path=str(out_path),
                language=self.cfg.language,
                temperature=self.cfg.temperature,
                **self._speaker_kwargs(),
            )
        except TTSError:
            raise
        except Exception as exc:
            raise TTSError(f"XTTS gagal membuat suara: {type(exc).__name__}: {exc}") from exc
        if not out_path.exists() or out_path.stat().st_size == 0:
            raise TTSError("XTTS tidak menghasilkan audio")
        # XTTS tidak memberi timing per kata -> words kosong (VoiceAgent akan memperkirakan).
        return SynthResult(audio_path=out_path, words=[])


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / float(w.getframerate())
