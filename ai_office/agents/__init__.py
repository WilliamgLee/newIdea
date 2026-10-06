"""Registry agent."""

from __future__ import annotations

from ..config import AppConfig
from ..llm.base import LLMProvider
from ..models import AgentName
from .base import Agent, AgentContext, AgentError
from .fake import build_fake_agents

__all__ = ["Agent", "AgentContext", "AgentError", "build_agents"]

# Agent asli yang sudah tersedia (bertambah per milestone)
IMPLEMENTED: frozenset[AgentName] = frozenset(
    {AgentName.WRITER, AgentName.SAFETY, AgentName.VOICE, AgentName.ANIMATOR, AgentName.EDITOR})


def build_agents(config: AppConfig, provider: LLMProvider | None = None) -> dict[AgentName, Agent]:
    """Bangun agent sesuai config: agent di `agents.fake` memakai versi palsu."""
    agents = build_fake_agents(config.agents.fake_delay_sec)
    real = set(AgentName) - {AgentName(a) for a in config.agents.fake}

    missing = real - IMPLEMENTED
    if missing:
        names = ", ".join(sorted(a.value for a in missing))
        raise NotImplementedError(
            f"Agent asli belum tersedia: {names}. Tambahkan ke `agents.fake` di config.yaml."
        )

    if real & {AgentName.WRITER, AgentName.SAFETY}:
        from ..animation.catalog import load_catalog
        from ..llm import build_provider

        provider = provider or build_provider(config.llm)
        if AgentName.WRITER in real:
            from .writer import WriterAgent

            agents[AgentName.WRITER] = WriterAgent(config, provider, load_catalog())
        if AgentName.SAFETY in real:
            from .safety import SafetyAgent

            agents[AgentName.SAFETY] = SafetyAgent(config, provider)
    if AgentName.VOICE in real:
        from ..tts import build_engine
        from .voice import VoiceAgent

        agents[AgentName.VOICE] = VoiceAgent(config, build_engine(config.voice))
    if AgentName.ANIMATOR in real:
        from .animator import AnimatorAgent

        agents[AgentName.ANIMATOR] = AnimatorAgent(config)
    if AgentName.EDITOR in real:
        from ..editor.editor import EditorAgent

        agents[AgentName.EDITOR] = EditorAgent(config)
    return agents
