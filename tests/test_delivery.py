"""Test M5: Pengirim. Penyalinan file & pembukaan folder diverifikasi; opener di-mock."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from ai_office.agents.base import AgentContext, AgentError
from ai_office.agents.delivery import DeliveryAgent, open_in_file_manager, slugify
from ai_office.config import AppConfig
from ai_office.db import Database

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = json.loads((ROOT / "examples" / "colors_en.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize(("title", "expected"), [
    ("Let's Learn Colors!", "lets-learn-colors"),
    ("Hewan & Suaranya", "hewan-suaranya"),
    ("   ", "video"),
    ("A" * 80, "a" * 50),
])
def test_slugify(title: str, expected: str) -> None:
    assert slugify(title) == expected


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    cfg = AppConfig.from_dict({
        "paths": {"data_dir": str(tmp_path / "d"), "output_dir": str(tmp_path / "o")},
        "delivery": {"dest_dir": str(tmp_path / "out")},
    }, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


def prepared_workdir(config: AppConfig) -> Path:
    wd = config.output_dir / "job_1"
    wd.mkdir(parents=True)
    (wd / "video.mp4").write_bytes(b"MP4")
    (wd / "thumbnail.png").write_bytes(b"PNG")
    (wd / "metadata.txt").write_text("Judul: X\nMade for kids", encoding="utf-8")
    (wd / "metadata.json").write_text("{}", encoding="utf-8")
    return wd


def run_delivery(config: AppConfig, wd: Path, open_folder=True):
    opened: list[Path] = []
    db = Database(config.db_path)
    db.init()
    job = db.create_job("learn colors", "3-6", "cheerful", "en")
    job.artifacts = {
        "writer": {"script": EXAMPLE},
        "editor": {"video_file": "video.mp4", "thumbnail_file": "thumbnail.png"},
    }
    ctx = AgentContext(job=job, config=config, workdir=wd, log=lambda m: None)
    agent = DeliveryAgent(config, open_folder=open_folder, opener=lambda p: opened.append(p) or True)
    return agent.run(ctx), opened


def test_delivery_copies_all_outputs(config: AppConfig) -> None:
    """Kriteria selesai M5: hasil disalin ke folder tujuan & folder dibuka."""
    wd = prepared_workdir(config)
    out, opened = run_delivery(config, wd)

    dest = Path(out["dest_dir"])
    assert dest.exists() and dest.parent == config.delivery_dir
    assert dest.name.endswith("_lets-learn-colors")           # <tanggal>_<slug>
    for name in ("video.mp4", "thumbnail.png", "script.json", "metadata.txt"):
        assert (dest / name).exists(), name
    assert set(out["files"]) >= {"video.mp4", "thumbnail.png", "script.json", "metadata.txt"}
    # script.json berisi naskah yang benar
    assert json.loads((dest / "script.json").read_text(encoding="utf-8"))["title"] == EXAMPLE[
        "title"]
    assert out["delivered"] is True and out["opened_folder"] is True
    assert opened == [dest]


def test_delivery_respects_open_folder_false(config: AppConfig) -> None:
    out, opened = run_delivery(config, prepared_workdir(config), open_folder=False)
    assert out["opened_folder"] is False and opened == []


def test_delivery_requires_editor_output(config: AppConfig) -> None:
    db = Database(config.db_path)
    db.init()
    job = db.create_job("x", "3-6", "cheerful", "en")
    job.artifacts = {"writer": {"script": EXAMPLE}}      # tanpa editor
    wd = config.output_dir / "job_1"
    wd.mkdir(parents=True)
    ctx = AgentContext(job=job, config=config, workdir=wd, log=lambda m: None)
    with pytest.raises(AgentError, match="Editor"):
        DeliveryAgent(config, opener=lambda p: True).run(ctx)


def test_delivery_survives_missing_thumbnail(config: AppConfig) -> None:
    wd = config.output_dir / "job_1"
    wd.mkdir(parents=True)
    (wd / "video.mp4").write_bytes(b"MP4")               # tanpa thumbnail/metadata
    out, _ = run_delivery(config, wd)
    dest = Path(out["dest_dir"])
    assert (dest / "video.mp4").exists() and (dest / "script.json").exists()
    assert "thumbnail.png" not in out["files"]


def test_open_in_file_manager_handles_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    import ai_office.agents.delivery as d

    def boom(*a, **k):
        raise OSError("no explorer")

    monkeypatch.setattr(d.subprocess, "Popen", boom)
    assert open_in_file_manager(Path("/tmp")) is False   # tidak melempar, kembalikan False


def test_delivery_in_full_pipeline(config: AppConfig) -> None:
    """Semua agent asli kecuali yang di-mock: job sampai done dan delivery menyalin file."""
    from mock_llm import RoutedLLM
    from test_m1_pipeline import review
    from test_voice import FakeEngine, FakeMedia

    from ai_office.agents import build_agents
    from ai_office.agents.base import Agent
    from ai_office.agents.voice import VoiceAgent
    from ai_office.events import EventBus
    from ai_office.models import AgentName, JobStatus
    from ai_office.orchestrator import Orchestrator

    en_review = {"verdict": "pass",
                 "items": review()["items"], "suggestions": [], "summary": "ok"}
    # pakai id-review agar cocok rubrik default (job default language id di sini tak dipakai)
    agents = build_agents(config, provider=RoutedLLM(writer=[EXAMPLE], safety=[review()]))

    class StubAnim(Agent):
        name = AgentName.ANIMATOR

        def run(self, ctx):
            (ctx.workdir / "animation.mp4").write_bytes(b"CLIP")
            return {"clip_file": "animation.mp4"}

    class StubEditor(Agent):
        name = AgentName.EDITOR

        def run(self, ctx):
            (ctx.workdir / "video.mp4").write_bytes(b"MP4")
            return {"video_file": "video.mp4", "thumbnail_file": None, "duration_sec": 30.0}

    agents[AgentName.VOICE] = VoiceAgent(config, FakeEngine(), FakeMedia())
    agents[AgentName.ANIMATOR] = StubAnim()
    agents[AgentName.EDITOR] = StubEditor()

    db = Database(config.db_path)
    db.init()
    orch = Orchestrator(config, db, EventBus(), agents)
    orch.set_mode("full_auto")
    job = orch.process_job(orch.create_job("learn colors").id)
    assert job.status == JobStatus.DONE
    deliv = job.artifacts["delivery"]
    assert deliv["delivered"] is True
    assert (Path(deliv["dest_dir"]) / "video.mp4").exists()
    assert len(en_review["items"]) == 7
