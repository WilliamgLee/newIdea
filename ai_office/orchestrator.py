"""Manajer: state machine job + worker yang menjalankan agent satu per satu.

Alur:
queued -> writing -> safety_review -> awaiting_script_approval -> voicing -> animating
-> editing -> awaiting_final_approval -> delivering -> done   (+ failed / rejected)

- `safety_review` dengan verdict "revise" kembali ke `writing` (maks `max_safety_rounds` revisi).
- Mode semi_auto: berhenti di dua gerbang sampai admin approve/reject.
- Mode full_auto: gerbang dilewati HANYA jika review keamanan lulus.
- Error di satu agent membuat job `failed` (bisa di-retry), tidak menjatuhkan worker.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from .agents.base import Agent, AgentContext
from .config import VALID_MODES, AppConfig
from .db import Database
from .events import AgentTracker, EventBus
from .models import (
    STAGE_AGENT,
    TERMINAL_STATUSES,
    AgentName,
    InvalidTransition,
    Job,
    JobStatus,
)

log = logging.getLogger(__name__)

S = JobStatus
# Tahap berikutnya setelah agent sukses (kecuali safety_review yang punya logika sendiri)
NEXT_AFTER_STAGE: dict[JobStatus, JobStatus] = {
    S.WRITING: S.SAFETY_REVIEW,
    S.VOICING: S.ANIMATING,
    S.ANIMATING: S.EDITING,
    S.EDITING: S.AWAITING_FINAL_APPROVAL,
    S.DELIVERING: S.DONE,
}
NEXT_AFTER_GATE: dict[JobStatus, JobStatus] = {
    S.AWAITING_SCRIPT_APPROVAL: S.VOICING,
    S.AWAITING_FINAL_APPROVAL: S.DELIVERING,
}
MODE_SETTING_KEY = "pipeline.mode"
AVAILABILITY_CHECK_SEC = 30.0


class Orchestrator:
    def __init__(
        self,
        config: AppConfig,
        db: Database,
        bus: EventBus,
        agents: dict[AgentName, Agent],
        tracker: AgentTracker | None = None,
    ) -> None:
        missing = set(AgentName) - set(agents)
        if missing:
            raise ValueError(f"Agent belum terdaftar: {sorted(m.value for m in missing)}")
        self.config = config
        self.db = db
        self.bus = bus
        self.agents = agents
        self.tracker = tracker or AgentTracker(bus, config.pipeline.just_done_display_sec)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_availability_check = 0.0

    # ------------------------------------------------------------------ mode
    @property
    def mode(self) -> str:
        """Mode efektif: override dari panel admin (DB) atau config.yaml."""
        override = self.db.get_setting(MODE_SETTING_KEY)
        return override if override in VALID_MODES else self.config.pipeline.mode

    def set_mode(self, mode: str) -> None:
        if mode not in VALID_MODES:
            raise ValueError(f"Mode tidak valid: {mode!r}")
        self.db.set_setting(MODE_SETTING_KEY, mode)
        self.bus.publish("mode_changed", {"mode": mode})

    # --------------------------------------------------------- aksi admin
    def create_job(self, topic: str, age_group: str | None = None,
                   style: str | None = None, language: str | None = None) -> Job:
        topic = topic.strip()
        if not topic:
            raise ValueError("Topik tidak boleh kosong")
        c = self.config.content
        job = self.db.create_job(
            topic=topic,
            age_group=age_group or c.age_group,
            style=style or c.style,
            language=language or c.language,
        )
        self.db.add_log(job.id, f"Job dibuat: topik='{topic}'")
        self.bus.publish("job_created", job.public_dict())
        return job

    def approve_script(self, job_id: int, edited_script: dict[str, Any] | None = None) -> Job:
        """Gerbang 1: setujui naskah (opsional dengan naskah hasil edit admin)."""
        self._require_status(job_id, S.AWAITING_SCRIPT_APPROVAL)
        if edited_script is not None:
            # Validasi skema naskah ditambahkan di M1.
            self.db.set_artifact(job_id, "writer", {"script": edited_script,
                                                    "edited_by_admin": True})
            self.db.add_log(job_id, "Naskah diedit oleh admin")
            title = edited_script.get("title")
            return self._transition(job_id, S.VOICING, "Gerbang 1 disetujui admin",
                                    **({"title": title} if title else {}))
        return self._transition(job_id, S.VOICING, "Gerbang 1 disetujui admin")

    def approve_final(self, job_id: int) -> Job:
        """Gerbang 2: setujui video final."""
        self._require_status(job_id, S.AWAITING_FINAL_APPROVAL)
        return self._transition(job_id, S.DELIVERING, "Gerbang 2 disetujui admin")

    def reject(self, job_id: int, reason: str = "") -> Job:
        job = self.db.require_job(job_id)
        if job.status not in NEXT_AFTER_GATE:
            raise InvalidTransition("Reject hanya bisa dilakukan di gerbang persetujuan")
        msg = "Ditolak admin" + (f": {reason}" if reason else "")
        return self._transition(job_id, S.REJECTED, msg, finished_at=time.time())

    def retry(self, job_id: int) -> Job:
        """Ulangi job gagal mulai dari tahap yang gagal."""
        job = self._require_status(job_id, S.FAILED)
        target = job.failed_stage or S.QUEUED
        return self._transition(job_id, target, f"Retry dari tahap {target.value}",
                                error=None, failed_stage=None, finished_at=None)

    # ------------------------------------------------------------ pemrosesan
    def process_job(self, job_id: int) -> Job:
        """Jalankan job sejauh mungkin: sampai gerbang (menunggu admin) atau status akhir."""
        while not self._stop.is_set():
            job = self.db.require_job(job_id)
            if job.status in TERMINAL_STATUSES:
                break
            try:
                progressed = self._step(job)
            except InvalidTransition as exc:  # status diubah pihak lain; hentikan putaran ini
                log.warning("Job %s: %s", job_id, exc)
                break
            if not progressed:
                break
        return self.db.require_job(job_id)

    def _step(self, job: Job) -> bool:
        """Satu langkah state machine. False = menunggu admin."""
        if job.status == S.QUEUED:
            self._transition(job.id, S.WRITING, "Mulai diproses", started_at=time.time())
            return True

        if job.status in NEXT_AFTER_GATE:
            if self.mode == "full_auto" and job.safety_passed:
                self._transition(job.id, NEXT_AFTER_GATE[job.status],
                                 "Mode full-auto: gerbang dilewati (review keamanan lulus)")
                return True
            return False

        if job.status in STAGE_AGENT:
            self._run_stage(job)
            return True

        return False

    def _run_stage(self, job: Job) -> None:
        stage = job.status
        agent_name = STAGE_AGENT[stage]
        agent = self.agents[agent_name]
        workdir = self.config.output_dir / f"job_{job.id}"
        workdir.mkdir(parents=True, exist_ok=True)

        feedback = None
        if stage == S.WRITING and job.safety_round > 0:
            feedback = job.artifacts.get(AgentName.SAFETY.value)

        ctx = AgentContext(
            job=job, config=self.config, workdir=workdir, feedback=feedback,
            log=lambda msg: self.db.add_log(job.id, msg, agent=agent_name.value),
        )
        self.tracker.set_working(agent_name, job.id)
        started = time.monotonic()
        try:
            result = agent.run(ctx)
            if not isinstance(result, dict):
                raise TypeError(f"Agent {agent_name.value} harus mengembalikan dict")
        except Exception as exc:
            log.exception("Agent %s gagal pada job %s", agent_name.value, job.id)
            self.tracker.set_idle(agent_name)
            self.db.add_log(job.id, f"Gagal: {type(exc).__name__}: {exc}", level="ERROR",
                            agent=agent_name.value)
            self._transition(job.id, S.FAILED, f"Tahap {stage.value} gagal",
                             failed_stage=stage, error=f"{type(exc).__name__}: {exc}",
                             finished_at=time.time())
            return

        elapsed = time.monotonic() - started
        self.db.set_artifact(job.id, agent_name.value, result)
        self.db.add_log(job.id, f"Selesai dalam {elapsed:.1f} detik", agent=agent_name.value)
        self.tracker.set_done(agent_name, job.id)

        if stage == S.SAFETY_REVIEW:
            self._after_safety(job, result)
            return

        extra: dict[str, Any] = {}
        if stage == S.WRITING:
            title = (result.get("script") or {}).get("title")
            if title:
                extra["title"] = title
        if stage == S.DELIVERING:
            extra["finished_at"] = time.time()
        self._transition(job.id, NEXT_AFTER_STAGE[stage], f"Tahap {stage.value} selesai",
                         **extra)

    def _after_safety(self, job: Job, review: dict[str, Any]) -> None:
        verdict = review.get("verdict")
        round_no = job.safety_round + 1
        self.db.add_safety_review(job.id, round_no, str(verdict), review)
        max_rounds = self.config.pipeline.max_safety_rounds

        if verdict == "pass":
            self._transition(job.id, S.AWAITING_SCRIPT_APPROVAL,
                             f"Review keamanan lulus (putaran {round_no})",
                             safety_round=round_no, safety_passed=True)
        elif verdict == "revise" and round_no <= max_rounds:
            self._transition(job.id, S.WRITING,
                             f"Review keamanan minta revisi (putaran {round_no}/{max_rounds})",
                             safety_round=round_no)
        elif verdict == "revise":
            self._transition(job.id, S.AWAITING_SCRIPT_APPROVAL,
                             "Review keamanan belum lulus setelah batas revisi; menunggu admin",
                             safety_round=round_no, safety_passed=False)
        else:
            self._transition(job.id, S.FAILED, f"Verdict keamanan tidak dikenal: {verdict!r}",
                             failed_stage=S.SAFETY_REVIEW,
                             error=f"Verdict tidak dikenal: {verdict!r}",
                             finished_at=time.time())

    # ---------------------------------------------------------------- worker
    def start_worker(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._worker_loop, name="ai-office-worker",
                                        daemon=True)
        self._thread.start()
        log.info("Worker dimulai (mode=%s)", self.mode)

    def stop_worker(self, timeout: float = 10.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)
        log.info("Worker dihentikan")

    def _worker_loop(self) -> None:
        poll = self.config.pipeline.poll_interval_sec
        while not self._stop.is_set():
            try:
                self.refresh_availability()
                job = self.db.next_runnable_job()
                if job is None:
                    self._stop.wait(poll)
                    continue
                self.process_job(job.id)
            except Exception:
                log.exception("Error tak terduga di worker")
                self._stop.wait(poll)

    def refresh_availability(self, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_availability_check < AVAILABILITY_CHECK_SEC:
            return
        self._last_availability_check = now
        for name, agent in self.agents.items():
            try:
                ok = agent.is_available()
            except Exception:  # noqa: BLE001
                ok = False
            self.tracker.set_available(name, ok)

    # ---------------------------------------------------------------- status
    def summary(self) -> dict[str, Any]:
        counts = self.db.count_by_status()
        active = sum(n for s, n in counts.items() if s in {x.value for x in STAGE_AGENT})
        waiting = counts.get(S.AWAITING_SCRIPT_APPROVAL.value, 0) + counts.get(
            S.AWAITING_FINAL_APPROVAL.value, 0)
        last = self.db.last_finished_job()
        last_duration = None
        if last and last.started_at and last.finished_at:
            last_duration = round(last.finished_at - last.started_at, 1)
        return {
            "mode": self.mode,
            "active_jobs": active,
            "queued_jobs": counts.get(S.QUEUED.value, 0),
            "awaiting_approval": waiting,
            "done_jobs": counts.get(S.DONE.value, 0),
            "failed_jobs": counts.get(S.FAILED.value, 0),
            "last_process_sec": last_duration,
        }

    # --------------------------------------------------------------- helper
    def _require_status(self, job_id: int, status: JobStatus) -> Job:
        job = self.db.require_job(job_id)
        if job.status != status:
            raise InvalidTransition(
                f"Job {job_id} berstatus {job.status.value}, bukan {status.value}"
            )
        return job

    def _transition(self, job_id: int, new: JobStatus, message: str, **fields: Any) -> Job:
        old, job = self.db.transition(job_id, new, **fields)
        level = "ERROR" if new == S.FAILED else "INFO"
        self.db.add_log(job_id, f"{old.value} -> {new.value}: {message}", level=level)
        log.info("Job %s: %s -> %s (%s)", job_id, old.value, new.value, message)
        self.bus.publish("job_status", {**job.public_dict(), "previous": old.value})
        return job
