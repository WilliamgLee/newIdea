"""Pengisi Suara: narasi tiap scene -> audio ternormalisasi + timing per kata & kalimat.

Durasi scene disesuaikan dengan panjang audio sebenarnya (+ jeda), lalu total durasi
dijaga di rentang `video.min_duration_sec`-`video.max_duration_sec`.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import AppConfig
from ..media import MediaTools
from ..models import AgentName
from ..schemas import SceneAudio, Script, SentenceTiming, VoiceResult, WordTiming
from ..tts.base import RawWord, TTSEngine, TTSError
from .base import Agent, AgentContext, AgentError

TOKEN_RE = re.compile(r"[\w'-]+")
SENTENCE_RE = re.compile(r"[^.!?]+[.!?]*")
HARD_MAX_SEC = 60.0


# ================================================================ timing
@dataclass
class _Token:
    text: str
    start_char: int
    end_char: int
    start: float | None = None
    end: float | None = None


def _clean(text: str) -> str:
    """Buang tanda baca di awal/akhir (tanda hubung di tengah dipertahankan)."""
    return re.sub(r"^\W+|\W+$", "", text.lower())


def align_words(narration: str, raw_words: list[RawWord],
                audio_duration: float) -> tuple[list[SentenceTiming], float]:
    """Cocokkan batas kata TTS dengan kata di naskah.

    - Kata naskah memakai ejaan naskah (untuk subtitle), timing dari TTS.
    - Kata TTS dicari berurutan di teks naskah; satu kata naskah boleh terdiri dari beberapa
      kata TTS (mis. "guk-guk" -> "guk" + "guk").
    - Kata yang tidak cocok (mis. angka "3" dibaca "tiga") diberi timing interpolasi.
    Mengembalikan (kalimat, porsi kata yang timing-nya dari TTS).
    """
    tokens = [_Token(m.group(0), m.start(), m.end()) for m in TOKEN_RE.finditer(narration)]
    if not tokens:
        return [], 0.0
    clean_narr = narration.lower()

    # 1) posisi tiap kata TTS di teks naskah
    cursor = 0
    for rw in raw_words:
        needle = _clean(rw.text)
        if not needle:
            continue
        pos = _find_word(clean_narr, needle, cursor)
        if pos < 0:
            continue
        span = (pos, pos + len(needle))
        cursor = span[1]
        for tok in tokens:
            if tok.start_char < span[1] and span[0] < tok.end_char:
                tok.start = rw.start if tok.start is None else min(tok.start, rw.start)
                tok.end = rw.end if tok.end is None else max(tok.end, rw.end)
    matched = sum(t.start is not None for t in tokens)

    # 2) interpolasi kata tanpa timing (berdasarkan panjang huruf)
    _interpolate(tokens, audio_duration)

    # 3) paksa urutan naik & batas durasi audio
    prev_end = 0.0
    for tok in tokens:
        assert tok.start is not None and tok.end is not None
        tok.start = min(max(tok.start, prev_end), audio_duration)
        tok.end = min(max(tok.end, tok.start), audio_duration)
        prev_end = tok.start

    # 4) kelompokkan per kalimat
    sentences: list[SentenceTiming] = []
    for m in SENTENCE_RE.finditer(narration):
        text = m.group(0).strip()
        words = [WordTiming(text=t.text, start=round(t.start, 3), end=round(t.end, 3))
                 for t in tokens if m.start() <= t.start_char < m.end()]
        if not text or not words:
            continue
        sentences.append(SentenceTiming(text=text, start=words[0].start,
                                        end=max(w.end for w in words), words=words))
    return sentences, matched / len(tokens)


def _find_word(haystack: str, needle: str, start: int) -> int:
    m = re.compile(r"(?<!\w)" + re.escape(needle)).search(haystack, start)
    return m.start() if m else -1


def _interpolate(tokens: list[_Token], duration: float) -> None:
    i = 0
    n = len(tokens)
    while i < n:
        if tokens[i].start is not None:
            i += 1
            continue
        j = i
        while j < n and tokens[j].start is None:
            j += 1
        left = tokens[i - 1].end if i > 0 else 0.0
        right = tokens[j].start if j < n else duration
        assert left is not None and right is not None
        right = max(right, left)
        gap = tokens[i:j]
        total_chars = sum(len(t.text) for t in gap) or 1
        t = left
        for tok in gap:
            share = (right - left) * len(tok.text) / total_chars
            tok.start, tok.end = t, t + share
            t += share
        i = j


def _faster(rate: str, percent: int) -> str:
    value = int(rate.rstrip("%")) + percent
    return f"{value:+d}%"


# ================================================================= agent
class VoiceAgent(Agent):
    name = AgentName.VOICE

    def __init__(self, config: AppConfig, engine: TTSEngine,
                 media: MediaTools | None = None) -> None:
        self.config = config
        self.engine = engine
        self.media = media or MediaTools()

    def is_available(self) -> bool:
        return self.engine.is_available() and self.media.is_available()

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        raw = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        if not raw:
            raise AgentError("Naskah belum ada")
        script = Script.model_validate(raw)
        result = self.voice_script(script, ctx.workdir, ctx.log)
        (ctx.workdir / "voice.json").write_text(
            json.dumps(result.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8")
        return result.model_dump(mode="json")

    def voice_script(self, script: Script, workdir: Path, log: Any = print) -> VoiceResult:
        """Bisa dipanggil tanpa job (CLI `voice-file`)."""
        cfg, video = self.config.voice, self.config.video
        rate = cfg.rate
        scenes = self._voice_all(script, workdir, rate, log)
        total = sum(s.duration_sec for s in scenes)

        if total > video.max_duration_sec and cfg.speedup_percent > 0:
            rate = _faster(cfg.rate, cfg.speedup_percent)
            log(f"Total {total:.1f} detik > {video.max_duration_sec:g}; ulang dengan rate {rate}")
            scenes = self._voice_all(script, workdir, rate, log)
            total = sum(s.duration_sec for s in scenes)

        if total > HARD_MAX_SEC:
            raise AgentError(f"Total suara {total:.1f} detik melebihi batas {HARD_MAX_SEC:g} "
                             "detik. Perpendek narasi naskah.")
        if total > video.max_duration_sec:
            log(f"PERINGATAN: total {total:.1f} detik melebihi target maks "
                f"{video.max_duration_sec:g} detik")
        if total < video.min_duration_sec:
            extra = video.min_duration_sec - total
            per_scene = extra / len(scenes)
            log(f"Total {total:.1f} detik < {video.min_duration_sec:g}; tiap scene "
                f"ditambah jeda {per_scene:.2f} detik")
            scenes = [s.model_copy(update={"duration_sec": round(s.duration_sec + per_scene, 3)})
                      for s in scenes]
            total = sum(s.duration_sec for s in scenes)

        return VoiceResult(engine=self.engine.name, voice=getattr(self.engine, "voice", ""),
                           rate=rate, scenes=scenes, total_duration_sec=round(total, 3))

    def _voice_all(self, script: Script, workdir: Path, rate: str, log: Any) -> list[SceneAudio]:
        audio_dir = workdir / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        out = []
        for scene in script.scenes:
            out.append(self._voice_scene(scene.id, scene.narration, audio_dir, rate, log))
        return out

    def _voice_scene(self, scene_id: int, narration: str, audio_dir: Path, rate: str,
                     log: Any) -> SceneAudio:
        cfg = self.config.voice
        raw_path = audio_dir / f"scene_{scene_id}_raw{self.engine.audio_ext}"
        wav_path = audio_dir / f"scene_{scene_id}.wav"

        synth = None
        for attempt in range(cfg.max_retries + 1):
            try:
                synth = self.engine.synthesize(narration, raw_path, rate)
                break
            except TTSError as exc:
                if attempt >= cfg.max_retries:
                    raise AgentError(f"Scene {scene_id}: {exc}") from exc
                log(f"Scene {scene_id}: TTS gagal ({exc}), coba lagi")
                time.sleep(1.5 * (attempt + 1))
        assert synth is not None

        self.media.normalize_audio(synth.audio_path, wav_path, cfg.loudness_lufs, cfg.sample_rate)
        audio_dur = self.media.probe_duration(wav_path)
        if audio_dur <= 0:
            raise AgentError(f"Scene {scene_id}: audio kosong")
        sentences, coverage = align_words(narration, synth.words, audio_dur)
        if coverage < 0.8:
            log(f"Scene {scene_id}: hanya {coverage:.0%} kata punya timing dari TTS; "
                "sisanya diperkirakan")
        duration = max(audio_dur + cfg.pause_after_sec, cfg.min_scene_sec)
        log(f"Scene {scene_id}: suara {audio_dur:.2f} detik, scene {duration:.2f} detik")
        return SceneAudio(
            scene_id=scene_id,
            audio_file=f"audio/{wav_path.name}",
            audio_duration_sec=round(audio_dur, 3),
            duration_sec=round(duration, 3),
            sentences=sentences,
            timing_source="word" if coverage >= 0.8 else "estimated",
            word_coverage=round(coverage, 3),
        )
