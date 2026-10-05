"""Model domain inti: status job, transisi state machine, nama agent, status agent."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class JobStatus(StrEnum):
    QUEUED = "queued"
    WRITING = "writing"
    SAFETY_REVIEW = "safety_review"
    AWAITING_SCRIPT_APPROVAL = "awaiting_script_approval"
    VOICING = "voicing"
    ANIMATING = "animating"
    EDITING = "editing"
    AWAITING_FINAL_APPROVAL = "awaiting_final_approval"
    DELIVERING = "delivering"
    DONE = "done"
    FAILED = "failed"
    REJECTED = "rejected"


class AgentName(StrEnum):
    WRITER = "writer"
    SAFETY = "safety"
    VOICE = "voice"
    ANIMATOR = "animator"
    EDITOR = "editor"
    DELIVERY = "delivery"


class AgentState(StrEnum):
    WORKING = "working"        # sedang kerja
    JUST_DONE = "just_done"    # baru selesai
    IDLE = "idle"              # santai
    OFFLINE = "offline"        # offline (dependensi tidak tersedia)


# Label Bahasa Indonesia untuk dashboard
AGENT_LABELS: dict[AgentName, str] = {
    AgentName.WRITER: "Penulis Naskah",
    AgentName.SAFETY: "Penasihat Keamanan Anak",
    AgentName.VOICE: "Pengisi Suara",
    AgentName.ANIMATOR: "Pembuat Animasi",
    AgentName.EDITOR: "Editor",
    AgentName.DELIVERY: "Pengirim",
}

# Status tahap kerja -> agent yang mengerjakannya
STAGE_AGENT: dict[JobStatus, AgentName] = {
    JobStatus.WRITING: AgentName.WRITER,
    JobStatus.SAFETY_REVIEW: AgentName.SAFETY,
    JobStatus.VOICING: AgentName.VOICE,
    JobStatus.ANIMATING: AgentName.ANIMATOR,
    JobStatus.EDITING: AgentName.EDITOR,
    JobStatus.DELIVERING: AgentName.DELIVERY,
}

GATE_STATUSES: frozenset[JobStatus] = frozenset(
    {JobStatus.AWAITING_SCRIPT_APPROVAL, JobStatus.AWAITING_FINAL_APPROVAL}
)
TERMINAL_STATUSES: frozenset[JobStatus] = frozenset(
    {JobStatus.DONE, JobStatus.FAILED, JobStatus.REJECTED}
)
# Status yang bisa diproses worker tanpa campur tangan admin
RUNNABLE_STATUSES: frozenset[JobStatus] = frozenset({JobStatus.QUEUED, *STAGE_AGENT})

_S = JobStatus
ALLOWED_TRANSITIONS: dict[JobStatus, frozenset[JobStatus]] = {
    _S.QUEUED: frozenset({_S.WRITING, _S.FAILED}),
    _S.WRITING: frozenset({_S.SAFETY_REVIEW, _S.FAILED}),
    # revise -> kembali ke writing; pass / habis putaran -> gerbang 1
    _S.SAFETY_REVIEW: frozenset({_S.WRITING, _S.AWAITING_SCRIPT_APPROVAL, _S.FAILED}),
    _S.AWAITING_SCRIPT_APPROVAL: frozenset({_S.VOICING, _S.REJECTED}),
    _S.VOICING: frozenset({_S.ANIMATING, _S.FAILED}),
    _S.ANIMATING: frozenset({_S.EDITING, _S.FAILED}),
    _S.EDITING: frozenset({_S.AWAITING_FINAL_APPROVAL, _S.FAILED}),
    _S.AWAITING_FINAL_APPROVAL: frozenset({_S.DELIVERING, _S.REJECTED}),
    _S.DELIVERING: frozenset({_S.DONE, _S.FAILED}),
    _S.DONE: frozenset(),
    _S.REJECTED: frozenset(),
    # retry: lanjut lagi dari tahap yang gagal
    _S.FAILED: frozenset({_S.QUEUED, *STAGE_AGENT}),
}


class InvalidTransition(Exception):
    """Transisi status yang tidak diizinkan state machine."""


def check_transition(current: JobStatus, new: JobStatus) -> None:
    if new not in ALLOWED_TRANSITIONS[current]:
        raise InvalidTransition(f"Transisi {current.value} -> {new.value} tidak diizinkan")


@dataclass
class Job:
    id: int
    topic: str
    age_group: str
    style: str
    language: str
    status: JobStatus
    created_at: float
    updated_at: float
    title: str | None = None
    safety_round: int = 0
    safety_passed: bool | None = None
    failed_stage: JobStatus | None = None
    error: str | None = None
    artifacts: dict[str, Any] = field(default_factory=dict)
    started_at: float | None = None
    finished_at: float | None = None

    @classmethod
    def from_row(cls, row: Any) -> Job:
        return cls(
            id=row["id"],
            topic=row["topic"],
            age_group=row["age_group"],
            style=row["style"],
            language=row["language"],
            status=JobStatus(row["status"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            title=row["title"],
            safety_round=row["safety_round"],
            safety_passed=None if row["safety_passed"] is None else bool(row["safety_passed"]),
            failed_stage=JobStatus(row["failed_stage"]) if row["failed_stage"] else None,
            error=row["error"],
            artifacts=json.loads(row["artifacts"] or "{}"),
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    def public_dict(self) -> dict[str, Any]:
        """Data aman untuk dashboard publik: tanpa path lokal, error internal, atau log."""
        duration = None
        if self.started_at and self.finished_at:
            duration = round(self.finished_at - self.started_at, 1)
        return {
            "id": self.id,
            "title": self.title,
            "topic": self.topic,
            "age_group": self.age_group,
            "status": self.status.value,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "duration_sec": duration,
        }

    def admin_dict(self) -> dict[str, Any]:
        d = self.public_dict()
        d.update(
            style=self.style,
            language=self.language,
            safety_round=self.safety_round,
            safety_passed=self.safety_passed,
            failed_stage=self.failed_stage.value if self.failed_stage else None,
            error=self.error,
            artifacts=self.artifacts,
        )
        return d
