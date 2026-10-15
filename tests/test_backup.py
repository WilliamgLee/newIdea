"""Backup otomatis database + admin.json, dan laporan doctor."""

from __future__ import annotations

import sqlite3
import time
from datetime import datetime, timedelta

from ai_office.backup import BackupScheduler, is_due, list_backups, make_backup
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.doctor import FAIL, Check, print_report, run_checks


def _prepare(config: AppConfig) -> None:
    config.ensure_dirs()
    db = Database(config.db_path)
    db.init()
    db.create_job(topic="learn colors", age_group="3-6", style="cheerful", language="en")
    (config.data_dir / "admin.json").write_text('{"username": "w"}', encoding="utf-8")


def test_backup_copies_database_and_admin(config: AppConfig) -> None:
    _prepare(config)
    dest = make_backup(config)
    assert (dest / "admin.json").read_text(encoding="utf-8") == '{"username": "w"}'
    with sqlite3.connect(dest / config.db_path.name) as conn:
        assert conn.execute("select topic from jobs").fetchone()[0] == "learn colors"


def test_backup_keeps_only_latest(config: AppConfig) -> None:
    _prepare(config)
    config.backup.keep = 3
    start = datetime(2026, 1, 1, 8, 0, 0)
    for i in range(5):
        make_backup(config, now=start + timedelta(hours=i))
    names = [b.name for b in list_backups(config)]
    assert names == ["20260101-100000", "20260101-110000", "20260101-120000"]


def test_same_second_backups_do_not_collide(config: AppConfig) -> None:
    _prepare(config)
    now = datetime(2026, 1, 1, 8, 0, 0)
    a = make_backup(config, now=now)
    b = make_backup(config, now=now)
    assert a != b and len(list_backups(config)) == 2


def test_is_due_follows_interval(config: AppConfig) -> None:
    _prepare(config)
    assert is_due(config)  # belum ada backup
    t = datetime(2026, 1, 1, 8, 0, 0)
    make_backup(config, now=t)
    config.backup.interval_hours = 24
    assert not is_due(config, now=t + timedelta(hours=23))
    assert is_due(config, now=t + timedelta(hours=24))


def test_scheduler_backs_up_when_due(config: AppConfig) -> None:
    _prepare(config)
    sched = BackupScheduler(config, check_every_sec=0.05)
    sched.start()
    try:
        for _ in range(100):
            if list_backups(config):
                break
            time.sleep(0.05)
    finally:
        sched.stop()
    assert len(list_backups(config)) == 1  # sekali saja, interval default 24 jam


def test_scheduler_disabled(config: AppConfig) -> None:
    _prepare(config)
    config.backup.enabled = False
    sched = BackupScheduler(config, check_every_sec=0.05)
    sched.start()
    time.sleep(0.2)
    sched.stop()
    assert list_backups(config) == []


def test_doctor_quick_runs_without_crashing(config: AppConfig, capsys) -> None:
    _prepare(config)
    sections = run_checks(config, deep=False)
    titles = [t for t, _ in sections]
    assert "Python & paket" in titles and "Proyek" in titles
    print_report(sections)
    assert "Akun admin" in capsys.readouterr().out


def test_doctor_counts_failures(capsys) -> None:
    fails = print_report([("X", [Check(FAIL, "a", "rusak", "perbaiki"), Check("ok", "b")])])
    out = capsys.readouterr().out
    assert fails == 1 and "[XX] a" in out and "-> perbaiki" in out
