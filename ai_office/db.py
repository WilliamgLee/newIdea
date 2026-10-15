"""Lapisan database SQLite.

Setiap operasi membuka koneksi singkat sendiri (aman dipakai dari thread worker,
thread API, maupun proses CLI terpisah). WAL mode dipakai agar baca/tulis tidak saling kunci.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .models import (
    RUNNABLE_STATUSES,
    InvalidTransition,
    Job,
    JobStatus,
    check_transition,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    topic         TEXT    NOT NULL,
    age_group     TEXT    NOT NULL,
    style         TEXT    NOT NULL,
    language      TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    title         TEXT,
    safety_round  INTEGER NOT NULL DEFAULT 0,
    safety_passed INTEGER,
    failed_stage  TEXT,
    error         TEXT,
    artifacts     TEXT    NOT NULL DEFAULT '{}',
    created_at    REAL    NOT NULL,
    updated_at    REAL    NOT NULL,
    started_at    REAL,
    finished_at   REAL,
    processing_sec REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS job_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    ts         REAL    NOT NULL,
    level      TEXT    NOT NULL,
    agent      TEXT,
    message    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs(job_id);

CREATE TABLE IF NOT EXISTS safety_reviews (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    round      INTEGER NOT NULL,
    verdict    TEXT    NOT NULL,
    review     TEXT    NOT NULL,
    ts         REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON safety_reviews(job_id);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    # ---------- koneksi ----------
    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 30000")
        try:
            yield conn
        finally:
            conn.close()

    def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.executescript(SCHEMA)
            self._migrate(conn)

    @staticmethod
    def _migrate(conn: sqlite3.Connection) -> None:
        """Tambah kolom baru pada database lama (dibuat versi sebelumnya)."""
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(jobs)").fetchall()}
        if "processing_sec" not in cols:  # M1
            conn.execute("ALTER TABLE jobs ADD COLUMN processing_sec REAL NOT NULL DEFAULT 0")

    # ---------- jobs ----------
    def create_job(self, topic: str, age_group: str, style: str, language: str) -> Job:
        now = time.time()
        with self.connect() as conn:
            cur = conn.execute(
                "INSERT INTO jobs (topic, age_group, style, language, status, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (topic, age_group, style, language, JobStatus.QUEUED.value, now, now),
            )
            job_id = cur.lastrowid
        assert job_id is not None
        return self.get_job(job_id)  # type: ignore[return-value]

    def get_job(self, job_id: int) -> Job | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return Job.from_row(row) if row else None

    def require_job(self, job_id: int) -> Job:
        job = self.get_job(job_id)
        if job is None:
            raise KeyError(f"Job {job_id} tidak ditemukan")
        return job

    def list_jobs(
        self, statuses: list[JobStatus] | None = None, limit: int = 100
    ) -> list[Job]:
        sql = "SELECT * FROM jobs"
        params: list[Any] = []
        if statuses:
            sql += f" WHERE status IN ({','.join('?' * len(statuses))})"
            params.extend(s.value for s in statuses)
        sql += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [Job.from_row(r) for r in rows]

    def next_runnable_job(self) -> Job | None:
        """Job tertua yang bisa diproses worker (FIFO)."""
        statuses = [s.value for s in RUNNABLE_STATUSES]
        with self.connect() as conn:
            row = conn.execute(
                f"SELECT * FROM jobs WHERE status IN ({','.join('?' * len(statuses))})"
                " ORDER BY id ASC LIMIT 1",
                statuses,
            ).fetchone()
        return Job.from_row(row) if row else None

    def transition(
        self, job_id: int, new_status: JobStatus, **fields: Any
    ) -> tuple[JobStatus, Job]:
        """Ubah status secara atomik (compare-and-set). Mengembalikan (status_lama, job_baru).

        Field tambahan yang diizinkan: title, safety_round, safety_passed, failed_stage, error,
        started_at, finished_at.
        """
        allowed = {"title", "safety_round", "safety_passed", "failed_stage", "error",
                   "started_at", "finished_at"}
        bad = set(fields) - allowed
        if bad:
            raise ValueError(f"Field tidak boleh diubah lewat transition: {bad}")
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute("SELECT status FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if row is None:
                    raise KeyError(f"Job {job_id} tidak ditemukan")
                current = JobStatus(row["status"])
                check_transition(current, new_status)
                sets = ["status = ?", "updated_at = ?"]
                params: list[Any] = [new_status.value, time.time()]
                for key, value in fields.items():
                    if isinstance(value, JobStatus):
                        value = value.value
                    elif isinstance(value, bool):
                        value = int(value)
                    sets.append(f"{key} = ?")
                    params.append(value)
                params.extend([job_id, current.value])
                cur = conn.execute(
                    f"UPDATE jobs SET {', '.join(sets)} WHERE id = ? AND status = ?", params
                )
                if cur.rowcount != 1:
                    raise InvalidTransition("Status job berubah bersamaan, coba lagi")
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
        return current, self.require_job(job_id)

    def set_artifact(self, job_id: int, key: str, value: Any) -> None:
        """Simpan output agent (JSON) ke kolom artifacts secara atomik."""
        with self.connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                row = conn.execute("SELECT artifacts FROM jobs WHERE id = ?", (job_id,)).fetchone()
                if row is None:
                    raise KeyError(f"Job {job_id} tidak ditemukan")
                artifacts = json.loads(row["artifacts"] or "{}")
                artifacts[key] = value
                conn.execute(
                    "UPDATE jobs SET artifacts = ?, updated_at = ? WHERE id = ?",
                    (json.dumps(artifacts, ensure_ascii=False), time.time(), job_id),
                )
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise

    def add_processing_time(self, job_id: int, seconds: float) -> None:
        """Akumulasi waktu kerja agent (tidak termasuk waktu menunggu admin)."""
        with self.connect() as conn:
            conn.execute("UPDATE jobs SET processing_sec = processing_sec + ? WHERE id = ?",
                         (seconds, job_id))

    def count_by_status(self) -> dict[str, int]:
        with self.connect() as conn:
            rows = conn.execute("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").fetchall()
        return {r["status"]: r["n"] for r in rows}

    def last_finished_job(self) -> Job | None:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM jobs WHERE status = ? AND finished_at IS NOT NULL"
                " ORDER BY finished_at DESC LIMIT 1",
                (JobStatus.DONE.value,),
            ).fetchone()
        return Job.from_row(row) if row else None

    # ---------- log ----------
    def add_log(self, job_id: int, message: str, level: str = "INFO",
                agent: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO job_logs (job_id, ts, level, agent, message) VALUES (?, ?, ?, ?, ?)",
                (job_id, time.time(), level, agent, message),
            )

    def get_logs(self, job_id: int) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT ts, level, agent, message FROM job_logs WHERE job_id = ? ORDER BY id",
                (job_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    # ---------- review keamanan ----------
    def add_safety_review(self, job_id: int, round_no: int, verdict: str,
                          review: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO safety_reviews (job_id, round, verdict, review, ts)"
                " VALUES (?, ?, ?, ?, ?)",
                (job_id, round_no, verdict, json.dumps(review, ensure_ascii=False), time.time()),
            )

    def get_safety_reviews(self, job_id: int) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT round, verdict, review, ts FROM safety_reviews WHERE job_id = ?"
                " ORDER BY id",
                (job_id,),
            ).fetchall()
        return [
            {"round": r["round"], "verdict": r["verdict"], "ts": r["ts"],
             "review": json.loads(r["review"])}
            for r in rows
        ]

    # ---------- settings (override config dari panel admin, dipakai M6) ----------
    def get_setting(self, key: str) -> Any | None:
        with self.connect() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def set_setting(self, key: str, value: Any) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
