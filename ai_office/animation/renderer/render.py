"""Renderer deterministik: plan -> frame PNG -> klip MP4 (tanpa audio).

Alur:
1. Playwright membuka stage.html (Chromium headless), memuat plan.
2. Untuk tiap waktu frame, JS menghasilkan SVG; halaman di-screenshot jadi PNG.
3. ffmpeg menyusun PNG jadi MP4 1080x1920 @fps (H.264, NVENC bila ada, fallback libx264).

Encoding video final (audio, subtitle, musik) dikerjakan Editor di M4.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from pathlib import Path

from .encode import encode_frames_to_mp4

log = logging.getLogger(__name__)
RENDERER_DIR = Path(__file__).parent
JS_FILES = ("core.js", "characters.js", "backgrounds.js", "objects.js", "templates.js")


class RenderError(Exception):
    pass


def read_bundle() -> str:
    """Gabungkan semua file JS pustaka (untuk dijalankan di Node/Chromium)."""
    parts = []
    for name in JS_FILES:
        parts.append((RENDERER_DIR / name).read_text(encoding="utf-8"))
    return "\n;\n".join(parts)


def _resolve_js_paths() -> dict[str, Path]:
    base = RENDERER_DIR.parent
    return {
        "core.js": RENDERER_DIR / "core.js",
        "characters.js": base / "characters" / "characters.js",
        "backgrounds.js": base / "scenes" / "backgrounds.js",
        "objects.js": base / "scenes" / "objects.js",
        "templates.js": base / "scenes" / "templates.js",
    }


class FrameRenderer:
    """Render frame PNG via Playwright Chromium."""

    def __init__(self, width: int = 1080, height: int = 1920) -> None:
        self.width = width
        self.height = height

    def is_available(self) -> bool:
        try:
            import playwright  # noqa: F401
        except ImportError:
            return False
        return True

    def render_frames(self, plan: dict, times: list[float], out_dir: Path,
                      progress: Callable[[int, int], None] | None = None) -> list[Path]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RenderError(
                "Playwright belum terpasang. Jalankan: pip install -r requirements.txt && "
                "python -m playwright install chromium"
            ) from exc

        out_dir.mkdir(parents=True, exist_ok=True)
        paths: list[Path] = []
        bundle = _build_page(plan)
        with sync_playwright() as pw:
            try:
                browser = pw.chromium.launch(args=["--force-color-profile=srgb",
                                                   "--disable-lcd-text"])
            except Exception as exc:
                raise RenderError(
                    "Gagal menjalankan Chromium. Jalankan: python -m playwright install chromium"
                ) from exc
            try:
                page = browser.new_page(viewport={"width": self.width, "height": self.height},
                                        device_scale_factor=1)
                page.set_content(bundle, wait_until="load")
                errs = page.evaluate("window.__planErrors || []")
                if errs:
                    raise RenderError("Plan ditolak pustaka animasi: " + "; ".join(errs))
                stage = page.locator("#stage")
                total = len(times)
                for i, t in enumerate(times):
                    page.evaluate("(t) => AIAnim.show(t)", t)
                    frame_path = out_dir / f"frame_{i:05d}.png"
                    stage.screenshot(path=str(frame_path))
                    paths.append(frame_path)
                    if progress and (i % 15 == 0 or i == total - 1):
                        progress(i + 1, total)
            finally:
                browser.close()
        return paths


def _build_page(plan: dict) -> str:
    """stage.html + JS inline + plan, siap di-set_content (tanpa server/file lokal)."""
    html = (RENDERER_DIR / "stage.html").read_text(encoding="utf-8")
    scripts = ""
    for name, path in _resolve_js_paths().items():
        scripts += f"\n<script>/* {name} */\n{path.read_text(encoding='utf-8')}\n</script>"
    # buang tag <script src=...> dan sisipkan JS inline + loader plan
    for name in JS_FILES:
        html = html.replace(f'<script src="{name}"></script>', "")
    loader = (
        "<script>\n" + "window.__plan = " + json.dumps(plan) + ";\n"
        "window.__planErrors = AIAnim.load(window.__plan);\n"
        "if (window.__planErrors.length === 0) AIAnim.show(0);\n</script>"
    )
    return html.replace("</head>", scripts + "</head>").replace(
        '<script>\n    window.AIReady = true;\n  </script>', loader)


def render_plan_to_mp4(plan: dict, workdir: Path, fps: int, encoder: str = "auto",
                       renderer: FrameRenderer | None = None,
                       log_fn: Callable[[str], None] = print) -> Path:
    from ..plan import frame_times

    renderer = renderer or FrameRenderer(plan["width"], plan["height"])
    times = frame_times(plan["total_duration"], fps)
    frames_dir = workdir / "frames"
    log_fn(f"Merender {len(times)} frame {plan['width']}x{plan['height']} @ {fps}fps")
    renderer.render_frames(plan, times, frames_dir,
                           progress=lambda i, n: log_fn(f"  frame {i}/{n}"))
    out = workdir / "animation.mp4"
    chosen = encode_frames_to_mp4(frames_dir, out, fps, encoder, log_fn)
    log_fn(f"Klip animasi: {out.name} (encoder {chosen})")
    return out
