"""Kontrak dasar untuk semua agent."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import AppConfig
from ..models import AgentName, Job


class AgentError(Exception):
    """Kesalahan yang diharapkan dari agent (pesannya aman ditampilkan ke admin)."""


@dataclass
class AgentContext:
    job: Job
    config: AppConfig
    workdir: Path                         # folder kerja khusus job ini (output/job_<id>/)
    log: Callable[[str], None]            # tulis log job (tampil di panel admin)
    feedback: dict[str, Any] | None = None  # review keamanan terakhir (untuk revisi Penulis)
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def artifacts(self) -> dict[str, Any]:
        return self.job.artifacts


class Agent(ABC):
    name: AgentName

    @abstractmethod
    def run(self, ctx: AgentContext) -> dict[str, Any]:
        """Kerjakan tugas dan kembalikan artefak (JSON-serializable).

        Hasilnya disimpan orchestrator ke `job.artifacts[<nama agent>]`.
        Agent Penasihat Keamanan wajib mengembalikan kunci `verdict`: "pass" | "revise".
        """

    def is_available(self) -> bool:
        """False bila dependensi (mis. Ollama, ffmpeg) tidak tersedia -> status 'offline'."""
        return True
