"""Merakit komponen inti (dipakai server, CLI, dan test)."""

from __future__ import annotations

import logging

from .agents import build_agents
from .config import AppConfig
from .db import Database
from .events import EventBus
from .orchestrator import Orchestrator


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def build_orchestrator(config: AppConfig) -> Orchestrator:
    config.ensure_dirs()
    db = Database(config.db_path)
    db.init()
    return Orchestrator(config, db, EventBus(), build_agents(config))
