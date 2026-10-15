"""Test M2: Pengisi Suara. TTS & ffmpeg di-mock; ada 1 test integrasi ffmpeg (skip bila
ffmpeg tidak terpasang)."""

from __future__ import annotations

import itertools
import json
import re
import shutil
import subprocess
import sys
import types
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from ai_office.agents.base import AgentContext, AgentError
from ai_office.agents.voice import VoiceAgent, _faster, align_words
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.media import MediaTools, normalize_cmd
from ai_office.schemas import Script, VoiceResult
from ai_office.tts.base import RawWord, SynthResult, TTSEngine, TTSError

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = json.loads((ROOT / "examples" / "mengenal_warna.json").read_text(encoding="utf-8"))
TOKENS = re.compile(r"[\w'-]+")


# ================================================================ alignment
def words_at(texts: list[str], step: float = 0.4) -> list[RawWord]:
    return [RawWord(t, i * step, i * step + step * 0.8) for i, t in enumerate(texts)]


def flat(sentences) -> list:
    return [w for s in sentences for w in s.words]


def test_align_exact_match() -> None:
    text = "Ini apel. Apel warnanya merah!"
    sentences, cov = align_words(text, words_at(["Ini", "apel", "Apel", "warnanya", "merah"]), 3)
    assert cov == 1.0
    assert [s.text for s in sentences] == ["Ini apel.", "Apel warnanya merah!"]
    words = flat(sentences)
    assert [w.text for w in words] == ["Ini", "apel", "Apel", "warnanya", "merah"]
    assert words[2].start == pytest.approx(0.8) and words[2].end == pytest.approx(1.12)
    assert sentences[1].start == words[2].start


def test_align_hyphenated_word_split_by_tts() -> None:
    sentences, cov = align_words("Anjing guk-guk!", words_at(["Anjing", "guk", "guk"]), 2)
    words = flat(sentences)
    assert [w.text for w in words] == ["Anjing", "guk-guk"]
    assert words[1].start == pytest.approx(0.4) and words[1].end == pytest.approx(1.12)
    assert cov == 1.0


def test_align_number_read_differently_is_interpolated() -> None:
    # TTS membaca "3" sebagai "tiga" -> tidak cocok, timing diperkirakan di antara tetangga
    raw = [RawWord("Ada", 0.0, 0.3), RawWord("tiga", 0.4, 0.7), RawWord("apel", 0.8, 1.1)]
    sentences, cov = align_words("Ada 3 apel.", raw, 1.5)
    words = flat(sentences)
    assert [w.text for w in words] == ["Ada", "3", "apel"]
    assert cov == pytest.approx(2 / 3)
    assert 0.3 <= words[1].start <= words[1].end <= 0.8


def test_align_without_tts_timing_estimates_whole_audio() -> None:
    sentences, cov = align_words("Halo teman. Ayo belajar!", [], 2.0)
    words = flat(sentences)
    assert cov == 0.0 and len(words) == 4
    assert words[0].start == 0 and words[-1].end == pytest.approx(2.0)
    assert all(a.start <= b.start for a, b in itertools.pairwise(words))


def test_align_clamps_to_audio_duration() -> None:
    sentences, _ = align_words("Halo", [RawWord("Halo", 0.5, 9.0)], 1.0)
    assert flat(sentences)[0].end == 1.0


def test_faster_rate() -> None:
    assert _faster("-5%", 15) == "+10%"
    assert _faster("+0%", 15) == "+15%"


# ================================================================ agent
class FakeEngine(TTSEngine):
    """Setiap kata 0,3 detik; mencatat rate yang dipakai."""

    name = "fake-tts"
    voice = "id-ID-Tes"

    def __init__(self, sec_per_word: float = 0.3, fail_times: int = 0) -> None:
        self.sec_per_word = sec_per_word
        self.fail_times = fail_times
        self.calls: list[tuple[str, str]] = []

    def synthesize(self, text: str, out_path: Path, rate: str) -> SynthResult:
        self.calls.append((text, rate))
        if self.fail_times > 0:
            self.fail_times -= 1
            raise TTSError("koneksi putus")
        speed = 1 + int(rate.rstrip("%")) / 100
        words = []
        for i, m in enumerate(TOKENS.finditer(text)):
            start = 0.1 + i * self.sec_per_word / speed
            words.append(RawWord(m.group(0), start, start + 0.25 / speed))
        out_path.write_bytes(json.dumps({"dur": words[-1].end + 0.1}).encode())
        return SynthResult(audio_path=out_path, words=words)


class FakeMedia(MediaTools):
    def __init__(self) -> None:
        self.normalized: list[tuple[Path, Path, float, int]] = []

    def is_available(self) -> bool:
        return True

    def normalize_audio(self, src: Path, dst: Path, lufs: float, sample_rate: int) -> None:
        self.normalized.append((src, dst, lufs, sample_rate))
        shutil.copyfile(src, dst)

    def probe_duration(self, path: Path) -> float:
        return float(json.loads(path.read_bytes())["dur"])


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    cfg = AppConfig.from_dict({"paths": {"data_dir": str(tmp_path / "data"),
                                         "output_dir": str(tmp_path / "out")}}, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


def make_ctx(config: AppConfig, script: dict[str, Any]) -> tuple[AgentContext, list[str]]:
    db = Database(config.db_path)
    db.init()
    job = db.create_job("mengenal warna", "3-6", "ceria", "id")
    job.artifacts = {"writer": {"script": script}}
    workdir = config.output_dir / f"job_{job.id}"
    workdir.mkdir(parents=True)
    logs: list[str] = []
    return AgentContext(job=job, config=config, workdir=workdir, log=logs.append), logs


def test_voice_agent_every_scene_has_audio_and_matching_timing(config: AppConfig) -> None:
    """Kriteria selesai M2: tiap scene punya audio + timing yang cocok dengan teks."""
    media = FakeMedia()
    ctx, _ = make_ctx(config, EXAMPLE)
    out = VoiceAgent(config, FakeEngine(), media).run(ctx)

    result = VoiceResult.model_validate(out)
    script = Script.model_validate(EXAMPLE)
    assert [s.scene_id for s in result.scenes] == [s.id for s in script.scenes]
    for scene, audio in zip(script.scenes, result.scenes, strict=True):
        assert (ctx.workdir / audio.audio_file).exists()
        # kata di timing == kata di narasi, urut, dan di dalam durasi audio
        assert [w.text for w in audio.words] == TOKENS.findall(scene.narration)
        assert audio.timing_source == "word" and audio.word_coverage == 1.0
        assert all(0 <= w.start <= w.end <= audio.audio_duration_sec for w in audio.words)
        assert " ".join(s.text for s in audio.sentences) == scene.narration
        assert audio.duration_sec >= audio.audio_duration_sec + config.voice.pause_after_sec - 1e-6
    assert result.total_duration_sec == pytest.approx(sum(s.duration_sec for s in result.scenes))
    assert (ctx.workdir / "voice.json").exists()
    lufs = {n[2] for n in media.normalized}
    assert lufs == {config.voice.loudness_lufs} and len(media.normalized) == 6


def test_short_audio_is_padded_to_minimum(config: AppConfig) -> None:
    ctx, logs = make_ctx(config, EXAMPLE)
    out = VoiceAgent(config, FakeEngine(sec_per_word=0.1), FakeMedia()).run(ctx)
    assert out["total_duration_sec"] == pytest.approx(config.video.min_duration_sec, abs=0.01)
    assert any("ditambah jeda" in m for m in logs)


def test_long_audio_is_sped_up_once(config: AppConfig) -> None:
    engine = FakeEngine(sec_per_word=1.0)
    ctx, logs = make_ctx(config, EXAMPLE)
    out = VoiceAgent(config, engine, FakeMedia()).run(ctx)
    rates = {r for _, r in engine.calls}
    assert rates == {config.voice.rate, _faster(config.voice.rate, config.voice.speedup_percent)}
    assert out["rate"] == _faster(config.voice.rate, config.voice.speedup_percent)
    assert any("ulang dengan rate" in m for m in logs)


def test_too_long_even_after_speedup_fails(config: AppConfig) -> None:
    ctx, _ = make_ctx(config, EXAMPLE)
    with pytest.raises(AgentError, match="Perpendek narasi"):
        VoiceAgent(config, FakeEngine(sec_per_word=2.0), FakeMedia()).run(ctx)


def test_tts_retry_then_success(config: AppConfig, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ai_office.agents.voice.time.sleep", lambda s: None)
    engine = FakeEngine(fail_times=2)
    ctx, logs = make_ctx(config, EXAMPLE)
    VoiceAgent(config, engine, FakeMedia()).run(ctx)
    assert sum("coba lagi" in m for m in logs) == 2


def test_tts_gives_up(config: AppConfig, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ai_office.agents.voice.time.sleep", lambda s: None)
    ctx, _ = make_ctx(config, EXAMPLE)
    with pytest.raises(AgentError, match="Scene 1: koneksi putus"):
        VoiceAgent(config, FakeEngine(fail_times=99), FakeMedia()).run(ctx)


def test_voice_in_pipeline(config: AppConfig) -> None:
    from mock_llm import RoutedLLM
    from test_m1_pipeline import review

    from ai_office.agents import build_agents
    from ai_office.agents.base import Agent
    from ai_office.events import EventBus
    from ai_office.models import AgentName, JobStatus
    from ai_office.orchestrator import Orchestrator

    class StubAnimator(Agent):
        name = AgentName.ANIMATOR

        def run(self, ctx):
            return {"clip_file": "animation.mp4", "frames": 1, "fps": 30,
                    "total_duration_sec": 30.0}

    class StubEditor(Agent):
        name = AgentName.EDITOR

        def run(self, ctx):
            return {"video_file": "video.mp4", "duration_sec": 30.0, "encoder": "libx264"}

    agents = build_agents(config, provider=RoutedLLM(writer=[EXAMPLE], safety=[review()]))
    agents[AgentName.VOICE] = VoiceAgent(config, FakeEngine(), FakeMedia())
    agents[AgentName.ANIMATOR] = StubAnimator()
    agents[AgentName.EDITOR] = StubEditor()
    db = Database(config.db_path)
    db.init()
    orch = Orchestrator(config, db, EventBus(), agents)
    job = orch.process_job(orch.create_job("mengenal warna").id)
    orch.approve_script(job.id)
    job = orch.process_job(job.id)
    assert job.status == JobStatus.AWAITING_FINAL_APPROVAL
    assert len(job.artifacts["voice"]["scenes"]) == 6


# ============================================================ edge-tts engine
def fake_edge_module(accepts_boundary: bool) -> types.ModuleType:
    mod = types.ModuleType("edge_tts")
    seen: dict[str, Any] = {}

    class Communicate:
        def __init__(self, text: str, voice: str, rate: str, pitch: str, **kw: Any) -> None:
            if "boundary" in kw and not accepts_boundary:
                raise TypeError("unexpected keyword 'boundary'")
            seen.update(text=text, voice=voice, rate=rate, pitch=pitch, **kw)

        async def stream(self):
            yield {"type": "audio", "data": b"abc"}
            yield {"type": "WordBoundary", "offset": 1_000_000, "duration": 3_000_000,
                   "text": "Halo"}
            yield {"type": "SentenceBoundary", "offset": 0, "duration": 1, "text": "x"}
            yield {"type": "audio", "data": b"def"}

    mod.Communicate = Communicate  # type: ignore[attr-defined]
    mod.seen = seen  # type: ignore[attr-defined]
    return mod


@pytest.mark.parametrize("accepts_boundary", [True, False])
def test_edge_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                     accepts_boundary: bool) -> None:
    from ai_office.tts.edge import EdgeTTSEngine

    mod = fake_edge_module(accepts_boundary)
    monkeypatch.setitem(sys.modules, "edge_tts", mod)
    out = tmp_path / "a.mp3"
    res = EdgeTTSEngine("id-ID-GadisNeural").synthesize("Halo", out, "-5%")
    assert out.read_bytes() == b"abcdef"
    assert res.words == [RawWord("Halo", 0.1, pytest.approx(0.4))]
    assert mod.seen["voice"] == "id-ID-GadisNeural" and mod.seen["rate"] == "-5%"
    assert mod.seen.get("boundary") == ("WordBoundary" if accepts_boundary else None)


def test_edge_engine_wraps_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from ai_office.tts.edge import EdgeTTSEngine

    mod = types.ModuleType("edge_tts")

    class Communicate:
        def __init__(self, *a: Any, **k: Any) -> None:
            pass

        async def stream(self):
            raise ConnectionError("offline")
            yield  # pragma: no cover

    mod.Communicate = Communicate  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "edge_tts", mod)
    with pytest.raises(TTSError, match="koneksi internet"):
        EdgeTTSEngine("v").synthesize("Halo", tmp_path / "a.mp3", "+0%")


# ================================================================ ffmpeg
def test_normalize_cmd() -> None:
    cmd = normalize_cmd("ffmpeg", Path("a.mp3"), Path("b.wav"), -16.0, 48000)
    assert "loudnorm=I=-16:TP=-1.5:LRA=11" in cmd
    assert cmd[-1] == "b.wav" and "48000" in cmd and "-ac" in cmd


@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
                    reason="ffmpeg/ffprobe tidak terpasang")
def test_ffmpeg_normalize_and_probe_real(tmp_path: Path) -> None:
    src = tmp_path / "tone.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i",
                    "sine=frequency=440:duration=1.5", str(src)], check=True)
    dst = tmp_path / "norm.wav"
    tools = MediaTools()
    tools.normalize_audio(src, dst, -16.0, 48000)
    assert tools.probe_duration(dst) == pytest.approx(1.5, abs=0.1)
