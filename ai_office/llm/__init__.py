"""Provider LLM: ollama (default, lokal) atau gemini (opsional, free tier)."""

from __future__ import annotations

from ..config import LLMConfig
from .base import LLMError, LLMProvider, Message

__all__ = ["LLMError", "LLMProvider", "Message", "build_provider"]


def build_provider(cfg: LLMConfig) -> LLMProvider:
    if cfg.provider == "ollama":
        from .ollama import OllamaProvider

        return OllamaProvider(cfg)
    if cfg.provider == "gemini":
        from .gemini import GeminiProvider

        return GeminiProvider(cfg)
    raise ValueError(f"Provider LLM tidak dikenal: {cfg.provider}")
