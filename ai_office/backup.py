"""Backup otomatis database (SQLite) dan admin.json.

Tiap backup disimpan sebagai satu folder bertanggal di `backup.dir` (default data/backups):

    data/backups/20261015-190000/ai_office.db
    data/backups/20261015-190000/admin.json

Database disalin dengan SQLite online backup API, jadi aman walau server sedang menulis.
Saat server jalan, BackupScheduler membuat backup sekali tiap `backup.interval_hours`
(dan langsung saat start bila backup terakhir sudah lebih lama dari interval itu).

Memulihkan: matikan server, lalu salin isi folder backup kembali ke folder data/.
"""

from __future__ import annotations

import logging
import re
import shutil
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .config import AppConfig

log = logging.getLogger(__name__)

STAMP_FORMAT = "%Y%m%d-%H%M%S"
_STAMP = re.compile(r"^\d{8}-\d{6}(?:-\d+)?$")
EXTRA_FILES = ("admin.json",)


def backup_root(config: AppConfig) -> Path:
    return config.resolve(config.backup.dir)


def list_backups(config: AppConfig) -> list[Path]:
    """Folder backup, terlama -> terbaru."""
    root = backup_root(config)
    if not root.exists():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir() and _STAMP.match(p.name))


def backup_time(path: Path) -> datetime:
    return datetime.strptime(path.name[:15], STAMP_FORMAT)


def latest_backup(config: AppConfig) -> Path | None:
    backups = list_backups(config)
    return backups[-1] if backups else None


def make_backup(config: AppConfig, now: datetime | None = None) -> Path:
    """Buat satu backup sekarang, lalu hapus backup lama melebihi `backup.keep`."""
    root = backup_root(config)
    root.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now()).strftime(STAMP_FORMAT)
    dest = root / stamp
    n = 1
    while dest.exists():  # dua backup di detik yang sama
        dest = root / f"{stamp}-{n}"
        n += 1
    dest.mkdir()

    db = config.db_path
    if db.exists():
        src = sqlite3.connect(db)
        dst = sqlite3.connect(dest / db.name)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
    for name in EXTRA_FILES:
        f = config.data_dir / name
        if f.exists():
            shutil.copy2(f, dest / name)
    prune(config)
    log.info("Backup dibuat: %s", dest)
    return dest


def prune(config: AppConfig) -> list[Path]:
    """Hapus backup tertua sampai tersisa `backup.keep`. Mengembalikan folder yang dihapus."""
    backups = list_backups(config)
    removed = backups[: max(0, len(backups) - config.backup.keep)]
    for old in removed:
        shutil.rmtree(old, ignore_errors=True)
    return removed


def is_due(config: AppConfig, now: datetime | None = None) -> bool:
    last = latest_backup(config)
    if last is None:
        return True
    age = (now or datetime.now()) - backup_time(last)
    return age.total_seconds() >= config.backup.interval_hours * 3600


class BackupScheduler:
    """Thread latar yang membuat backup tiap interval selama server jalan."""

    def __init__(self, config: AppConfig, check_every_sec: float = 60.0) -> None:
        self.config = config
        self.check_every_sec = check_every_sec
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if not self.config.backup.enabled or self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="ai-office-backup", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                if is_due(self.config):
                    make_backup(self.config)
            except Exception:  # noqa: BLE001 - backup gagal tidak boleh menjatuhkan server
                log.exception("Backup otomatis gagal")
            self._stop.wait(self.check_every_sec)
