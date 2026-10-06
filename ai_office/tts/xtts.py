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


def _stub_matplotlib() -> None:
    """Pasang modul matplotlib tiruan agar XTTS tidak mengimpor matplotlib asli.

    XTTS-v2 menarik matplotlib lewat modul vocoder yang TIDAK dipakai saat membuat suara.
    Di sebagian Windows (Smart App Control), DLL matplotlib (ft2font) diblokir dan menggagalkan
    impor TTS. Stub ini hanya aktif bila matplotlib belum ter-load, dan hanya menyediakan API
    minimal yang disentuh XTTS (pyplot.*). Tidak memengaruhi grafik apa pun di runtime kita.
    """
    import sys
    import types

    if "matplotlib" in sys.modules:
        return
    try:
        import matplotlib  # noqa: F401

        return  # matplotlib asli bisa di-import, tidak perlu stub
    except Exception:  # noqa: BLE001
        log.info("matplotlib tidak bisa di-import (mungkin diblokir); memakai stub untuk XTTS")

    mpl = types.ModuleType("matplotlib")
    mpl.__version__ = "0.0.0-stub"
    mpl.use = lambda *a, **k: None

    def _noop(*a, **k):
        return None

    pyplot = types.ModuleType("matplotlib.pyplot")
    for fn in ("plot", "figure", "subplots", "close", "savefig", "imshow", "colorbar",
               "title", "xlabel", "ylabel", "tight_layout", "clf", "cla", "legend",
               "scatter", "bar", "xticks", "yticks", "pcolor", "pcolormesh"):
        setattr(pyplot, fn, _noop)
    pyplot.gcf = lambda *a, **k: types.SimpleNamespace(canvas=types.SimpleNamespace(
        draw=_noop, tostring_rgb=lambda: b""))
    mpl.pyplot = pyplot
    sys.modules["matplotlib"] = mpl
    sys.modules["matplotlib.pyplot"] = pyplot


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
        if self.cfg.stub_matplotlib:
            _stub_matplotlib()
        try:
            from TTS.api import TTS
        except ModuleNotFoundError as exc:
            raise TTSError(
                f"Paket XTTS belum lengkap (modul hilang: {exc.name}). "
                "Jalankan: pip install -r requirements-xtts.txt (butuh Python 3.11, lihat README)."
            ) from exc
        except Exception as exc:
            raise TTSError(
                f"Gagal mengimpor XTTS: {type(exc).__name__}: {exc}. Lihat README bagian XTTS."
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
