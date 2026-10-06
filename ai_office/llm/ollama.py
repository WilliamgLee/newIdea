"""Provider Ollama lokal (default, gratis). Docs API: https://docs.ollama.com/api"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import LLMConfig
from .base import LLMError, LLMProvider, Message

log = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(self, cfg: LLMConfig, client: httpx.Client | None = None) -> None:
        self.cfg = cfg
        self.model = cfg.model
        self._client = client or httpx.Client(base_url=cfg.base_url, timeout=cfg.timeout_sec)

    def chat(
        self,
        messages: list[Message],
        json_schema: dict[str, Any] | None = None,
        temperature: float | None = None,
    ) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "stream": False,
            # structured output: JSON schema membatasi model agar hanya memakai nama valid
            "format": json_schema if json_schema is not None else "json",
            "options": {
                "temperature": self.cfg.temperature if temperature is None else temperature,
                "num_ctx": self.cfg.num_ctx,
            },
        }
        if self.cfg.think is not None:
            body["think"] = self.cfg.think
        try:
            resp = self._client.post("/api/chat", json=body)
        except httpx.HTTPError as exc:
            raise LLMError(
                f"Tidak bisa menghubungi Ollama di {self.cfg.base_url}. "
                f"Pastikan aplikasi Ollama berjalan. ({type(exc).__name__})"
            ) from exc
        if resp.status_code == 404:
            raise LLMError(
                f"Model '{self.model}' belum ada di Ollama. Jalankan: ollama pull {self.model}"
            )
        if resp.status_code >= 400:
            raise LLMError(f"Ollama error {resp.status_code}: {resp.text[:300]}")
        try:
            content = resp.json()["message"]["content"]
        except (ValueError, KeyError, TypeError) as exc:
            raise LLMError("Respons Ollama tidak dikenali") from exc
        if not isinstance(content, str):
            raise LLMError("Respons Ollama tidak berisi teks")
        return content

    def release(self) -> None:
        """Minta Ollama melepas model dari VRAM (keep_alive=0), agar GPU bisa dipakai TTS.

        Berguna di GPU kecil (mis. 6 GB) saat memakai XTTS yang juga butuh VRAM.
        """
        try:
            self._client.post("/api/generate",
                              json={"model": self.model, "keep_alive": 0})
        except httpx.HTTPError:
            pass  # best-effort

    def is_available(self) -> bool:
        try:
            resp = self._client.get("/api/tags", timeout=3.0)
            resp.raise_for_status()
            names = {m.get("name", "") for m in resp.json().get("models", [])}
        except (httpx.HTTPError, ValueError):
            return False
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        return wanted in names
