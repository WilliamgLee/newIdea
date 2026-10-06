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


def _matplotlib_importable() -> bool:
    try:
        import matplotlib.pyplot  # noqa: F401

        return True
    except Exception:  # noqa: BLE001 - diblokir Smart App Control / DLL gagal
        return False


def _stub_matplotlib() -> None:
    """Cegah XTTS *dan transformers* mengimpor matplotlib asli.

    XTTS-v2 menarik matplotlib lewat modul vocoder yang TIDAK dipakai saat membuat suara.
    `transformers` juga mengecek matplotlib (_is_package_available). Di sebagian Windows
    (Smart App Control), DLL matplotlib (ft2font) diblokir dan menggagalkan impor. Fungsi ini:
      1) memasang modul `matplotlib` + submodul tiruan (API minimal yang disentuh), DAN
      2) menyembunyikan metadata matplotlib dari transformers agar transformers menganggapnya
         tidak terpasang (sehingga tidak mencoba mengimpornya).
    Hanya aktif bila matplotlib asli memang tidak bisa di-import. Tidak memengaruhi grafik apa pun
    di runtime kita (kita tidak membuat grafik).
    """
    import importlib.metadata as im
    import sys
    import types
    from importlib import machinery

    if getattr(sys.modules.get("matplotlib"), "__aioffice_stub__", False):
        return
    if _matplotlib_importable():
        return  # matplotlib asli jalan, tidak perlu stub
    log.info("matplotlib diblokir/gagal di-import; memasang stub agar XTTS tetap jalan")

    def _noop(*a, **k):
        return None

    def _make_module(name: str) -> types.ModuleType:
        mod = types.ModuleType(name)
        # transformers & lib lain mengecek __spec__; beri spec minimal agar tidak None.
        mod.__spec__ = machinery.ModuleSpec(name, loader=None)
        mod.__loader__ = None
        return mod

    mpl = _make_module("matplotlib")
    mpl.__version__ = "0.0.0-stub"
    mpl.__aioffice_stub__ = True
    mpl.__path__ = []  # tandai sebagai package agar submodul bisa diimpor
    mpl.use = _noop
    mpl.get_backend = lambda: "Agg"
    pyplot = _make_module("matplotlib.pyplot")
    for fn in ("plot", "figure", "subplots", "close", "savefig", "imshow", "colorbar",
               "title", "xlabel", "ylabel", "tight_layout", "clf", "cla", "legend",
               "scatter", "bar", "xticks", "yticks", "pcolor", "pcolormesh", "show", "axis"):
        setattr(pyplot, fn, _noop)
    pyplot.gcf = lambda *a, **k: types.SimpleNamespace(
        canvas=types.SimpleNamespace(draw=_noop, tostring_rgb=lambda: b""))
    cm = _make_module("matplotlib.cm")
    colors = _make_module("matplotlib.colors")
    mpl.pyplot = pyplot
    mpl.cm = cm
    mpl.colors = colors
    sys.modules.update({"matplotlib": mpl, "matplotlib.pyplot": pyplot,
                        "matplotlib.cm": cm, "matplotlib.colors": colors})

    # Buat transformers menganggap matplotlib TIDAK terpasang (hindari pengecekan yang memicu
    # import DLL yang diblokir).
    _orig_version = im.version

    def _patched_version(name: str):
        if name == "matplotlib":
            raise im.PackageNotFoundError(name)
        return _orig_version(name)

    im.version = _patched_version


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
