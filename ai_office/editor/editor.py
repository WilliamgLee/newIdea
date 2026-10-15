"""Editor: klip animasi + suara + subtitle + musik -> video.mp4 final, thumbnail, metadata.

Rangkaian ffmpeg:
1. Audio narasi tiap scene ditempatkan pada waktunya -> narration.wav (lewat MediaTools).
2. Musik latar (opsional) di-loop, di-fade, dan volumenya diturunkan saat ada narasi (ducking
   via sidechaincompress), lalu dicampur dengan narasi.
3. Video (klip animasi) + audio campuran + subtitle (filter ass) -> encode H.264.
4. Thumbnail dari frame terbaik + metadata.txt.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..agents.base import Agent, AgentContext, AgentError
from ..animation.renderer.encode import choose_encoder
from ..config import AppConfig
from ..media import MediaError, MediaTools
from ..models import AgentName
from ..schemas import Script, VoiceResult
from .metadata import build_metadata, metadata_txt
from .music import pick_bgm
from .subtitles import build_ass

ENCODE_ARGS = {
    "h264_nvenc": ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "23",
                   "-pix_fmt", "yuv420p"],
    "libx264": ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"],
}


def _ass_path_for_filter(path: Path) -> str:
    """Escape path untuk filter ass di ffmpeg (Windows butuh escaping khusus)."""
    s = str(path.resolve())
    s = s.replace("\\", "\\\\").replace(":", "\\:")
    return s


class EditorAgent(Agent):
    name = AgentName.EDITOR

    def __init__(self, config: AppConfig, media: MediaTools | None = None) -> None:
        self.config = config
        self.media = media or MediaTools()

    def is_available(self) -> bool:
        return self.media.is_available()

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        raw = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        voice_raw = ctx.artifacts.get(AgentName.VOICE.value)
        anim = ctx.artifacts.get(AgentName.ANIMATOR.value)
        if not raw or not voice_raw or not anim:
            raise AgentError("Editor butuh naskah, suara, dan klip animasi")
        script = Script.model_validate(raw)
        voice = VoiceResult.model_validate(voice_raw)
        clip = ctx.workdir / anim["clip_file"]
        if not clip.exists():
            raise AgentError(f"Klip animasi tidak ditemukan: {clip.name}")

        result = self.assemble(script, voice, clip, ctx.workdir, ctx.job.id, ctx.log)
        return result

    # ---------------------------------------------------- dapat dipakai CLI
    def assemble(self, script: Script, voice: VoiceResult, clip: Path, workdir: Path,
                 job_id: int, log: Any = print) -> dict[str, Any]:
        v = self.config.video
        total = self.media.probe_duration(clip)

        # 1) audio narasi pada posisi waktu tiap scene
        scene_starts: dict[int, float] = {}
        segments = []
        t = 0.0
        for sa in voice.scenes:
            scene_starts[sa.scene_id] = t
            audio = workdir / sa.audio_file
            if audio.exists():
                segments.append((audio, t))
            t += sa.duration_sec
        narration = workdir / "narration.wav"
        if segments:
            self.media.build_timeline_audio(segments, total, narration,
                                            self.config.voice.sample_rate)
            log(f"Audio narasi disusun: {len(segments)} scene, {total:.1f} detik")
        else:
            narration = None
            log("Tidak ada audio narasi")

        # 2) subtitle
        sub_path = None
        if self.config.subtitle.enabled:
            ass = build_ass(voice, scene_starts, self.config.subtitle, v)
            sub_path = workdir / "subtitle.ass"
            sub_path.write_text(ass, encoding="utf-8")
            log("Subtitle dibuat (highlight per kata)")

        # 3) musik latar
        bgm = None
        if self.config.music.enabled:
            bgm = pick_bgm(self.config.resolve(self.config.music.bgm_dir), script.title)
            log(f"Musik latar: {bgm.name}" if bgm else
                "Musik latar: (folder data/bgm kosong, dilewati)")

        out = workdir / "video.mp4"
        encoder = self._encode(clip, narration, bgm, sub_path, total, out, log)

        # 4) thumbnail + metadata
        thumb = workdir / "thumbnail.png"
        self.media.extract_thumbnail(clip, thumb, at_sec=min(1.0, total / 2))
        meta = build_metadata(job_id, script, total, v.width, v.height, encoder)
        (workdir / "metadata.txt").write_text(metadata_txt(meta, encoder), encoding="utf-8")
        (workdir / "metadata.json").write_text(
            json.dumps(meta.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8")

        log(f"Video final: {out.name} ({total:.1f} detik, encoder {encoder})")
        return {
            "video_file": out.name,
            "thumbnail_file": thumb.name,
            "metadata_file": "metadata.txt",
            "duration_sec": round(total, 2),
            "encoder": encoder,
            "has_audio": narration is not None,
            "has_music": bgm is not None,
            "has_subtitle": sub_path is not None,
            "bgm": bgm.name if bgm else None,
        }

    # ------------------------------------------------------------ ffmpeg
    def _encode(self, clip: Path, narration: Path | None, bgm: Path | None,
                sub: Path | None, total: float, out: Path, log: Any) -> str:
        m = self.config.music
        inputs = ["-i", str(clip)]
        audio_label = None
        filters: list[str] = []

        if narration is not None:
            inputs += ["-i", str(narration)]
            nar_idx = 1
            if bgm is not None:
                inputs += ["-stream_loop", "-1", "-i", str(bgm)]
                bgm_idx = 2
                fade_out = max(0.0, total - m.fade_sec)
                # musik: potong sepanjang video, fade in/out, volume dasar
                filters.append(
                    f"[{bgm_idx}:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
                    f"afade=t=in:st=0:d={m.fade_sec:g},afade=t=out:st={fade_out:.3f}:d={m.fade_sec:g},"
                    f"volume={m.volume:g}[bg]")
                # ducking: musik ditekan saat narasi ada (sidechain pakai narasi)
                filters.append("[1:a]asplit=2[nar][sc]")
                filters.append(
                    f"[bg][sc]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=400,"
                    f"volume={(m.duck_volume / max(m.volume, 1e-6)):g}[duck]")
                filters.append("[nar][duck]amix=inputs=2:normalize=0:dropout_transition=0[aout]")
                audio_label = "[aout]"
            else:
                audio_label = f"{nar_idx}:a"
        elif bgm is not None:
            inputs += ["-stream_loop", "-1", "-i", str(bgm)]
            fade_out = max(0.0, total - m.fade_sec)
            filters.append(
                f"[1:a]atrim=0:{total:.3f},asetpts=PTS-STARTPTS,"
                f"afade=t=in:st=0:d={m.fade_sec:g},afade=t=out:st={fade_out:.3f}:d={m.fade_sec:g},"
                f"volume={m.volume:g}[aout]")
            audio_label = "[aout]"

        vfilter = ""
        if sub is not None:
            vfilter = f"[0:v]ass='{_ass_path_for_filter(sub)}'[vout]"

        encoder = choose_encoder(self.config.video.encoder)
        cmd = ["-hide_banner", *inputs]
        fc = list(filters)
        if vfilter:
            fc.append(vfilter)
        if fc:
            cmd += ["-filter_complex", ";".join(fc)]
        cmd += ["-map", "[vout]" if vfilter else "0:v"]
        if audio_label:
            cmd += ["-map", audio_label]
        cmd += ["-t", f"{total:.3f}", *ENCODE_ARGS[encoder]]
        if audio_label:
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        cmd += ["-movflags", "+faststart", str(out)]

        try:
            self.media.mux(cmd)
        except MediaError as exc:
            if self.config.video.encoder == "auto" and encoder == "h264_nvenc":
                log(f"NVENC gagal ({exc}); fallback libx264")
                i = cmd.index("-c:v")
                cmd[i:i + len(ENCODE_ARGS["h264_nvenc"])] = ENCODE_ARGS["libx264"]
                self.media.mux(cmd)
                return "libx264"
            raise
        return encoder
