"""Pengirim: salin hasil akhir ke folder tujuan, lalu buka folder di file explorer.

Isi folder tujuan: video.mp4, thumbnail.png, script.json, metadata.txt (+ metadata.json).
Folder: <delivery.dest_dir>/<tanggal>_<slug-judul>/
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config import AppConfig
from ..models import AgentName
from ..schemas import Script
from .base import Agent, AgentContext, AgentError


def slugify(text: str, max_len: int = 50) -> str:
    s = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s[:max_len].strip("-") or "video"


def open_in_file_manager(path: Path) -> bool:
    """Buka folder di file explorer. Cross-platform, best-effort (tidak melempar error)."""
    try:
        if sys.platform == "win32":
            subprocess.Popen(["explorer", str(path)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(path)])
        else:
            subprocess.Popen(["xdg-open", str(path)])
        return True
    except Exception:  # noqa: BLE001 - gagal membuka explorer tidak boleh menggagalkan job
        return False


class DeliveryAgent(Agent):
    name = AgentName.DELIVERY

    def __init__(self, config: AppConfig, open_folder: bool | None = None,
                 opener=open_in_file_manager) -> None:
        self.config = config
        self.open_folder = config.delivery.open_folder if open_folder is None else open_folder
        self._opener = opener

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        raw = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        editor = ctx.artifacts.get(AgentName.EDITOR.value)
        if not raw or not editor:
            raise AgentError("Pengirim butuh naskah dan hasil Editor (video final)")
        script = Script.model_validate(raw)

        dest_root = self.config.delivery_dir
        folder_name = f"{datetime.now(tz=UTC):%Y%m%d}_{slugify(script.title)}"
        dest = dest_root / folder_name
        dest.mkdir(parents=True, exist_ok=True)

        copied = self._copy_outputs(ctx, script, editor, dest)
        ctx.log(f"Menyalin {len(copied)} file ke {dest}")

        opened = False
        if self.open_folder:
            opened = self._opener(dest)
            ctx.log("Membuka folder tujuan" if opened else
                    "Tidak bisa membuka file explorer (lewati)")

        return {
            "dest_dir": str(dest),
            "files": copied,
            "opened_folder": opened,
            "delivered": True,
        }

    def _copy_outputs(self, ctx: AgentContext, script: Script, editor: dict[str, Any],
                      dest: Path) -> list[str]:
        copied: list[str] = []

        def copy(src: Path, dst_name: str) -> None:
            if src.exists():
                shutil.copy2(src, dest / dst_name)
                copied.append(dst_name)

        wd = ctx.workdir
        copy(wd / editor["video_file"], "video.mp4")
        if editor.get("thumbnail_file"):
            copy(wd / editor["thumbnail_file"], "thumbnail.png")
        if (wd / "metadata.txt").exists():
            copy(wd / "metadata.txt", "metadata.txt")
        if (wd / "metadata.json").exists():
            copy(wd / "metadata.json", "metadata.json")

        # script.json: tulis dari artefak (selalu ada, rapi)
        (dest / "script.json").write_text(
            json.dumps(script.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8")
        copied.append("script.json")
        return copied
