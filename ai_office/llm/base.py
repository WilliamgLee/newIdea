"""Abstraksi provider LLM."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal


class LLMError(Exception):
    """Gagal memanggil LLM (koneksi, model belum ada, kuota habis, dll.)."""


@dataclass(frozen=True)
class Message:
    role: Literal["system", "user", "assistant"]
    content: str


class LLMProvider(ABC):
    name: str = "base"
    model: str = ""

    @abstractmethod
    def chat(
        self,
        messages: list[Message],
        json_schema: dict[str, Any] | None = None,
        temperature: float | None = None,
    ) -> str:
        """Kirim percakapan, kembalikan teks jawaban (diharapkan berisi JSON)."""

    def is_available(self) -> bool:
        return True
