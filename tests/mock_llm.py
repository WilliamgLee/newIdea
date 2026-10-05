"""LLM palsu untuk test: mengembalikan respons berurutan dan mencatat semua panggilan."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from ai_office.llm.base import LLMProvider, Message

Response = str | dict[str, Any] | Callable[[list[Message]], str]


class ScriptedLLM(LLMProvider):
    name = "mock"
    model = "mock-1"

    def __init__(self, responses: list[Response]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def chat(self, messages: list[Message], json_schema: dict[str, Any] | None = None,
             temperature: float | None = None) -> str:
        self.calls.append({"messages": list(messages), "json_schema": json_schema,
                           "temperature": temperature})
        if not self.responses:
            raise AssertionError("ScriptedLLM kehabisan respons")
        r = self.responses.pop(0)
        if callable(r):
            return r(messages)
        return r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)


class RoutedLLM(LLMProvider):
    """Satu provider untuk Penulis & Penasihat: respons dipilih dari isi system prompt."""

    name = "mock"
    model = "mock-1"

    def __init__(self, writer: list[Response], safety: list[Response]) -> None:
        self.writer = ScriptedLLM(writer)
        self.safety = ScriptedLLM(safety)

    def chat(self, messages: list[Message], json_schema: dict[str, Any] | None = None,
             temperature: float | None = None) -> str:
        target = self.safety if "Penasihat Keamanan" in messages[0].content else self.writer
        return target.chat(messages, json_schema, temperature)
