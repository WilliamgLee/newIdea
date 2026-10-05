"""Merakit komponen inti (dipakai server, CLI, dan test)."""

from __future__ import annotations

import logging
from typing import Any

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
    logging.getLogger("httpx").setLevel(logging.WARNING)


def make_script_validator(config: AppConfig):
    """Validator naskah hasil edit admin (skema + katalog animasi + durasi)."""
    from .animation.catalog import load_catalog
    from .schemas import parse_script

    catalog = load_catalog()

    def validate(data: dict[str, Any]) -> dict[str, Any]:
        if isinstance(data, dict) and isinstance(data.get("scenes"), list):
            try:
                data = {**data, "total_duration_sec": round(
                    sum(float(s["duration_sec"]) for s in data["scenes"]), 2)}
            except (KeyError, TypeError, ValueError):
                pass
        return parse_script(data, catalog, config.video).model_dump(mode="json")

    return validate


def build_orchestrator(config: AppConfig) -> Orchestrator:
    config.ensure_dirs()
    db = Database(config.db_path)
    db.init()
    return Orchestrator(config, db, EventBus(), build_agents(config),
                        script_validator=make_script_validator(config))
