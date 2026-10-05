"""Pemuatan konfigurasi dari `config.yaml` + `.env`.

Core (config, db, orchestrator) sengaja hanya memakai standard library agar mudah dites.
Validasi kontrak data antar-agent memakai pydantic (lihat `ai_office/schemas.py`, mulai M1).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any, Literal, TypeVar, get_type_hints

PipelineMode = Literal["semi_auto", "full_auto"]
VALID_MODES: tuple[str, ...] = ("semi_auto", "full_auto")
LLM_PROVIDERS: tuple[str, ...] = ("ollama", "gemini")


class ConfigError(ValueError):
    """Konfigurasi tidak valid."""


@dataclass
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8000


@dataclass
class PathsConfig:
    data_dir: str = "data"
    output_dir: str = "output"
    db_file: str = "ai_office.db"


@dataclass
class PipelineConfig:
    mode: str = "semi_auto"
    max_safety_rounds: int = 2
    max_llm_retries: int = 2
    poll_interval_sec: float = 2.0
    just_done_display_sec: float = 15.0


@dataclass
class ContentConfig:
    age_group: str = "3-6"
    language: str = "id"
    style: str = "ceria"
    profile_file: str = "content_profile.yaml"


@dataclass
class LLMConfig:
    provider: str = "ollama"
    model: str = "qwen2.5:7b"
    base_url: str = "http://127.0.0.1:11434"
    timeout_sec: float = 180.0
    temperature: float = 0.7
    num_ctx: int = 8192
    # Untuk model "thinking" (mis. qwen3): false = matikan mode berpikir. null = tidak dikirim.
    think: bool | None = None
    gemini_model: str = "gemini-flash-latest"


@dataclass
class SafetyConfig:
    rubric_file: str = "safety_rubric.yaml"
    temperature: float = 0.2


@dataclass
class VoiceConfig:
    engine: str = "edge-tts"
    voice: str = "id-ID-GadisNeural"
    rate: str = "-5%"            # kecepatan bicara, mis. "-10%" lebih lambat
    pitch: str = "+0Hz"
    pause_after_sec: float = 0.6  # jeda setelah narasi tiap scene (animasi tetap berjalan)
    min_scene_sec: float = 2.0
    loudness_lufs: float = -16.0  # target normalisasi volume (standar platform video)
    sample_rate: int = 48000
    max_retries: int = 2          # retry bila TTS gagal (mis. koneksi putus)
    speedup_percent: int = 15     # dipakai bila total durasi melebihi video.max_duration_sec


@dataclass
class VideoConfig:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    target_duration_sec: float = 30.0
    min_duration_sec: float = 25.0
    max_duration_sec: float = 35.0
    encoder: str = "auto"


@dataclass
class DeliveryConfig:
    dest_dir: str = "~/Videos/AI-Office"
    open_folder: bool = True


AGENT_NAMES: tuple[str, ...] = ("writer", "safety", "voice", "animator", "editor", "delivery")


@dataclass
class AgentsConfig:
    # Agent yang masih memakai versi palsu (simulasi). Agent asli ditambahkan per milestone.
    fake: list[str] = field(default_factory=lambda: ["editor", "delivery"])
    fake_delay_sec: float = 1.0


@dataclass
class AppConfig:
    server: ServerConfig = field(default_factory=ServerConfig)
    paths: PathsConfig = field(default_factory=PathsConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    content: ContentConfig = field(default_factory=ContentConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    voice: VoiceConfig = field(default_factory=VoiceConfig)
    video: VideoConfig = field(default_factory=VideoConfig)
    delivery: DeliveryConfig = field(default_factory=DeliveryConfig)
    agents: AgentsConfig = field(default_factory=AgentsConfig)
    # Folder dasar untuk path relatif (folder tempat config.yaml berada)
    base_dir: Path = field(default_factory=Path.cwd)

    # ---- path turunan ----
    @property
    def data_dir(self) -> Path:
        return self._resolve(self.paths.data_dir)

    @property
    def output_dir(self) -> Path:
        return self._resolve(self.paths.output_dir)

    @property
    def db_path(self) -> Path:
        return self.data_dir / self.paths.db_file

    @property
    def delivery_dir(self) -> Path:
        return Path(os.path.expanduser(self.delivery.dest_dir))

    def _resolve(self, p: str) -> Path:
        path = Path(os.path.expanduser(p))
        return path if path.is_absolute() else (self.base_dir / path)

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def validate(self) -> None:
        if self.pipeline.mode not in VALID_MODES:
            raise ConfigError(
                f"pipeline.mode harus salah satu dari {VALID_MODES}, bukan {self.pipeline.mode!r}"
            )
        if self.pipeline.max_safety_rounds < 0 or self.pipeline.max_llm_retries < 0:
            raise ConfigError("max_safety_rounds / max_llm_retries tidak boleh negatif")
        if not (0 < self.video.min_duration_sec <= self.video.target_duration_sec
                <= self.video.max_duration_sec <= 60):
            raise ConfigError("durasi video harus: 0 < min <= target <= max <= 60")
        if not isinstance(self.agents.fake, list) or any(
                a not in AGENT_NAMES for a in self.agents.fake):
            raise ConfigError(f"agents.fake hanya boleh berisi: {AGENT_NAMES}")
        if self.llm.provider not in LLM_PROVIDERS:
            raise ConfigError(f"llm.provider harus salah satu dari {LLM_PROVIDERS}")
        if self.llm.think is not None and not isinstance(self.llm.think, bool):
            raise ConfigError("llm.think harus true, false, atau null")
        if not re.fullmatch(r"[+-]\d{1,3}%", self.voice.rate):
            raise ConfigError("voice.rate harus berformat seperti '+0%' atau '-10%'")
        if not re.fullmatch(r"[+-]\d{1,3}Hz", self.voice.pitch):
            raise ConfigError("voice.pitch harus berformat seperti '+0Hz' atau '-5Hz'")
        if self.voice.pause_after_sec < 0 or self.voice.min_scene_sec <= 0:
            raise ConfigError("voice.pause_after_sec >= 0 dan voice.min_scene_sec > 0")

    def resolve(self, p: str) -> Path:
        """Path dari config (relatif terhadap folder config.yaml)."""
        return self._resolve(p)

    @property
    def full_auto(self) -> bool:
        return self.pipeline.mode == "full_auto"

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None, base_dir: Path | None = None) -> AppConfig:
        cfg = _build(cls, data or {})
        if base_dir is not None:
            cfg.base_dir = base_dir
        cfg.validate()
        return cfg


T = TypeVar("T")


def _build(dc_type: type[T], data: dict[str, Any]) -> T:
    """Bangun dataclass bertingkat dari dict, menolak kunci yang tidak dikenal."""
    if not isinstance(data, dict):
        raise ConfigError(f"Bagian config untuk {dc_type.__name__} harus berupa mapping")
    hints = get_type_hints(dc_type)
    known = {f.name for f in fields(dc_type)} - {"base_dir"}  # type: ignore[arg-type]
    unknown = set(data) - known
    if unknown:
        raise ConfigError(f"Kunci config tidak dikenal di {dc_type.__name__}: {sorted(unknown)}")
    kwargs: dict[str, Any] = {}
    for name, value in data.items():
        ftype = hints[name]
        if is_dataclass(ftype):
            kwargs[name] = _build(ftype, value or {})  # type: ignore[arg-type]
        elif ftype is float and isinstance(value, int) and not isinstance(value, bool):
            kwargs[name] = float(value)
        elif ftype in (int, float, str, bool) and not isinstance(value, ftype):
            raise ConfigError(
                f"{dc_type.__name__}.{name} harus bertipe {ftype.__name__}, bukan {value!r}"
            )
        else:
            kwargs[name] = value
    return dc_type(**kwargs)


def _load_dotenv(base_dir: Path) -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:  # python-dotenv opsional saat test
        return
    load_dotenv(base_dir / ".env", override=False)


def load_config(path: str | os.PathLike[str] | None = None) -> AppConfig:
    """Muat config dari YAML. Default: env AI_OFFICE_CONFIG atau ./config.yaml."""
    import yaml  # import lokal agar core bisa dites tanpa PyYAML

    cfg_path = Path(path or os.environ.get("AI_OFFICE_CONFIG", "config.yaml")).resolve()
    base_dir = cfg_path.parent
    _load_dotenv(base_dir)
    if not cfg_path.exists():
        raise ConfigError(f"File config tidak ditemukan: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return AppConfig.from_dict(data, base_dir=base_dir)
