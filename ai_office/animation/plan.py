"""Membangun 'plan animasi' dari Script + VoiceResult.

Plan adalah JSON datar yang dikonsumsi pustaka JS (`renderFrame(plan, t)`).
Timing kata dipakai untuk lip-sync; tidak ada LLM di tahap ini.
"""

from __future__ import annotations

from typing import Any

from ..schemas import Script, VoiceResult


def build_plan(script: Script, voice: VoiceResult, fps: int = 30) -> dict[str, Any]:
    audio_by_id = {s.scene_id: s for s in voice.scenes}
    scenes: list[dict[str, Any]] = []
    start = 0.0
    for scene in script.scenes:
        audio = audio_by_id.get(scene.id)
        duration = audio.duration_sec if audio else scene.duration_sec
        words = []
        if audio:
            for w in audio.words:
                words.append({"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3)})
        scenes.append({
            "id": scene.id,
            "start": round(start, 3),
            "duration": round(duration, 3),
            "template": scene.template,
            "character": scene.params.character,
            "pose": scene.params.pose,
            "emotion": scene.params.emotion,
            "background": scene.params.background,
            "items": list(scene.params.items),
            "count": scene.params.count,
            "color": scene.params.color,
            "text": scene.on_screen_text,
            "narration": scene.narration,
            "words": words,
        })
        start += duration
    return {
        "title": script.title,
        "fps": fps,
        "width": 1080,
        "height": 1920,
        "total_duration": round(start, 3),
        "scenes": scenes,
    }


def frame_times(total: float, fps: int) -> list[float]:
    """Waktu tengah tiap frame (detik). Jumlah frame = ceil(total*fps)."""
    import math

    n = max(1, math.ceil(round(total * fps, 6)))
    return [round((i + 0.5) / fps, 6) for i in range(n)]
