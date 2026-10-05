from __future__ import annotations

import time
from typing import Any

import pytest

from ai_office.agents.base import Agent, AgentContext
from ai_office.agents.fake import FakeSafety
from ai_office.models import AgentName, AgentState, InvalidTransition, JobStatus
from ai_office.orchestrator import Orchestrator

S = JobStatus


class BoomVoice(Agent):
    """Agent suara yang gagal sekali lalu berhasil."""

    name = AgentName.VOICE

    def __init__(self) -> None:
        self.calls = 0

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("TTS mati")
        return {"ok": True}


class RecordingWriter(Agent):
    name = AgentName.WRITER

    def __init__(self) -> None:
        self.feedbacks: list[Any] = []

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        self.feedbacks.append(ctx.feedback)
        return {"script": {"title": f"Versi {len(self.feedbacks)}", "scenes": []}}


def test_semi_auto_full_flow_reaches_done(orch: Orchestrator) -> None:
    job = orch.create_job("mengenal warna")
    assert job.status == S.QUEUED

    job = orch.process_job(job.id)
    assert job.status == S.AWAITING_SCRIPT_APPROVAL      # berhenti di gerbang 1
    assert job.safety_passed is True
    assert job.title == "Ayo Belajar: Mengenal Warna!"
    assert "writer" in job.artifacts and "safety" in job.artifacts

    orch.approve_script(job.id)
    job = orch.process_job(job.id)
    assert job.status == S.AWAITING_FINAL_APPROVAL       # berhenti di gerbang 2

    orch.approve_final(job.id)
    job = orch.process_job(job.id)
    assert job.status == S.DONE
    assert job.started_at and job.finished_at and job.finished_at >= job.started_at
    assert set(job.artifacts) == {a.value for a in AgentName}

    logs = [entry["message"] for entry in orch.db.get_logs(job.id)]
    assert any("awaiting_final_approval -> delivering" in m for m in logs)


def test_full_auto_skips_gates_when_safety_passes(orch: Orchestrator) -> None:
    orch.set_mode("full_auto")
    job = orch.process_job(orch.create_job("hewan dan suaranya").id)
    assert job.status == S.DONE


def test_full_auto_still_stops_when_safety_fails(make_orch) -> None:
    orch = make_orch(safety=FakeSafety(verdicts=["revise", "revise", "revise"]))
    orch.set_mode("full_auto")
    job = orch.process_job(orch.create_job("x").id)
    assert job.status == S.AWAITING_SCRIPT_APPROVAL
    assert job.safety_passed is False
    assert job.safety_round == 3                           # 1 review awal + 2 revisi
    assert len(orch.db.get_safety_reviews(job.id)) == 3


def test_revision_loop_passes_feedback_to_writer(make_orch) -> None:
    writer = RecordingWriter()
    orch = make_orch(writer=writer, safety=FakeSafety(verdicts=["revise", "pass"]))
    job = orch.process_job(orch.create_job("x").id)
    assert job.status == S.AWAITING_SCRIPT_APPROVAL
    assert job.safety_passed is True
    assert job.title == "Versi 2"
    assert writer.feedbacks[0] is None
    assert writer.feedbacks[1]["verdict"] == "revise"     # review dikirim balik ke Penulis
    verdicts = [r["verdict"] for r in orch.db.get_safety_reviews(job.id)]
    assert verdicts == ["revise", "pass"]


def test_agent_failure_marks_failed_and_retry_resumes(make_orch) -> None:
    voice = BoomVoice()
    orch = make_orch(voice=voice)
    job = orch.process_job(orch.create_job("x").id)
    orch.approve_script(job.id)
    job = orch.process_job(job.id)
    assert job.status == S.FAILED
    assert job.failed_stage == S.VOICING
    assert "TTS mati" in (job.error or "")

    job = orch.retry(job.id)
    assert job.status == S.VOICING and job.error is None
    job = orch.process_job(job.id)
    assert job.status == S.AWAITING_FINAL_APPROVAL
    assert voice.calls == 2


def test_reject_at_gate(orch: Orchestrator) -> None:
    job = orch.process_job(orch.create_job("x").id)
    job = orch.reject(job.id, "kurang menarik")
    assert job.status == S.REJECTED
    with pytest.raises(InvalidTransition):
        orch.approve_script(job.id)


def test_cannot_approve_wrong_gate(orch: Orchestrator) -> None:
    job = orch.process_job(orch.create_job("x").id)
    with pytest.raises(InvalidTransition):
        orch.approve_final(job.id)


def test_reject_only_at_gates(orch: Orchestrator) -> None:
    job = orch.create_job("x")
    with pytest.raises(InvalidTransition):
        orch.reject(job.id)


def test_edited_script_is_stored(orch: Orchestrator) -> None:
    job = orch.process_job(orch.create_job("x").id)
    job = orch.approve_script(job.id, edited_script={"title": "Judul Baru", "scenes": []})
    assert job.title == "Judul Baru"
    assert job.artifacts["writer"]["edited_by_admin"] is True


def test_empty_topic_rejected(orch: Orchestrator) -> None:
    with pytest.raises(ValueError):
        orch.create_job("   ")


def test_events_published(orch: Orchestrator) -> None:
    job = orch.process_job(orch.create_job("x").id)
    types = [e.type for e in orch.bus.history()]
    assert types[0] == "job_created"
    assert "job_status" in types and "agent_state" in types
    statuses = [e.data["status"] for e in orch.bus.history() if e.type == "job_status"]
    assert statuses == ["writing", "safety_review", "awaiting_script_approval"]
    assert job.id


def test_agent_tracker_states(orch: Orchestrator) -> None:
    orch.process_job(orch.create_job("x").id)
    states = {a["agent"]: a["state"] for a in orch.tracker.snapshot()}
    assert states["writer"] == AgentState.JUST_DONE
    assert states["voice"] == AgentState.IDLE
    assert orch.tracker.effective_state(AgentName.WRITER, now=time.time() + 999) == AgentState.IDLE


def test_worker_thread_processes_queue(orch: Orchestrator) -> None:
    orch.set_mode("full_auto")
    ids = [orch.create_job(f"topik {i}").id for i in range(3)]
    orch.start_worker()
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            if all(orch.db.require_job(i).status == S.DONE for i in ids):
                break
            time.sleep(0.05)
    finally:
        orch.stop_worker()
    assert [orch.db.require_job(i).status for i in ids] == [S.DONE] * 3
    assert orch.summary()["done_jobs"] == 3


def test_worker_survives_crashing_agent(make_orch) -> None:
    class Crash(Agent):
        name = AgentName.WRITER

        def run(self, ctx: AgentContext) -> dict[str, Any]:
            raise MemoryError("parah")

    orch = make_orch(writer=Crash())
    a = orch.create_job("a").id
    orch.start_worker()
    try:
        deadline = time.time() + 5
        while time.time() < deadline and orch.db.require_job(a).status != S.FAILED:
            time.sleep(0.05)
        assert orch.db.require_job(a).status == S.FAILED
        assert orch._thread is not None and orch._thread.is_alive()
    finally:
        orch.stop_worker()


def test_public_dict_hides_internal_data(orch: Orchestrator) -> None:
    job = orch.process_job(orch.create_job("x").id)
    public = job.public_dict()
    assert "artifacts" not in public and "error" not in public
