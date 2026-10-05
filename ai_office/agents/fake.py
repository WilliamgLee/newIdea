"""Agent palsu (M0): mensimulasikan kerja tiap agent tanpa LLM/TTS/render.

Dipakai saat `agents.use_fake: true` dan di test. Akan diganti agent asli per milestone.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from ..models import AgentName
from .base import Agent, AgentContext


class _FakeBase(Agent):
    def __init__(self, delay_sec: float = 0.0) -> None:
        self.delay_sec = delay_sec

    def _work(self, ctx: AgentContext, what: str) -> None:
        ctx.log(f"[palsu] {what}")
        if self.delay_sec > 0:
            time.sleep(self.delay_sec)

    @staticmethod
    def _write_json(path: Path, data: Any) -> str:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return path.name


class FakeWriter(_FakeBase):
    name = AgentName.WRITER

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        rev = " (revisi)" if ctx.feedback else ""
        self._work(ctx, f"menulis naskah untuk topik '{ctx.job.topic}'{rev}")
        topic = ctx.job.topic
        script = {
            "title": f"Ayo Belajar: {topic.title()}!",
            "age_group": ctx.job.age_group,
            "language": ctx.job.language,
            "total_duration_sec": 30,
            "hook": f"Hai teman! Tahukah kamu tentang {topic}?",
            "scenes": [
                {"id": i, "narration": f"Adegan {i} tentang {topic}.", "on_screen_text": "",
                 "duration_sec": 6, "template": "intro" if i == 1 else "point_object",
                 "params": {"character": "kiki", "pose": "wave", "emotion": "happy",
                            "background": "sky"}}
                for i in range(1, 6)
            ],
            "learning_goal": f"Anak mengenal {topic}",
            "hashtags": ["#Shorts", "#BelajarAnak"],
        }
        self._write_json(ctx.workdir / "script.json", script)
        return {"script": script}


class FakeSafety(_FakeBase):
    """Verdict bisa diatur untuk test: mis. ["revise", "pass"] -> revisi dulu, lalu lulus."""

    name = AgentName.SAFETY

    def __init__(self, delay_sec: float = 0.0, verdicts: list[str] | None = None) -> None:
        super().__init__(delay_sec)
        self.verdicts = list(verdicts or [])

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self._work(ctx, "meninjau naskah dengan rubrik keamanan anak")
        verdict = self.verdicts.pop(0) if self.verdicts else "pass"
        return {
            "verdict": verdict,
            "items": [{"criterion": "bahasa_sederhana", "ok": verdict == "pass",
                       "reason": "simulasi"}],
            "suggestions": [] if verdict == "pass" else ["Sederhanakan kalimat (simulasi)."],
        }


class FakeVoice(_FakeBase):
    name = AgentName.VOICE

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self._work(ctx, "membuat suara per scene")
        scenes = ctx.artifacts.get("writer", {}).get("script", {}).get("scenes", [])
        return {"scenes": [{"id": s["id"], "duration_sec": s["duration_sec"]} for s in scenes]}


class FakeAnimator(_FakeBase):
    name = AgentName.ANIMATOR

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self._work(ctx, "merender animasi 1080x1920 @30fps")
        return {"frames": 900, "fps": 30}


class FakeEditor(_FakeBase):
    name = AgentName.EDITOR

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self._work(ctx, "menggabungkan video, suara, musik, dan subtitle")
        name = self._write_json(ctx.workdir / "video_placeholder.json", {"fake": True})
        return {"video_file": name, "duration_sec": 30.0}


class FakeDelivery(_FakeBase):
    name = AgentName.DELIVERY

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        # Versi palsu tidak menyalin ke ~/Videos agar tidak mengotori folder pengguna.
        self._work(ctx, "mengirim hasil ke folder tujuan (simulasi, tidak menyalin)")
        return {"delivered": False, "simulated": True}


def build_fake_agents(delay_sec: float = 0.0) -> dict[AgentName, Agent]:
    agents: list[Agent] = [
        FakeWriter(delay_sec), FakeSafety(delay_sec), FakeVoice(delay_sec),
        FakeAnimator(delay_sec), FakeEditor(delay_sec), FakeDelivery(delay_sec),
    ]
    return {a.name: a for a in agents}
