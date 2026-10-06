"""Penulis Naskah: topik -> script.json tervalidasi (via LLM lokal)."""

from __future__ import annotations

import json
from pathlib import Path
from string import Template
from typing import Any

from ..animation.catalog import Catalog
from ..config import AppConfig
from ..llm.base import LLMProvider, Message
from ..llm.structured import generate_structured
from ..models import AgentName
from ..schemas import Script, parse_script, script_json_schema
from .base import Agent, AgentContext

PROMPT_DIR = Path(__file__).with_name("prompts")
LANGUAGE_NAMES = {"id": "Bahasa Indonesia", "en": "English"}


def load_prompt_template(prefix: str, language: str) -> Template:
    """Pilih prompt sesuai bahasa (mis. writer_system_en.md), fallback ke English."""
    for lang in (language, "en"):
        path = PROMPT_DIR / f"{prefix}_{lang}.md"
        if path.exists():
            return Template(path.read_text(encoding="utf-8"))
    raise FileNotFoundError(f"Prompt {prefix} tidak ditemukan untuk bahasa {language}")


def load_content_profile(config: AppConfig) -> dict[str, Any]:
    path = config.resolve(config.content.profile_file)
    if not path.exists():
        return {}
    import yaml

    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data if isinstance(data, dict) else {}


def _profile_text(profile: dict[str, Any]) -> str:
    labels = {
        "channel_name": "Nama channel", "niche": "Niche", "tone": "Nada bicara",
        "recurring_phrases": "Frasa khas channel (pakai bila cocok)",
        "avoid_topics": "Topik yang harus dihindari",
    }
    lines = []
    for key, label in labels.items():
        value = profile.get(key)
        if isinstance(value, list):
            value = ", ".join(str(v) for v in value if v)
        if value:
            lines.append(f"- {label}: {value}")
    return ("\nPROFIL CHANNEL\n" + "\n".join(lines) + "\n") if lines else ""


def _autofix_scenes(scenes: list[Any]) -> None:
    """Jaring pengaman untuk kesalahan kecil LLM yang aman diperbaiki otomatis:
    - teks layar kosong -> isi dari 1-2 kata pertama narasi.
    - scene pertama/terakhir salah template -> paksa intro/outro HANYA jika tanpa items
      (menata objek bukan urusan intro/outro, jadi tidak merusak konten).
    """
    import re as _re

    for i, sc in enumerate(scenes):
        if not isinstance(sc, dict):
            continue
        if not str(sc.get("on_screen_text") or "").strip():
            words = _re.findall(r"[\w'-]+", str(sc.get("narration", "")))
            sc["on_screen_text"] = " ".join(words[:2])[:40] or "..."
        params = sc.get("params") or {}
        no_items = not params.get("items")
        if i == 0 and sc.get("template") not in ("intro",) and no_items:
            sc["template"] = "intro"
        if i == len(scenes) - 1 and sc.get("template") not in ("outro",) and no_items:
            sc["template"] = "outro"


class WriterAgent(Agent):
    name = AgentName.WRITER

    def __init__(self, config: AppConfig, provider: LLMProvider, catalog: Catalog,
                 profile: dict[str, Any] | None = None) -> None:
        self.config = config
        self.provider = provider
        self.catalog = catalog
        self.profile = profile if profile is not None else load_content_profile(config)
        self._schema = script_json_schema(catalog)

    def is_available(self) -> bool:
        return self.provider.is_available()

    # ------------------------------------------------------------ prompt
    def system_prompt(self, ctx: AgentContext) -> str:
        v = self.config.video
        template = load_prompt_template("writer_system", ctx.job.language)
        return template.substitute(
            age_group=ctx.job.age_group,
            language=ctx.job.language,
            language_name=LANGUAGE_NAMES.get(ctx.job.language, ctx.job.language),
            style=ctx.job.style,
            target=f"{v.target_duration_sec:g}",
            min_dur=f"{v.min_duration_sec:g}",
            max_dur=f"{v.max_duration_sec:g}",
            catalog=self.catalog.prompt_listing(),
            profile=_profile_text(self.profile),
        )

    def user_prompt(self, ctx: AgentContext) -> str:
        en = ctx.job.language == "en"
        if en:
            text = (f"Topic: {ctx.job.topic}\nAudience age: {ctx.job.age_group}\n"
                    f"Style: {ctx.job.style}\n\nWrite the script now.")
        else:
            text = (f"Topik: {ctx.job.topic}\nUsia penonton: {ctx.job.age_group} tahun\n"
                    f"Gaya: {ctx.job.style}\n\nTulis naskahnya sekarang.")
        if not ctx.feedback:
            return text
        previous = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        problems = [f"- [{i['criterion']}] {i['reason']}"
                    for i in ctx.feedback.get("items", []) if not i.get("ok")]
        suggestions = [f"- {s}" for s in ctx.feedback.get("suggestions", [])]
        prev_json = json.dumps(previous, ensure_ascii=False)
        if en:
            return (
                f"{text}\n\nREVISION: the previous script did not pass the child-safety review.\n"
                f"Previous script:\n{prev_json}\n\n"
                "Problems found:\n" + ("\n".join(problems) or "- (not detailed)") +
                "\n\nSuggested fixes:\n" + ("\n".join(suggestions) or "- (none)") +
                "\n\nRewrite the COMPLETE script fixing all the problems above."
            )
        return (
            f"{text}\n\nREVISI: naskah sebelumnya belum lolos review keamanan anak.\n"
            f"Naskah sebelumnya:\n{prev_json}\n\n"
            "Masalah yang ditemukan:\n" + ("\n".join(problems) or "- (tidak dirinci)") +
            "\n\nSaran perbaikan:\n" + ("\n".join(suggestions) or "- (tidak ada)") +
            "\n\nTulis ulang naskah LENGKAP yang sudah memperbaiki semua masalah di atas."
        )

    # -------------------------------------------------------------- kerja
    def _parse(self, ctx: AgentContext, data: Any) -> Script:
        if isinstance(data, dict):
            # nilai yang sudah pasti tidak perlu ditebak LLM
            data = dict(data)
            data["age_group"] = ctx.job.age_group
            data["language"] = ctx.job.language
            scenes = data.get("scenes")
            if isinstance(scenes, list):
                _autofix_scenes(scenes)
                try:
                    data["total_duration_sec"] = round(
                        sum(float(s["duration_sec"]) for s in scenes), 2)
                except (KeyError, TypeError, ValueError):
                    pass  # biarkan validator yang melaporkan
        return parse_script(data, self.catalog, self.config.video)

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        rev = f" (revisi ke-{ctx.job.safety_round})" if ctx.feedback else ""
        ctx.log(f"Menulis naskah '{ctx.job.topic}'{rev} dengan {self.provider.name}:"
                f"{self.provider.model}")
        messages = [Message("system", self.system_prompt(ctx)),
                    Message("user", self.user_prompt(ctx))]
        script, attempts = generate_structured(
            self.provider, messages,
            parse=lambda data: self._parse(ctx, data),
            max_retries=self.config.pipeline.max_llm_retries,
            json_schema=self._schema,
            log=ctx.log,
        )
        dumped = script.model_dump(mode="json")
        (ctx.workdir / "script.json").write_text(
            json.dumps(dumped, ensure_ascii=False, indent=2), encoding="utf-8")
        ctx.log(f"Naskah valid: '{script.title}', {len(script.scenes)} scene, "
                f"{script.total_duration_sec:g} detik (percobaan ke-{attempts})")
        return {"script": dumped, "attempts": attempts,
                "provider": self.provider.name, "model": self.provider.model}
