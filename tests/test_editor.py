"""Test M4: Editor. ffmpeg di-mock (perintah ditangkap & diperiksa); subtitle & metadata
diverifikasi langsung. Ada 1 test integrasi ffmpeg sungguhan (skip bila tidak terpasang)."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from ai_office.agents.base import AgentContext, AgentError
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.editor.editor import EditorAgent
from ai_office.editor.metadata import build_metadata, metadata_txt
from ai_office.editor.music import pick_bgm
from ai_office.editor.subtitles import build_ass
from ai_office.schemas import Script, VoiceResult

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = json.loads((ROOT / "examples" / "mengenal_warna.json").read_text(encoding="utf-8"))


def make_voice(script_dict=EXAMPLE) -> VoiceResult:
    script = Script.model_validate(script_dict)
    scenes = []
    for s in script.scenes:
        words = s.narration.split()
        wt = [{"text": w, "start": round(i * 0.3, 3), "end": round(i * 0.3 + 0.25, 3)}
              for i, w in enumerate(words)]
        scenes.append({
            "scene_id": s.id, "audio_file": f"audio/scene_{s.id}.wav",
            "audio_duration_sec": s.duration_sec, "duration_sec": s.duration_sec,
            "timing_source": "word", "word_coverage": 1.0,
            "sentences": [{"text": s.narration, "start": 0.0,
                           "end": max(w["end"] for w in wt), "words": wt}],
        })
    return VoiceResult(engine="fake", voice="v", rate="+0%", scenes=scenes,
                       total_duration_sec=sum(s["duration_sec"] for s in scenes))


# ------------------------------------------------------------ subtitle
def test_build_ass_has_word_highlight() -> None:
    from ai_office.config import SubtitleConfig, VideoConfig

    voice = make_voice()
    starts = {}
    t = 0.0
    for sa in voice.scenes:
        starts[sa.scene_id] = t
        t += sa.duration_sec
    ass = build_ass(voice, starts, SubtitleConfig(), VideoConfig())
    assert "[V4+ Styles]" in ass and "Style: Base" in ass and "Style: Hi" in ass
    assert ass.count("Dialogue:") > 10
    # lapisan highlight (Hi) ada untuk tiap kata
    assert "Hi,," in ass
    # warna highlight dari config muncul (kuning FFD43B -> BGR 3BD4FF)
    assert "&H003BD4FF" in ass.upper()
    # tidak ada kurung kurawal mentah dari teks (hanya override tag kita)
    assert "\\alpha" in ass


def test_ass_times_are_global() -> None:
    from ai_office.config import SubtitleConfig, VideoConfig

    voice = make_voice()
    starts = {s.scene_id: i * 100.0 for i, s in enumerate(voice.scenes)}  # offset besar
    ass = build_ass(voice, starts, SubtitleConfig(), VideoConfig())
    assert "0:01:40" in ass  # scene ke-2 mulai di 100 detik


# ------------------------------------------------------------ metadata
def test_metadata_and_txt() -> None:
    script = Script.model_validate(EXAMPLE)
    meta = build_metadata(7, script, 30.0, 1080, 1920, "libx264")
    assert meta.made_for_kids is True and meta.job_id == 7
    assert meta.hashtags[0] == "#Shorts"
    txt = metadata_txt(meta, "libx264")
    assert "Made for kids" in txt and script.title in txt and "#Shorts" in txt


# ------------------------------------------------------------ music
def test_pick_bgm_deterministic(tmp_path: Path) -> None:
    assert pick_bgm(tmp_path, "judul") is None  # kosong
    for n in ("a.mp3", "b.wav", "c.ogg"):
        (tmp_path / n).write_bytes(b"x")
    (tmp_path / "notes.txt").write_text("x")  # bukan audio -> diabaikan
    first = pick_bgm(tmp_path, "Ayo Kenal Warna!")
    assert first is not None and first.suffix in (".mp3", ".wav", ".ogg")
    assert first == pick_bgm(tmp_path, "Ayo Kenal Warna!")  # deterministik


# -------------------------------------------------- editor (ffmpeg mock)
class FakeMedia:
    def __init__(self, duration: float = 30.0) -> None:
        self.duration = duration
        self.mux_cmds: list[list[str]] = []
        self.timeline = None
        self.thumb = None

    def is_available(self) -> bool:
        return True

    def probe_duration(self, path: Path) -> float:
        return self.duration

    def build_timeline_audio(self, segments, total, dst, sample_rate) -> None:
        self.timeline = {"n": len(segments), "total": total, "sr": sample_rate}
        dst.write_bytes(b"WAV")

    def extract_thumbnail(self, video, dst, at_sec) -> None:
        self.thumb = at_sec
        dst.write_bytes(b"PNG")

    def mux(self, cmd) -> None:
        self.mux_cmds.append(cmd)
        # argumen terakhir = output
        Path(cmd[-1]).write_bytes(b"MP4")


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    cfg = AppConfig.from_dict({"paths": {"data_dir": str(tmp_path / "d"),
                                         "output_dir": str(tmp_path / "o")},
                               "music": {"bgm_dir": str(tmp_path / "bgm")}}, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


def prepared_workdir(config: AppConfig) -> Path:
    wd = config.output_dir / "job_1"
    (wd / "audio").mkdir(parents=True)
    for s in make_voice().scenes:
        (wd / s.audio_file).write_bytes(b"WAV")
    (wd / "animation.mp4").write_bytes(b"CLIP")
    return wd


def run_editor(config: AppConfig, media: FakeMedia, workdir: Path):
    db = Database(config.db_path)
    db.init()
    job = db.create_job("mengenal warna", "3-6", "ceria", "id")
    job.artifacts = {
        "writer": {"script": EXAMPLE},
        "voice": make_voice().model_dump(mode="json"),
        "animator": {"clip_file": "animation.mp4"},
    }
    ctx = AgentContext(job=job, config=config, workdir=workdir, log=lambda m: None)
    return EditorAgent(config, media=media).run(ctx)


def test_editor_produces_video_thumb_metadata(config: AppConfig,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    """Kriteria selesai M4: MP4 vertikal 30 detik + subtitle; thumbnail & metadata.txt."""
    monkeypatch.setattr("ai_office.editor.editor.choose_encoder", lambda e: "libx264")
    media = FakeMedia(duration=30.0)
    wd = prepared_workdir(config)
    out = run_editor(config, media, wd)

    assert out["video_file"] == "video.mp4" and out["duration_sec"] == 30.0
    assert out["has_audio"] and out["has_subtitle"]
    assert (wd / "video.mp4").read_bytes() == b"MP4"
    assert (wd / "thumbnail.png").exists()
    assert (wd / "subtitle.ass").exists()
    meta_txt = (wd / "metadata.txt").read_text(encoding="utf-8")
    assert "Made for kids" in meta_txt
    assert json.loads((wd / "metadata.json").read_text(encoding="utf-8"))["made_for_kids"] is True
    # audio narasi disusun untuk 6 scene
    assert media.timeline["n"] == 6
    # perintah ffmpeg memakai subtitle (filter ass) dan output video.mp4
    cmd = " ".join(media.mux_cmds[0])
    assert "ass=" in cmd and "libx264" in cmd and cmd.endswith("video.mp4")


def test_editor_mixes_music_with_ducking(config: AppConfig,
                                         monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ai_office.editor.editor.choose_encoder", lambda e: "libx264")
    bgm_dir = config.resolve(config.music.bgm_dir)
    bgm_dir.mkdir(parents=True, exist_ok=True)
    (bgm_dir / "lagu.mp3").write_bytes(b"MP3")
    media = FakeMedia()
    out = run_editor(config, media, prepared_workdir(config))
    assert out["has_music"] and out["bgm"] == "lagu.mp3"
    cmd = " ".join(media.mux_cmds[0])
    assert "sidechaincompress" in cmd and "amix" in cmd and "-stream_loop" in cmd


def test_editor_without_music_when_empty(config: AppConfig,
                                        monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("ai_office.editor.editor.choose_encoder", lambda e: "libx264")
    media = FakeMedia()
    out = run_editor(config, media, prepared_workdir(config))
    assert out["has_music"] is False
    assert "sidechaincompress" not in " ".join(media.mux_cmds[0])


def test_editor_nvenc_fallback(config: AppConfig, monkeypatch: pytest.MonkeyPatch) -> None:
    from ai_office.media import MediaError

    monkeypatch.setattr("ai_office.editor.editor.choose_encoder", lambda e: "h264_nvenc")
    calls = {"n": 0}
    media = FakeMedia()

    def flaky_mux(cmd):
        calls["n"] += 1
        if calls["n"] == 1:
            raise MediaError("NVENC gagal")
        media.mux_cmds.append(cmd)
        Path(cmd[-1]).write_bytes(b"MP4")

    media.mux = flaky_mux  # type: ignore[assignment]
    out = run_editor(config, media, prepared_workdir(config))
    assert out["encoder"] == "libx264" and calls["n"] == 2


def test_editor_requires_clip(config: AppConfig) -> None:
    db = Database(config.db_path)
    db.init()
    job = db.create_job("x", "3-6", "ceria", "id")
    job.artifacts = {"writer": {"script": EXAMPLE}, "voice": make_voice().model_dump(mode="json")}
    wd = config.output_dir / "job_1"
    wd.mkdir(parents=True)
    ctx = AgentContext(job=job, config=config, workdir=wd, log=lambda m: None)
    with pytest.raises(AgentError, match="klip animasi"):
        EditorAgent(config, media=FakeMedia()).run(ctx)


# --------------------------------------------- integrasi ffmpeg sungguhan
@pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
                    reason="ffmpeg/ffprobe tidak terpasang")
def test_real_ffmpeg_assembles_playable_video(config: AppConfig, tmp_path: Path) -> None:
    from ai_office.media import MediaTools

    tools = MediaTools()
    # klip warna 3 detik tanpa audio
    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                    "-i", "color=c=blue:s=216x384:d=3:r=10", "-pix_fmt", "yuv420p", str(clip)],
                   check=True)
    wd = config.output_dir / "job_1"
    (wd / "audio").mkdir(parents=True)
    shutil.copy(clip, wd / "animation.mp4")
    # audio 1 detik per scene (pakai 2 scene pendek)
    for i in (1, 2):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
                        "-i", "sine=frequency=330:duration=1", "-ar", "48000", "-ac", "1",
                        str(wd / f"audio/scene_{i}.wav")], check=True)

    small = json.loads(json.dumps(EXAMPLE))
    small["scenes"] = small["scenes"][:2]
    small["scenes"][0]["duration_sec"] = 1.5
    small["scenes"][1]["duration_sec"] = 1.5
    small["scenes"][1]["template"] = "outro"
    small["scenes"][1]["params"] = {"character": "kiki", "pose": "jump", "emotion": "happy",
                                    "background": "garden", "items": []}
    small["total_duration_sec"] = 3
    script = Script.model_validate(small)
    voice = make_voice(small)

    cfg = config
    cfg.music.enabled = False
    out = EditorAgent(cfg, media=tools).assemble(script, voice, wd / "animation.mp4", wd, 1,
                                                 log=lambda m: None)
    video = wd / out["video_file"]
    assert video.exists() and video.stat().st_size > 0
    assert tools.probe_duration(video) == pytest.approx(3.0, abs=0.5)
    assert (wd / "thumbnail.png").exists()
