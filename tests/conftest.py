from __future__ import annotations

from pathlib import Path

import pytest

from ai_office.agents.fake import build_fake_agents
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.events import EventBus
from ai_office.orchestrator import Orchestrator


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    return AppConfig.from_dict(
        {"pipeline": {"poll_interval_sec": 0.05}, "agents": {"fake_delay_sec": 0}},
        base_dir=tmp_path,
    )


@pytest.fixture
def make_orch(config: AppConfig):
    def _make(**agent_overrides) -> Orchestrator:
        config.ensure_dirs()
        db = Database(config.db_path)
        db.init()
        agents = build_fake_agents(0)
        for agent in agent_overrides.values():
            agents[agent.name] = agent
        return Orchestrator(config, db, EventBus(), agents)

    return _make


@pytest.fixture
def orch(make_orch) -> Orchestrator:
    return make_orch()
