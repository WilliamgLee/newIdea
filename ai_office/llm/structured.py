"""Minta JSON ke LLM, validasi, dan retry dengan pesan error (maks `max_retries` kali)."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from typing import Any, TypeVar

from .base import LLMProvider, Message

T = TypeVar("T")

RETRY_PROMPT = (
    "Output JSON kamu belum valid. Perbaiki SEMUA masalah berikut:\n{errors}\n\n"
    "Kirim ulang JSON LENGKAP yang sudah diperbaiki. Hanya JSON, tanpa penjelasan."
)
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class StructuredOutputError(Exception):
    """LLM tetap memberi output tidak valid setelah semua retry."""

    def __init__(self, attempts: int, errors: list[str]) -> None:
        self.attempts = attempts
        self.errors = errors
        super().__init__(
            f"Output LLM tetap tidak valid setelah {attempts} percobaan: " + "; ".join(errors[:5])
        )


def extract_json(text: str) -> Any:
    """Ambil objek JSON dari teks (toleran terhadap ```json ... ``` dan teks pembuka)."""
    cleaned = _FENCE.sub("", text.strip())
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("tidak ditemukan objek JSON di output") from None
        try:
            return json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON rusak: {exc.msg} (baris {exc.lineno})") from None


def generate_structured(
    provider: LLMProvider,
    messages: list[Message],
    parse: Callable[[Any], T],
    max_retries: int = 2,
    json_schema: dict[str, Any] | None = None,
    temperature: float | None = None,
    log: Callable[[str], None] | None = None,
) -> tuple[T, int]:
    """Kembalikan (hasil_tervalidasi, jumlah_percobaan).

    `parse` harus raise ValueError (mis. `OutputInvalid`) bila data tidak valid.
    Error koneksi LLM (`LLMError`) tidak di-retry di sini.
    """
    convo = list(messages)
    errors: list[str] = []
    attempts = max_retries + 1
    for attempt in range(1, attempts + 1):
        raw = provider.chat(convo, json_schema=json_schema, temperature=temperature)
        try:
            return parse(extract_json(raw)), attempt
        except ValueError as exc:
            errs = getattr(exc, "errors", None)
            errors = list(errs) if isinstance(errs, list) and errs else [str(exc)]
        if log:
            log(f"Percobaan {attempt}/{attempts} tidak valid: " + "; ".join(errors[:5]))
        convo += [
            Message("assistant", raw[:6000]),
            Message("user", RETRY_PROMPT.format(errors="\n".join(f"- {e}" for e in errors))),
        ]
    raise StructuredOutputError(attempts, errors)
