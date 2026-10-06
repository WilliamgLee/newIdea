"""Test adapter XTTS. Paket TTS/torch asli TIDAK dipasang di CI; semua di-mock lewat sys.modules.
Yang diuji: pemilihan speaker/clone, device, pelepasan VRAM, penanganan error, dan integrasi
dengan VoiceAgent (timing diperkirakan karena XTTS tak memberi word boundary)."""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from ai_office.config import AppConfig, XTTSConfig
from ai_office.tts import build_engine
from ai_office.tts.base import TTSError
from ai_office.tts.xtts import XTTSEngine


def fake_tts_module(record: dict, fail: bool = False):
    """Pasang modul 'TTS.api' palsu + 'torch' palsu di sys.modules."""
    tts_pkg = types.ModuleType("TTS")
    api = types.ModuleType("TTS.api")

    class TTS:
        def __init__(self, model):
            record["model"] = model
            record["device"] = None

        def to(self, device):
            record["device"] = device
            return self

        def tts_to_file(self, text, file_path, language, temperature, **kw):
            record.setdefault("calls", []).append(
                {"text": text, "language": language, "temperature": temperature, **kw})
            if fail:
                raise RuntimeError("CUDA out of memory")
            Path(file_path).write_bytes(b"RIFF....WAVEfake")

    api.TTS = TTS
    tts_pkg.api = api

    torch = types.ModuleType("torch")
    torch.cuda = types.SimpleNamespace(
        is_available=lambda: record.get("cuda", True),
        empty_cache=lambda: record.__setitem__("emptied", True))
    return {"TTS": tts_pkg, "TTS.api": api, "torch": torch}


@pytest.fixture
def mods(monkeypatch: pytest.MonkeyPatch):
    rec: dict = {}
    for name, mod in fake_tts_module(rec).items():
        monkeypatch.setitem(sys.modules, name, mod)
    return rec


def test_build_engine_selects_xtts() -> None:
    cfg = AppConfig.from_dict({"voice": {"engine": "xtts"}})
    assert isinstance(build_engine(cfg.voice), XTTSEngine)


def test_stub_matplotlib_installs_fake_and_hides_from_transformers(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub matplotlib dipasang bila matplotlib diblokir, DAN disembunyikan dari transformers."""
    import importlib.metadata as im

    from ai_office.tts import xtts

    for mod in ("matplotlib", "matplotlib.pyplot", "matplotlib.cm", "matplotlib.colors"):
        monkeypatch.delitem(sys.modules, mod, raising=False)
    monkeypatch.setattr(xtts, "_matplotlib_importable", lambda: False)

    xtts._stub_matplotlib()

    assert sys.modules["matplotlib"].__aioffice_stub__ is True
    import matplotlib.pyplot as plt

    assert plt.plot([1, 2], [3, 4]) is None   # no-op, tidak error
    with pytest.raises(im.PackageNotFoundError):
        im.version("matplotlib")              # transformers menganggapnya tak terpasang
    xtts._stub_matplotlib()                   # idempoten
    for mod in ("matplotlib", "matplotlib.pyplot", "matplotlib.cm", "matplotlib.colors"):
        monkeypatch.delitem(sys.modules, mod, raising=False)


def test_stub_skipped_when_matplotlib_works(monkeypatch: pytest.MonkeyPatch) -> None:
    from ai_office.tts import xtts

    monkeypatch.setattr(xtts, "_matplotlib_importable", lambda: True)
    monkeypatch.delitem(sys.modules, "matplotlib", raising=False)
    xtts._stub_matplotlib()
    assert not getattr(sys.modules.get("matplotlib"), "__aioffice_stub__", False)


def test_load_reports_real_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pesan error memuat penyebab asli, bukan selalu 'belum terpasang'."""
    eng = XTTSEngine(XTTSConfig(stub_matplotlib=False))
    fake_tts = types.ModuleType("TTS")
    fake_api = types.ModuleType("TTS.api")

    def boom():
        raise ImportError("Application Control policy has blocked ft2font")

    class _Loader:
        def __getattr__(self, name):
            boom()

    monkeypatch.setitem(sys.modules, "TTS", fake_tts)
    # buat 'from TTS.api import TTS' meledak
    monkeypatch.setitem(sys.modules, "TTS.api", fake_api)
    monkeypatch.setattr(fake_api, "TTS", property(lambda self: boom()), raising=False)

    def fake_import(name, *a, **k):
        if name == "TTS.api":
            raise ImportError("Application Control policy has blocked ft2font")
        return __import__(name, *a, **k)

    import builtins

    monkeypatch.setattr(builtins, "__import__", fake_import)
    with pytest.raises(TTSError, match="ft2font|Gagal mengimpor"):
        eng._load()


def test_is_available_reflects_package(monkeypatch: pytest.MonkeyPatch) -> None:
    import importlib.util

    eng = XTTSEngine(XTTSConfig())
    monkeypatch.setattr(importlib.util, "find_spec",
                        lambda name: object() if name == "TTS" else None)
    assert eng.is_available() is True
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    assert eng.is_available() is False


def test_synthesize_with_builtin_speaker(mods: dict, tmp_path: Path) -> None:
    eng = XTTSEngine(XTTSConfig(speaker="Ana Florence", device="cuda", language="id"))
    out = tmp_path / "a.wav"
    res = eng.synthesize("Halo teman", out, "+0%")
    assert res.audio_path == out and out.exists()
    assert res.words == []                          # XTTS tak beri timing per kata
    call = mods["calls"][0]
    assert call["speaker"] == "Ana Florence" and "speaker_wav" not in call
    assert call["language"] == "id"
    assert mods["device"] == "cuda"
    assert eng.audio_ext == ".wav"


def test_voice_cloning_with_speaker_wav(mods: dict, tmp_path: Path) -> None:
    sample = tmp_path / "suara.wav"
    sample.write_bytes(b"RIFFsample")
    eng = XTTSEngine(XTTSConfig(speaker_wav=str(sample)))
    eng.synthesize("Halo", tmp_path / "o.wav", "+0%")
    assert mods["calls"][0]["speaker_wav"] == str(sample)
    assert "speaker" not in mods["calls"][0]


def test_missing_speaker_wav_errors(mods: dict, tmp_path: Path) -> None:
    eng = XTTSEngine(XTTSConfig(speaker_wav=str(tmp_path / "tidakada.wav")))
    with pytest.raises(TTSError, match="speaker_wav tidak ditemukan"):
        eng.synthesize("Halo", tmp_path / "o.wav", "+0%")


def test_device_auto_falls_back_to_cpu(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    rec = {"cuda": False}
    for name, mod in fake_tts_module(rec).items():
        monkeypatch.setitem(sys.modules, name, mod)
    eng = XTTSEngine(XTTSConfig(device="auto"))
    eng.synthesize("Halo", tmp_path / "o.wav", "+0%")
    assert rec["device"] == "cpu"


def test_synthesize_wraps_errors(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    rec: dict = {}
    for name, mod in fake_tts_module(rec, fail=True).items():
        monkeypatch.setitem(sys.modules, name, mod)
    eng = XTTSEngine(XTTSConfig())
    with pytest.raises(TTSError, match="XTTS gagal"):
        eng.synthesize("Halo", tmp_path / "o.wav", "+0%")


def test_unload_frees_model(mods: dict, tmp_path: Path) -> None:
    eng = XTTSEngine(XTTSConfig())
    eng.synthesize("Halo", tmp_path / "o.wav", "+0%")
    assert eng._tts is not None
    eng.unload()
    assert eng._tts is None and mods.get("emptied") is True


def test_model_loaded_once(mods: dict, tmp_path: Path) -> None:
    eng = XTTSEngine(XTTSConfig())
    eng.synthesize("A", tmp_path / "a.wav", "+0%")
    eng.synthesize("B", tmp_path / "b.wav", "+0%")
    assert len(mods["calls"]) == 2  # dua sintesis
    # model hanya di-'to(device)' sekali (tidak reload)


def test_voice_agent_unloads_after_job(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:

    from test_voice import EXAMPLE

    from ai_office.agents.base import AgentContext
    from ai_office.agents.voice import VoiceAgent
    from ai_office.db import Database
    from ai_office.media import MediaTools

    class WavMedia(MediaTools):
        def is_available(self):
            return True

        def normalize_audio(self, src, dst, lufs, sample_rate):
            dst.write_bytes(src.read_bytes())

        def probe_duration(self, path):
            return 2.5

    rec: dict = {}
    for name, mod in fake_tts_module(rec).items():
        monkeypatch.setitem(sys.modules, name, mod)

    cfg = AppConfig.from_dict({
        "paths": {"data_dir": str(tmp_path / "d"), "output_dir": str(tmp_path / "o")},
        "voice": {"engine": "xtts", "xtts": {"unload_after_job": True, "device": "cuda"}},
    }, base_dir=Path(__file__).resolve().parent.parent)
    cfg.ensure_dirs()
    eng = build_engine(cfg.voice, cfg.base_dir)
    agent = VoiceAgent(cfg, eng, WavMedia())

    db = Database(cfg.db_path)
    db.init()
    job = db.create_job("mengenal warna", "3-6", "ceria", "id")
    job.artifacts = {"writer": {"script": EXAMPLE}}
    wd = cfg.output_dir / "job_1"
    wd.mkdir(parents=True)
    logs: list[str] = []
    ctx = AgentContext(job=job, config=cfg, workdir=wd, log=logs.append)

    out = agent.run(ctx)
    assert len(out["scenes"]) == 6
    assert eng._tts is None                         # dilepas setelah job
    assert any("dilepas dari VRAM" in m for m in logs)
    # timing diperkirakan karena XTTS tak beri word boundary
    assert out["scenes"][0]["timing_source"] == "estimated"


def test_orchestrator_releases_llm_before_voicing_with_xtts(tmp_path: Path) -> None:
    """Saat engine xtts, LLM (Ollama) dilepas dari VRAM sebelum tahap suara."""
    from mock_llm import RoutedLLM
    from test_m1_pipeline import review
    from test_voice import EXAMPLE, FakeEngine, FakeMedia

    from ai_office.agents import build_agents
    from ai_office.agents.base import Agent
    from ai_office.agents.voice import VoiceAgent
    from ai_office.db import Database
    from ai_office.events import EventBus
    from ai_office.models import AgentName
    from ai_office.orchestrator import Orchestrator

    cfg = AppConfig.from_dict({
        "paths": {"data_dir": str(tmp_path / "d"), "output_dir": str(tmp_path / "o")},
        "voice": {"engine": "xtts"},
    }, base_dir=Path(__file__).resolve().parent.parent)
    cfg.ensure_dirs()

    class RLLM(RoutedLLM):
        released = 0

        def release(self):
            RLLM.released += 1

    llm = RLLM(writer=[EXAMPLE], safety=[review()])
    agents = build_agents(cfg, provider=llm)
    agents[AgentName.VOICE] = VoiceAgent(cfg, FakeEngine(), FakeMedia())

    class StubAnim(Agent):
        name = AgentName.ANIMATOR

        def run(self, ctx):
            return {"clip_file": "a.mp4"}

    class StubEd(Agent):
        name = AgentName.EDITOR

        def run(self, ctx):
            return {"video_file": "v.mp4"}

    agents[AgentName.ANIMATOR] = StubAnim()
    agents[AgentName.EDITOR] = StubEd()

    db = Database(cfg.db_path)
    db.init()
    orch = Orchestrator(cfg, db, EventBus(), agents)
    job = orch.process_job(orch.create_job("mengenal warna").id)
    orch.approve_script(job.id)
    orch.process_job(job.id)
    assert RLLM.released >= 1
