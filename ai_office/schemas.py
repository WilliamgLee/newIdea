"""Kontrak data antar-agent (pydantic v2).

- `Script`          : output Penulis Naskah (script.json)
- `SafetyReview`    : output LLM Penasihat Keamanan (mentah)
- `SafetyReport`    : hasil akhir review (LLM + pemeriksaan otomatis) yang disimpan
- `VoiceResult`     : output Pengisi Suara (audio + timing per kata/kalimat) - dipakai M2
- `VideoMetadata`   : metadata akhir video - dipakai M4
"""

from __future__ import annotations

import copy
import re
from datetime import datetime
from typing import TYPE_CHECKING, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

if TYPE_CHECKING:
    from .animation.catalog import Catalog
    from .config import VideoConfig

MAX_HOOK_WORDS = 8          # ±2 detik pertama
MAX_WORDS_PER_SEC = 3.0     # narasi lebih padat dari ini tidak muat di durasi scene


class OutputInvalid(ValueError):
    """Output (LLM/admin) tidak lolos validasi. `errors` berisi pesan yang bisa dibaca LLM."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def format_validation_error(exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(root)"
        out.append(f"{loc}: {err['msg']}")
    return out


def word_count(text: str) -> int:
    return len(re.findall(r"[\w'-]+", text))


def _norm(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.lower()))


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# =============================================================== naskah
class SceneParams(_Model):
    character: str
    pose: str
    emotion: str
    background: str
    items: list[str] = Field(default_factory=list, max_length=2)
    count: int | None = None
    color: str | None = None


class Scene(_Model):
    id: int = Field(ge=1)
    narration: str = Field(min_length=1, max_length=300)
    on_screen_text: str = Field(default="", max_length=40)
    duration_sec: float = Field(ge=2, le=15)
    template: str
    params: SceneParams

    @field_validator("on_screen_text", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return "" if v is None else v


class Script(_Model):
    title: str = Field(min_length=3, max_length=70)
    age_group: str = Field(pattern=r"^\d{1,2}-\d{1,2}$")
    language: str = Field(min_length=2, max_length=5)
    total_duration_sec: float = Field(gt=0, le=60)
    hook: str = Field(min_length=3, max_length=80)
    scenes: list[Scene] = Field(min_length=4, max_length=6)
    learning_goal: str = Field(min_length=3, max_length=200)
    hashtags: list[str] = Field(default_factory=list, max_length=20)  # dipangkas jadi maks 8

    @field_validator("hashtags")
    @classmethod
    def _normalize_hashtags(cls, tags: list[str]) -> list[str]:
        """Rapikan hashtag dan pastikan #Shorts ada di urutan pertama."""
        seen: set[str] = set()
        out = ["#Shorts"]
        seen.add("#shorts")
        for tag in tags:
            clean = "#" + re.sub(r"[^\w]", "", tag)
            if len(clean) > 1 and clean.lower() not in seen:
                seen.add(clean.lower())
                out.append(clean)
        return out[:8]

    @model_validator(mode="after")
    def _check_structure(self) -> Script:
        ids = [s.id for s in self.scenes]
        if ids != list(range(1, len(ids) + 1)):
            raise ValueError(f"id scene harus berurutan 1..{len(ids)}, bukan {ids}")
        if word_count(self.hook) > MAX_HOOK_WORDS:
            raise ValueError(f"hook maksimal {MAX_HOOK_WORDS} kata (harus muat di 2 detik)")
        if not _norm(self.scenes[0].narration).startswith(_norm(self.hook)):
            raise ValueError("narration scene 1 harus diawali dengan kalimat hook yang sama persis")
        total = sum(s.duration_sec for s in self.scenes)
        if abs(total - self.total_duration_sec) > 1.0:
            raise ValueError(
                f"total_duration_sec ({self.total_duration_sec}) harus sama dengan jumlah "
                f"duration_sec semua scene ({total})"
            )
        return self

    @property
    def narration_text(self) -> str:
        return " ".join(s.narration for s in self.scenes)


def parse_script(data: Any, catalog: Catalog, video: VideoConfig | None = None) -> Script:
    """Validasi lengkap: skema + katalog animasi + durasi + kepadatan narasi.

    Raise `OutputInvalid` berisi semua pesan error (dikirim balik ke LLM saat retry).
    """
    if not isinstance(data, dict):
        raise OutputInvalid(["output harus berupa objek JSON"])
    try:
        script = Script.model_validate(data)
    except ValidationError as exc:
        raise OutputInvalid(format_validation_error(exc)) from exc

    errors: list[str] = []
    if script.scenes[0].template != "intro":
        errors.append("scene 1 wajib memakai template 'intro'")
    if script.scenes[-1].template != "outro":
        errors.append(f"scene terakhir (scene {script.scenes[-1].id}) wajib memakai "
                      "template 'outro' sebagai penutup")
    for scene in script.scenes[1:-1]:
        if scene.template in ("intro", "outro"):
            errors.append(f"scene {scene.id}: template '{scene.template}' hanya boleh di "
                          "scene pertama/terakhir")

    seen_items: dict[str, int] = {}
    for scene in script.scenes:
        errors.extend(catalog.scene_errors(scene.id, scene.template, scene.params))
        if not scene.on_screen_text:
            errors.append(f"scene {scene.id}: on_screen_text wajib diisi (1-3 kata kunci)")
        if scene.template == "guess":
            for item in scene.params.items:
                if item in seen_items:
                    errors.append(f"scene {scene.id}: tebak-tebakan harus memakai objek BARU, "
                                  f"'{item}' sudah muncul di scene {seen_items[item]}")
        for item in scene.params.items:
            seen_items.setdefault(item, scene.id)
    usage: dict[str, int] = {}
    for scene in script.scenes:
        for item in set(scene.params.items):
            usage[item] = usage.get(item, 0) + 1
    for item, n in usage.items():
        if n > 2:
            errors.append(f"objek '{item}' dipakai di {n} scene (maks 2). Variasikan objeknya")
    for scene in script.scenes:
        words = word_count(scene.narration)
        if words > scene.duration_sec * MAX_WORDS_PER_SEC:
            errors.append(
                f"scene {scene.id}: narasi {words} kata terlalu panjang untuk "
                f"{scene.duration_sec:g} detik (maks {int(scene.duration_sec * MAX_WORDS_PER_SEC)})"
            )
    if video is not None and not (
        video.min_duration_sec <= script.total_duration_sec <= video.max_duration_sec
    ):
        errors.append(
            f"total durasi {script.total_duration_sec:g} detik harus antara "
            f"{video.min_duration_sec:g}-{video.max_duration_sec:g} detik"
        )
    if errors:
        raise OutputInvalid(errors)
    return script


def script_json_schema(catalog: Catalog) -> dict[str, Any]:
    """JSON schema naskah dengan enum dari katalog (dipakai structured output Ollama)."""
    schema = copy.deepcopy(Script.model_json_schema())
    params = schema["$defs"]["SceneParams"]["properties"]
    poses = sorted({p for c in catalog.characters.values() for p in c.poses})
    emotions = sorted({e for c in catalog.characters.values() for e in c.emotions})
    params["character"] = {"type": "string", "enum": sorted(catalog.characters)}
    params["pose"] = {"type": "string", "enum": poses}
    params["emotion"] = {"type": "string", "enum": emotions}
    params["background"] = {"type": "string", "enum": sorted(catalog.backgrounds)}
    params["items"] = {"type": "array", "maxItems": 2,
                       "items": {"type": "string", "enum": sorted(catalog.all_objects)}}
    params["color"] = {"anyOf": [{"type": "string", "enum": sorted(catalog.colors)},
                                 {"type": "null"}]}
    schema["$defs"]["Scene"]["properties"]["template"] = {
        "type": "string", "enum": list(catalog.templates)}
    return schema


# ======================================================== review keamanan
class CriterionResult(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    criterion: str
    ok: bool
    reason: str = Field(default="", max_length=600)

    @field_validator("reason", mode="before")
    @classmethod
    def _none_to_empty(cls, v: Any) -> Any:
        return "" if v is None else v


class SafetyReview(BaseModel):
    """Output mentah LLM Penasihat Keamanan."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    verdict: Literal["pass", "revise"]
    items: list[CriterionResult]
    suggestions: list[str] = Field(default_factory=list)
    summary: str = ""

    @field_validator("verdict", mode="before")
    @classmethod
    def _lower(cls, v: Any) -> Any:
        return v.strip().lower() if isinstance(v, str) else v

    @field_validator("summary", mode="before")
    @classmethod
    def _summary_none(cls, v: Any) -> Any:
        return "" if v is None else v


def parse_safety_review(data: Any, criteria_ids: list[str]) -> SafetyReview:
    if not isinstance(data, dict):
        raise OutputInvalid(["output harus berupa objek JSON"])
    try:
        review = SafetyReview.model_validate(data)
    except ValidationError as exc:
        raise OutputInvalid(format_validation_error(exc)) from exc
    got = [i.criterion for i in review.items]
    errors = []
    missing = [c for c in criteria_ids if c not in got]
    unknown = [c for c in got if c not in criteria_ids]
    dupes = sorted({c for c in got if got.count(c) > 1})
    if missing:
        errors.append(f"items belum menilai kriteria: {missing}")
    if unknown:
        errors.append(f"items berisi kriteria tidak dikenal: {unknown}. Gunakan: {criteria_ids}")
    if dupes:
        errors.append(f"kriteria dinilai lebih dari sekali: {dupes}")
    if any(not i.ok and not i.reason for i in review.items):
        errors.append("setiap kriteria yang tidak ok wajib punya reason")
    if errors:
        raise OutputInvalid(errors)
    return review


class AutomatedFlag(_Model):
    criterion: str
    reason: str


class SafetyItem(_Model):
    criterion: str
    description: str
    ok: bool
    reason: str
    source: Literal["llm", "automated", "llm+automated"]


class SafetyReport(_Model):
    """Hasil akhir review yang disimpan di DB & ditampilkan di dashboard admin."""

    verdict: Literal["pass", "revise"]
    items: list[SafetyItem]
    suggestions: list[str]
    summary: str
    automated_flags: list[AutomatedFlag]
    llm_verdict: Literal["pass", "revise"]


# ========================================================== suara (M2)
class WordTiming(_Model):
    text: str
    start: float = Field(ge=0)       # detik, relatif terhadap awal audio scene
    end: float = Field(ge=0)

    @model_validator(mode="after")
    def _order(self) -> WordTiming:
        if self.end < self.start:
            raise ValueError("end harus >= start")
        return self


class SentenceTiming(_Model):
    text: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    words: list[WordTiming] = Field(default_factory=list)


class SceneAudio(_Model):
    scene_id: int = Field(ge=1)
    audio_file: str                  # nama file relatif terhadap folder job
    duration_sec: float = Field(gt=0)
    sentences: list[SentenceTiming]


class VoiceResult(_Model):
    engine: str
    voice: str
    scenes: list[SceneAudio]
    total_duration_sec: float = Field(gt=0)


# ======================================================== metadata (M4)
class VideoMetadata(_Model):
    job_id: int
    title: str = Field(max_length=100)
    description: str = Field(max_length=5000)
    hashtags: list[str]
    duration_sec: float = Field(gt=0, le=60)
    width: int = 1080
    height: int = 1920
    age_group: str
    language: str
    learning_goal: str
    made_for_kids: bool = True       # pengingat: tandai "Made for kids" saat upload
    created_at: datetime
