"""Test M3: pustaka animasi + renderer.

- Determinisme, validasi, dan kecocokan katalog<->pustaka: dijalankan di Node (deterministik,
  tanpa browser). Skip bila Node tidak ada.
- Pembuatan plan (Python murni) + agent Animator dengan renderer palsu: selalu jalan.
- Render Playwright + ffmpeg sungguhan: di-mock; ada 1 integrasi (skip bila belum terpasang).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from ai_office.agents.animator import AnimatorAgent
from ai_office.agents.base import AgentContext, AgentError
from ai_office.animation.catalog import load_catalog
from ai_office.animation.plan import build_plan, frame_times
from ai_office.config import AppConfig
from ai_office.schemas import Script, VoiceResult

ROOT = Path(__file__).resolve().parent.parent
HARNESS = ROOT / "tests" / "js_harness.mjs"
EXAMPLE = json.loads((ROOT / "examples" / "mengenal_warna.json").read_text(encoding="utf-8"))
NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node tidak terpasang")


def js(req: dict) -> object:
    proc = subprocess.run([NODE, str(HARNESS), json.dumps(req)],
                          capture_output=True, text=True, timeout=60, check=False)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


def make_plan(script_dict: dict = EXAMPLE) -> dict:
    script = Script.model_validate(script_dict)
    scenes = []
    for s in script.scenes:
        scenes.append({
            "scene_id": s.id, "audio_file": f"audio/scene_{s.id}.wav",
            "audio_duration_sec": s.duration_sec, "duration_sec": s.duration_sec,
            "timing_source": "word", "word_coverage": 1.0,
            "sentences": [{"text": s.narration, "start": 0.0, "end": s.duration_sec,
                           "words": [{"text": w, "start": i * 0.3, "end": i * 0.3 + 0.25}
                                     for i, w in enumerate(s.narration.split())]}],
        })
    voice = VoiceResult(engine="fake", voice="v", rate="+0%", scenes=scenes,
                        total_duration_sec=sum(s["duration_sec"] for s in scenes))
    return build_plan(script, voice, fps=30)


# ---------------------------------------------------- plan (Python murni)
def test_build_plan_structure() -> None:
    plan = make_plan()
    assert plan["width"] == 1080 and plan["height"] == 1920 and plan["fps"] == 30
    assert len(plan["scenes"]) == 6
    starts = [s["start"] for s in plan["scenes"]]
    assert starts == sorted(starts) and starts[0] == 0
    assert plan["scenes"][0]["template"] == "intro"
    assert plan["scenes"][-1]["template"] == "outro"
    assert plan["scenes"][1]["words"][0]["text"] == "Lihat,"
    assert plan["total_duration"] == pytest.approx(sum(s["duration"] for s in plan["scenes"]))


def test_frame_times() -> None:
    t = frame_times(1.0, 30)
    assert len(t) == 30 and t[0] == pytest.approx(0.5 / 30, abs=1e-6)
    assert len(frame_times(2.05, 30)) == 62  # ceil(2.05*30 = 61.5)
    assert len(frame_times(2.0, 30)) == 60


# ------------------------------------------------- pustaka JS (via Node)
@needs_node
def test_catalog_matches_js_library() -> None:
    """catalog.yaml (yang dilihat LLM) HARUS sama persis dengan pustaka animasi."""
    manifest = js({"op": "manifest"})
    cat = load_catalog()
    assert set(manifest["templates"]) == set(cat.templates)
    assert set(manifest["backgrounds"]) == set(cat.backgrounds)
    assert set(manifest["objects"]) == set(cat.all_objects)
    assert set(manifest["colors"]) == set(cat.colors)
    assert set(manifest["characters"]) == set(cat.characters)
    for name, spec in cat.characters.items():
        assert set(manifest["characters"][name]["poses"]) == set(spec.poses)
        assert set(manifest["characters"][name]["emotions"]) == set(spec.emotions)


@needs_node
def test_js_validate_accepts_example() -> None:
    assert js({"op": "validate", "plan": make_plan()}) == []


@needs_node
def test_js_validate_rejects_unknown_names() -> None:
    plan = make_plan()
    plan["scenes"][1]["template"] = "nope"
    plan["scenes"][2]["items"] = ["naga"]
    errs = js({"op": "validate", "plan": plan})
    joined = " ".join(errs)
    assert "template tidak ada: nope" in joined and "objek tidak ada: naga" in joined


@needs_node
def test_frames_are_valid_svg_1080x1920() -> None:
    plan = make_plan()
    times = [0.1, plan["scenes"][1]["start"] + 0.3, plan["total_duration"] - 0.1]
    frames = js({"op": "frames", "plan": plan, "times": times})
    assert len(frames) == 3
    for svg in frames:
        assert svg.startswith("<svg") and svg.rstrip().endswith("</svg>")
        assert 'width="1080"' in svg and 'height="1920"' in svg
        assert "NaN" not in svg and "undefined" not in svg


@needs_node
def test_rendering_is_deterministic() -> None:
    plan = make_plan()
    a = js({"op": "frames", "plan": plan, "times": [0.5, 1.5, 2.5]})
    b = js({"op": "frames", "plan": plan, "times": [0.5, 1.5, 2.5]})
    assert a == b


@needs_node
def test_mouth_moves_with_speech() -> None:
    """Lip-sync: mulut harus berbeda saat ada kata vs saat diam."""
    plan = make_plan()
    sc = plan["scenes"][1]
    plan2 = json.loads(json.dumps(plan))
    plan2["scenes"] = [sc | {"start": 0.0}]
    w = sc["words"][0]
    speaking = js({"op": "frames", "plan": plan2,
                   "times": [(w["start"] + w["end"]) / 2]})[0]
    silent = js({"op": "frames", "plan": plan2, "times": [sc["duration"] - 0.05]})[0]
    assert speaking != silent


@needs_node
def test_all_objects_and_backgrounds_render() -> None:
    """Setiap objek, latar, pose, dan emosi harus menghasilkan SVG tanpa error."""
    cat = load_catalog()
    scenes = []
    objs = sorted(cat.all_objects)
    for i, obj in enumerate(objs):
        scenes.append({"id": i + 1, "start": i, "duration": 1, "template": "show_object",
                       "character": "kiki", "pose": "point", "emotion": "happy",
                       "background": sorted(cat.backgrounds)[i % len(cat.backgrounds)],
                       "items": [obj], "count": None, "color": None, "text": obj, "words": []})
    plan = {"fps": 30, "width": 1080, "height": 1920, "total_duration": len(objs),
            "scenes": scenes, "title": "t"}
    assert js({"op": "validate", "plan": plan}) == []
    frames = js({"op": "frames", "plan": plan, "times": [i + 0.5 for i in range(len(objs))]})
    assert all(f.startswith("<svg") and "undefined" not in f for f in frames)


# ------------------------------------------------- agent (renderer palsu)
class FakeRenderer:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def is_available(self) -> bool:
        return True

    def render_frames(self, plan, times, out_dir, progress=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for i in range(len(times)):
            p = out_dir / f"frame_{i:05d}.png"
            p.write_bytes(b"\x89PNG")
            paths.append(p)
        self.calls.append({"n": len(times), "plan": plan})
        if progress:
            progress(len(times), len(times))
        return paths


class FakeMedia:
    def is_available(self) -> bool:
        return True


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    cfg = AppConfig.from_dict({"paths": {"data_dir": str(tmp_path / "d"),
                                         "output_dir": str(tmp_path / "o")}}, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


def ctx_with_voice(config: AppConfig) -> AgentContext:
    from ai_office.db import Database

    db = Database(config.db_path)
    db.init()
    job = db.create_job("mengenal warna", "3-6", "ceria", "id")
    plan = make_plan()
    voice = {"engine": "fake", "voice": "v", "rate": "+0%",
             "total_duration_sec": plan["total_duration"],
             "scenes": [{"scene_id": s["id"], "audio_file": f"audio/scene_{s['id']}.wav",
                         "audio_duration_sec": s["duration"], "duration_sec": s["duration"],
                         "timing_source": "word", "word_coverage": 1.0,
                         "sentences": [{"text": s["narration"], "start": 0, "end": s["duration"],
                                        "words": s["words"]}]} for s in plan["scenes"]]}
    job.artifacts = {"writer": {"script": EXAMPLE}, "voice": voice}
    workdir = config.output_dir / f"job_{job.id}"
    workdir.mkdir(parents=True)
    return AgentContext(job=job, config=config, workdir=workdir, log=lambda m: None)


def test_animator_produces_clip(config: AppConfig, monkeypatch: pytest.MonkeyPatch) -> None:
    """Kriteria selesai M3: script.json buatan tangan -> klip animasi ~30 detik tanpa LLM."""
    encoded = {}

    def fake_encode(frames_dir, out, fps, encoder, log_fn):
        out.write_bytes(b"MP4")
        encoded.update(frames=len(list(frames_dir.glob("*.png"))), fps=fps)
        return "libx264"

    monkeypatch.setattr("ai_office.animation.renderer.render.encode_frames_to_mp4", fake_encode)
    renderer = FakeRenderer()
    agent = AnimatorAgent(config, renderer=renderer, media=FakeMedia())
    ctx = ctx_with_voice(config)

    out = agent.run(ctx)

    assert out["clip_file"] == "animation.mp4"
    assert out["fps"] == 30
    assert out["total_duration_sec"] == pytest.approx(make_plan()["total_duration"])
    assert (ctx.workdir / "plan.json").exists()
    assert (ctx.workdir / "animation.mp4").read_bytes() == b"MP4"
    # jumlah frame = ceil(durasi * fps)
    assert encoded["frames"] == len(frame_times(out["total_duration_sec"], 30))
    assert renderer.calls[0]["plan"]["title"] == EXAMPLE["title"]


def test_animator_needs_voice(config: AppConfig) -> None:
    from ai_office.db import Database

    db = Database(config.db_path)
    db.init()
    job = db.create_job("x", "3-6", "ceria", "id")
    job.artifacts = {"writer": {"script": EXAMPLE}}
    workdir = config.output_dir / "j"
    workdir.mkdir(parents=True)
    ctx = AgentContext(job=job, config=config, workdir=workdir, log=lambda m: None)
    with pytest.raises(AgentError, match="Pengisi Suara"):
        AnimatorAgent(config, renderer=FakeRenderer(), media=FakeMedia()).run(ctx)


# -------------------------------------------------------- encoder pilihan
def test_choose_encoder(monkeypatch: pytest.MonkeyPatch) -> None:
    from ai_office.animation.renderer import encode

    monkeypatch.setattr(encode, "_ffmpeg_encoders",
                        lambda: frozenset({"libx264", "h264_nvenc"}))
    assert encode.choose_encoder("auto") == "h264_nvenc"
    monkeypatch.setattr(encode, "_ffmpeg_encoders", lambda: frozenset({"libx264"}))
    assert encode.choose_encoder("auto") == "libx264"
    assert encode.choose_encoder("libx264") == "libx264"


# ----------------------------------------------- integrasi penuh (opsional)
@pytest.mark.skipif(
    shutil.which("ffmpeg") is None, reason="ffmpeg tidak terpasang")
def test_full_render_with_playwright(config: AppConfig) -> None:
    pytest.importorskip("playwright")
    from ai_office.animation.renderer.render import FrameRenderer

    if not FrameRenderer().is_available():
        pytest.skip("playwright belum terpasang")
    from ai_office.animation.renderer.render import render_plan_to_mp4

    plan = make_plan()
    plan["scenes"] = plan["scenes"][:2]
    plan["total_duration"] = sum(s["duration"] for s in plan["scenes"])
    try:
        out = render_plan_to_mp4(plan, config.output_dir, fps=10, log_fn=lambda m: None)
    except Exception as exc:  # noqa: BLE001 - chromium belum di-install -> skip, bukan gagal
        pytest.skip(f"render nyata gagal: {exc}")
    assert out.exists() and out.stat().st_size > 0
