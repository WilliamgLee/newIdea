"""Normalisasi topik dan perencanaan batch (murni, tanpa I/O)."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

MAX_LINES = 500
MAX_TOPIC_LEN = 200

_EDGE_RE = re.compile(r"^[\W_]+|[\W_]+$")

OutcomeKind = Literal["created", "duplicate", "empty", "too_long"]


def normalize_topic(s: str) -> str:
    """Topik_Ternormalisasi: lower, buang tanda baca/spasi di tepi, rapatkan spasi internal."""
    s = _EDGE_RE.sub("", s.lower())
    return " ".join(s.split())


def parse_topic_lines(text: str) -> list[str]:
    """Pecah teks menjadi baris (satu topik per baris)."""
    return text.splitlines()


@dataclass(frozen=True)
class LineOutcome:
    line_no: int                      # nomor baris, mulai dari 1
    topic: str                        # baris asli yang sudah di-strip()
    kind: OutcomeKind
    duplicate_of: int | None = None   # id job lama, atau None jika duplikat di dalam daftar


def plan_batch(
    lines: Iterable[str],
    existing: Mapping[str, int],
    allow_duplicates: bool,
) -> list[LineOutcome]:
    """Klasifikasikan setiap baris; tepat satu outcome per baris (Req 4.3–4.7).

    `existing` memetakan topik ternormalisasi → id job aktif (status selain
    `failed`/`rejected`).
    """
    outcomes: list[LineOutcome] = []
    seen: set[str] = set()
    for idx, raw in enumerate(lines, start=1):
        topic = raw.strip()
        norm = normalize_topic(raw)
        if not norm:
            kind: OutcomeKind = "empty"
            dup_of = None
        elif len(norm) > MAX_TOPIC_LEN:
            kind, dup_of = "too_long", None
        elif not allow_duplicates and norm in seen:
            kind, dup_of = "duplicate", None
        elif not allow_duplicates and norm in existing:
            kind, dup_of = "duplicate", existing[norm]
        else:
            kind, dup_of = "created", None
        if kind in ("created", "duplicate"):
            seen.add(norm)
        outcomes.append(LineOutcome(idx, topic, kind, dup_of))
    return outcomes
