from __future__ import annotations

import json
from typing import Any

import pytest

httpx = pytest.importorskip("httpx")

from mock_llm import ScriptedLLM

from ai_office.config import LLMConfig
from ai_office.llm.base import LLMError, Message
from ai_office.llm.gemini import GeminiProvider
from ai_office.llm.ollama import OllamaProvider
from ai_office.llm.structured import StructuredOutputError, extract_json, generate_structured


# ------------------------------------------------------------ extract_json
@pytest.mark.parametrize("text", [
    '{"a": 1}',
    '```json\n{"a": 1}\n```',
    'Berikut naskahnya:\n{"a": 1}\nSemoga membantu!',
])
def test_extract_json(text: str) -> None:
    assert extract_json(text) == {"a": 1}


@pytest.mark.parametrize("text", ["tidak ada json", '{"a": 1,,}'])
def test_extract_json_invalid(text: str) -> None:
    with pytest.raises(ValueError):
        extract_json(text)


# ------------------------------------------------------- retry terstruktur
class Invalid(ValueError):
    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        super().__init__("; ".join(errors))


def parse_needs_ok(data: Any) -> str:
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise Invalid(["field ok harus true"])
    return "berhasil"


def test_retry_sends_error_back_to_llm() -> None:
    llm = ScriptedLLM(["bukan json", {"ok": False}, {"ok": True}])
    logs: list[str] = []
    result, attempts = generate_structured(
        llm, [Message("user", "halo")], parse_needs_ok, max_retries=2, log=logs.append)
    assert (result, attempts) == ("berhasil", 3)
    assert len(llm.calls) == 3
    second = llm.calls[1]["messages"]
    assert second[-2].role == "assistant" and second[-2].content == "bukan json"
    assert "tidak ditemukan objek JSON" in second[-1].content
    assert "field ok harus true" in llm.calls[2]["messages"][-1].content
    assert len(logs) == 2


def test_retry_gives_up_after_max_retries() -> None:
    llm = ScriptedLLM([{"ok": False}] * 5)
    with pytest.raises(StructuredOutputError) as exc:
        generate_structured(llm, [Message("user", "x")], parse_needs_ok, max_retries=2)
    assert exc.value.attempts == 3
    assert len(llm.calls) == 3                      # 1 percobaan + maksimal 2 retry
    assert "field ok harus true" in str(exc.value)


def test_no_retry_when_zero() -> None:
    llm = ScriptedLLM([{"ok": False}])
    with pytest.raises(StructuredOutputError):
        generate_structured(llm, [Message("user", "x")], parse_needs_ok, max_retries=0)
    assert len(llm.calls) == 1


# ------------------------------------------------------------------ Ollama
def ollama_with(handler) -> OllamaProvider:
    cfg = LLMConfig(model="qwen2.5:7b", think=False)
    client = httpx.Client(base_url=cfg.base_url, transport=httpx.MockTransport(handler))
    return OllamaProvider(cfg, client=client)


def test_ollama_chat_sends_schema_and_returns_content() -> None:
    seen: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(path=req.url.path, body=json.loads(req.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": '{"x":1}'}})

    schema = {"type": "object"}
    out = ollama_with(handler).chat([Message("system", "s"), Message("user", "u")],
                                    json_schema=schema, temperature=0.1)
    assert out == '{"x":1}'
    assert seen["path"] == "/api/chat"
    body = seen["body"]
    assert body["format"] == schema and body["stream"] is False
    assert body["options"]["temperature"] == 0.1 and body["think"] is False
    assert body["keep_alive"] == LLMConfig().keep_alive
    assert body["messages"][0] == {"role": "system", "content": "s"}


def test_ollama_model_missing() -> None:
    p = ollama_with(lambda req: httpx.Response(404, json={"error": "model not found"}))
    with pytest.raises(LLMError, match="ollama pull qwen2.5:7b"):
        p.chat([Message("user", "u")])


def test_ollama_not_running() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=req)

    p = ollama_with(handler)
    with pytest.raises(LLMError, match="Pastikan aplikasi Ollama berjalan"):
        p.chat([Message("user", "u")])
    assert p.is_available() is False


def test_ollama_release_unloads_and_waits() -> None:
    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(req.url.path)
        if req.url.path == "/api/generate":
            assert json.loads(req.content)["keep_alive"] == 0
            return httpx.Response(200, json={})
        # /api/ps: pura-pura model sudah tidak termuat
        return httpx.Response(200, json={"models": []})

    ollama_with(handler).release(wait_sec=5)
    assert "/api/generate" in calls and "/api/ps" in calls   # minta lepas lalu cek


def test_ollama_release_waits_until_gone(monkeypatch: pytest.MonkeyPatch) -> None:
    import ai_office.llm.ollama as mod

    monkeypatch.setattr(mod.time, "sleep", lambda s: None)
    state = {"n": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/generate":
            return httpx.Response(200, json={})
        state["n"] += 1
        # dua kali pertama model masih termuat, lalu hilang
        models = [{"name": "qwen2.5:7b"}] if state["n"] < 3 else []
        return httpx.Response(200, json={"models": models})

    ollama_with(handler).release(wait_sec=30)
    assert state["n"] >= 3


def test_ollama_release_is_best_effort() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=req)

    ollama_with(handler).release()  # tidak melempar


def test_ollama_is_available_checks_model() -> None:
    tags = {"models": [{"name": "qwen2.5:7b"}, {"name": "llama3.1:latest"}]}
    assert ollama_with(lambda r: httpx.Response(200, json=tags)).is_available() is True
    assert ollama_with(lambda r: httpx.Response(200, json={"models": []})).is_available() is False


# ------------------------------------------------------------------ Gemini
def gemini_with(handler, key: str = "kunci-test") -> GeminiProvider:
    cfg = LLMConfig(provider="gemini", gemini_model="gemini-test")
    client = httpx.Client(base_url="https://example.test", transport=httpx.MockTransport(handler))
    return GeminiProvider(cfg, api_key=key, client=client)


def test_gemini_chat() -> None:
    seen: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(path=req.url.path, key=req.headers.get("x-goog-api-key"),
                    body=json.loads(req.content), query=str(req.url.query))
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": '{"a":'}, {"text": "1}"}]}}]})

    out = gemini_with(handler).chat([Message("system", "aturan"), Message("user", "u"),
                                     Message("assistant", "a"), Message("user", "u2")])
    assert out == '{"a":1}'
    assert seen["path"] == "/models/gemini-test:generateContent"
    assert seen["key"] == "kunci-test" and "kunci-test" not in seen["query"]
    body = seen["body"]
    assert body["systemInstruction"]["parts"][0]["text"] == "aturan"
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["generationConfig"]["responseMimeType"] == "application/json"


def test_gemini_rate_limited() -> None:
    p = gemini_with(lambda r: httpx.Response(429, json={}))
    with pytest.raises(LLMError, match="Kuota"):
        p.chat([Message("user", "u")])


def test_gemini_without_key() -> None:
    p = gemini_with(lambda r: httpx.Response(200), key="")
    assert p.is_available() is False
    with pytest.raises(LLMError, match="GEMINI_API_KEY"):
        p.chat([Message("user", "u")])
