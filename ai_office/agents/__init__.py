"""Registry agent."""

from __future__ import annotations

from ..config import AppConfig
from ..models import AgentName
from .base import Agent, AgentContext, AgentError
from .fake import build_fake_agents

__all__ = ["Agent", "AgentContext", "AgentError", "build_agents"]


def build_agents(config: AppConfig) -> dict[AgentName, Agent]:
    """Bangun agent sesuai config. M0: hanya agent palsu yang tersedia."""
    if config.agents.use_fake:
        return build_fake_agents(config.agents.fake_delay_sec)
    raise NotImplementedError(
        "Agent asli belum tersedia di M0. Set `agents.use_fake: true` di config.yaml."
    )
