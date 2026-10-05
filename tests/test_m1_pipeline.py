"""Kriteria selesai M1: dari satu topik dihasilkan script.json valid yang lolos/ditolak
review keamanan dengan alasan jelas (LLM di-mock)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from mock_llm import RoutedLLM

from ai_office.agents import build_agents
from ai_office.agents.fake import fake_script
from ai_office.agents.safety import SafetyAgent, load_rubric
from ai_office.agents.writer import WriterAgent
from ai_office.bootstrap import make_script_validator
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.events import EventBus
from ai_office.models import AgentName, JobStatus
from ai_office.orchestrator import Orchestrator

ROOT = Path(__file__).resolve().parent.parent
RUBRIC_IDS = load_rubric(ROOT / "safety_rubric.yaml").ids
S = JobStatus


def review(bad: str | None = None) -> dict[str, Any]:
    return {
        "verdict": "revise" if bad else "pass",
        "items": [{"criterion": c, "ok": c != bad,
                   "reason": f"masalah pada {c}" if c == bad else "baik"} for c in RUBRIC_IDS],
        "suggestions": [f"perbaiki {bad}"] if bad else [],
        "summary": "ringkasan",
    }


def titled(title: str) -> dict[str, Any]:
    s = fake_script("hewan dan suaranya")
    s["title"] = title
    return s


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    cfg = AppConfig.from_dict({"paths": {"data_dir": str(tmp_path / "data"),
                                         "output_dir": str(tmp_path / "out")},
                               "agents": {"fake_delay_sec": 0}}, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


def make(config: AppConfig, llm: RoutedLLM) -> Orchestrator:
    db = Database(config.db_path)
    db.init()
    agents = build_agents(config, provider=llm)
    return Orchestrator(config, db, EventBus(), agents,
                        script_validator=make_script_validator(config))


def test_build_agents_uses_real_writer_and_safety(config: AppConfig) -> None:
    agents = build_agents(config, provider=RoutedLLM([], []))
    assert isinstance(agents[AgentName.WRITER], WriterAgent)
    assert isinstance(agents[AgentName.SAFETY], SafetyAgent)


def test_build_agents_refuses_unimplemented_real_agent(config: AppConfig) -> None:
    config.agents.fake = []
    with pytest.raises(NotImplementedError, match="editor"):
        build_agents(config, provider=RoutedLLM([], []))


def test_topic_to_approved_script(config: AppConfig) -> None:
    llm = RoutedLLM(writer=[titled("Suara Hewan!")], safety=[review()])
    orch = make(config, llm)
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)

    assert job.status == S.AWAITING_SCRIPT_APPROVAL
    assert job.safety_passed is True and job.title == "Suara Hewan!"
    assert (config.output_dir / f"job_{job.id}" / "script.json").exists()
    reviews = orch.db.get_safety_reviews(job.id)
    assert [r["verdict"] for r in reviews] == ["pass"]
    assert job.processing_sec >= 0


def test_revise_then_pass(config: AppConfig) -> None:
    llm = RoutedLLM(writer=[titled("Versi Satu"), titled("Versi Dua")],
                    safety=[review(bad="bahasa_sederhana"), review()])
    orch = make(config, llm)
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)

    assert job.status == S.AWAITING_SCRIPT_APPROVAL
    assert job.title == "Versi Dua" and job.safety_passed is True
    reviews = orch.db.get_safety_reviews(job.id)
    assert [r["verdict"] for r in reviews] == ["revise", "pass"]
    first = next(i for i in reviews[0]["review"]["items"] if i["criterion"] == "bahasa_sederhana")
    assert first["ok"] is False and "masalah pada bahasa_sederhana" in first["reason"]
    # Penulis menerima alasan & saran di putaran revisi
    revision_prompt = llm.writer.calls[1]["messages"][1].content
    assert "masalah pada bahasa_sederhana" in revision_prompt
    assert "perbaiki bahasa_sederhana" in revision_prompt


def test_still_failing_after_two_revisions_waits_for_admin(config: AppConfig) -> None:
    llm = RoutedLLM(writer=[titled(f"Versi {i}") for i in range(3)],
                    safety=[review(bad="fakta_benar")] * 3)
    orch = make(config, llm)
    orch.set_mode("full_auto")                       # tetap berhenti karena review gagal
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)

    assert job.status == S.AWAITING_SCRIPT_APPROVAL and job.safety_passed is False
    assert len(llm.writer.calls) == 3                # 1 tulis + 2 revisi
    assert len(orch.db.get_safety_reviews(job.id)) == 3


def test_writer_invalid_output_fails_job_with_reason(config: AppConfig) -> None:
    llm = RoutedLLM(writer=["bukan json"] * 3, safety=[])
    orch = make(config, llm)
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)
    assert job.status == S.FAILED and job.failed_stage == S.WRITING
    assert "tidak valid setelah 3 percobaan" in (job.error or "")


def test_admin_edit_is_validated(config: AppConfig) -> None:
    llm = RoutedLLM(writer=[titled("Asli")], safety=[review()])
    orch = make(config, llm)
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)

    bad = titled("Editan")
    bad["scenes"][1]["template"] = "tidak_ada"
    with pytest.raises(ValueError, match="tidak_ada"):
        orch.approve_script(job.id, bad)
    assert orch.db.require_job(job.id).status == S.AWAITING_SCRIPT_APPROVAL

    good = titled("Editan")
    good["total_duration_sec"] = 99                  # dihitung ulang otomatis dari scene
    job = orch.approve_script(job.id, good)
    assert job.status == S.VOICING and job.title == "Editan"
    assert job.artifacts["writer"]["script"]["total_duration_sec"] == 30
