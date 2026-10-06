"""Registry mesin TTS."""

from __future__ import annotations

from ..config import VoiceConfig
from .base import RawWord, SynthResult, TTSEngine, TTSError

__all__ = ["RawWord", "SynthResult", "TTSEngine", "TTSError", "build_engine"]


def build_engine(cfg: VoiceConfig, base_dir=None) -> TTSEngine:
    if cfg.engine == "edge-tts":
        from .edge import EdgeTTSEngine

        return EdgeTTSEngine(voice=cfg.voice, pitch=cfg.pitch)
    if cfg.engine == "xtts":
        from .xtts import XTTSEngine

        return XTTSEngine(cfg.xtts, base_dir=base_dir)
    # Contoh menambah mesin lain:
    # if cfg.engine == "piper":
    #     from .piper import PiperEngine
    #     return PiperEngine(model_path=...)
    raise ValueError(f"Mesin TTS tidak dikenal: {cfg.engine!r}")
