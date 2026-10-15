"""Pembuat Animasi: Script + VoiceResult -> klip animasi MP4 (tanpa audio).

Semua render deterministik dari plan; tidak ada LLM. Audio/subtitle/musik di M4.
"""

from __future__ import annotations

import json
from typing import Any

from ..animation.plan import build_plan
from ..animation.renderer.render import FrameRenderer, render_plan_to_mp4
from ..config import AppConfig
from ..media import MediaTools
from ..models import AgentName
from ..schemas import Script, VoiceResult
from .base import Agent, AgentContext, AgentError


class AnimatorAgent(Agent):
    name = AgentName.ANIMATOR

    def __init__(self, config: AppConfig, renderer: FrameRenderer | None = None,
                 media: MediaTools | None = None) -> None:
        self.config = config
        self.renderer = renderer or FrameRenderer(config.video.width, config.video.height)
        self.media = media or MediaTools()

    def is_available(self) -> bool:
        return self.renderer.is_available() and self.media.is_available()

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        raw = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        voice_raw = ctx.artifacts.get(AgentName.VOICE.value)
        if not raw:
            raise AgentError("Naskah belum ada")
        if not voice_raw:
            raise AgentError("Hasil suara belum ada (Animator butuh timing dari Pengisi Suara)")
        script = Script.model_validate(raw)
        voice = VoiceResult.model_validate(voice_raw)

        plan = build_plan(script, voice, self.config.video.fps)
        (ctx.workdir / "plan.json").write_text(
            json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")

        mp4 = render_plan_to_mp4(plan, ctx.workdir, self.config.video.fps,
                                 self.config.video.encoder, self.renderer, ctx.log)
        return {
            "clip_file": mp4.name,
            "frames": len(list((ctx.workdir / "frames").glob("frame_*.png"))),
            "fps": self.config.video.fps,
            "total_duration_sec": plan["total_duration"],
        }
