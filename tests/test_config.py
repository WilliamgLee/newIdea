from __future__ import annotations

from pathlib import Path

import pytest

from ai_office.config import AppConfig, ConfigError

ROOT = Path(__file__).resolve().parent.parent


def test_defaults_are_valid(tmp_path: Path) -> None:
    cfg = AppConfig.from_dict({}, base_dir=tmp_path)
    assert cfg.server.host == "127.0.0.1"
    assert cfg.pipeline.mode == "semi_auto"
    assert cfg.db_path == tmp_path / "data" / "ai_office.db"


def test_invalid_mode_rejected(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        AppConfig.from_dict({"pipeline": {"mode": "turbo"}}, base_dir=tmp_path)


def test_unknown_key_rejected(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        AppConfig.from_dict({"pipeline": {"typo_key": 1}}, base_dir=tmp_path)


def test_wrong_type_rejected(tmp_path: Path) -> None:
    with pytest.raises(ConfigError):
        AppConfig.from_dict({"server": {"port": "abc"}}, base_dir=tmp_path)


def test_int_accepted_for_float(tmp_path: Path) -> None:
    cfg = AppConfig.from_dict({"pipeline": {"poll_interval_sec": 3}}, base_dir=tmp_path)
    assert cfg.pipeline.poll_interval_sec == 3.0


def test_repo_config_yaml_loads() -> None:
    pytest.importorskip("yaml")
    from ai_office.config import load_config

    cfg = load_config(ROOT / "config.yaml")
    assert cfg.server.host == "127.0.0.1"
    assert cfg.video.width == 1080 and cfg.video.height == 1920
