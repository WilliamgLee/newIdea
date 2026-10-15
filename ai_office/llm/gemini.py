"""Provider Gemini (opsional, free tier). API key dibaca dari env GEMINI_API_KEY.

Catatan: free tier punya batas request per menit/hari, dan nama model bisa berubah.
Atur `llm.gemini_model` di config.yaml bila perlu.
"""

from __future__ import annotations

import os
from typing import Any

import httpx

from ..config import LLMConfig
from .base import LLMError, LLMProvider, Message

API_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, cfg: LLMConfig, api_key: str | None = None,
                 client: httpx.Client | None = None) -> None:
        self.cfg = cfg
        self.model = cfg.gemini_model
        self._api_key = api_key if api_key is not None else os.environ.get("GEMINI_API_KEY", "")
        self._client = client or httpx.Client(base_url=API_BASE, timeout=cfg.timeout_sec)

    def chat(
        self,
        messages: list[Message],
        json_schema: dict[str, Any] | None = None,
        temperature: float | None = None,
    ) -> str:
        if not self._api_key:
            raise LLMError("GEMINI_API_KEY belum diisi di file .env")
        system = "\n\n".join(m.content for m in messages if m.role == "system")
        contents = [
            {"role": "model" if m.role == "assistant" else "user", "parts": [{"text": m.content}]}
            for m in messages if m.role != "system"
        ]
        body: dict[str, Any] = {
            "contents": contents,
            "generationConfig": {
                "temperature": self.cfg.temperature if temperature is None else temperature,
                "responseMimeType": "application/json",
            },
        }
        if system:
            body["systemInstruction"] = {"parts": [{"text": system}]}
        try:
            resp = self._client.post(
                f"/models/{self.model}:generateContent",
                json=body,
                headers={"x-goog-api-key": self._api_key},  # key di header, bukan di URL/log
            )
        except httpx.HTTPError as exc:
            raise LLMError(f"Tidak bisa menghubungi Gemini ({type(exc).__name__})") from exc
        if resp.status_code == 429:
            raise LLMError("Kuota Gemini free tier habis / terlalu sering. Coba lagi nanti.")
        if resp.status_code >= 400:
            raise LLMError(f"Gemini error {resp.status_code}: {resp.text[:300]}")
        try:
            parts = resp.json()["candidates"][0]["content"]["parts"]
            return "".join(p.get("text", "") for p in parts)
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMError("Respons Gemini tidak dikenali (mungkin diblokir filter)") from exc

    def is_available(self) -> bool:
        return bool(self._api_key)
