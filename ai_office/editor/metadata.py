"""Metadata akhir video + isi metadata.txt."""

from __future__ import annotations

from datetime import UTC, datetime

from ..schemas import Script, VideoMetadata


def build_metadata(job_id: int, script: Script, duration: float, width: int, height: int,
                   encoder: str) -> VideoMetadata:
    desc_lines = [
        script.learning_goal,
        "",
        f"Video edukasi untuk anak usia {script.age_group} tahun.",
        "Dibuat otomatis oleh AI Office.",
        "",
        " ".join(script.hashtags),
    ]
    return VideoMetadata(
        job_id=job_id,
        title=script.title[:100],
        description="\n".join(desc_lines)[:5000],
        hashtags=script.hashtags,
        duration_sec=round(duration, 2),
        width=width,
        height=height,
        age_group=script.age_group,
        language=script.language,
        learning_goal=script.learning_goal,
        made_for_kids=True,
        created_at=datetime.now(UTC),
    )


def metadata_txt(meta: VideoMetadata, encoder: str) -> str:
    return "\n".join([
        f"Judul: {meta.title}",
        "",
        "Deskripsi:",
        meta.description,
        "",
        f"Hashtag: {' '.join(meta.hashtags)}",
        f"Durasi: {meta.duration_sec:g} detik",
        f"Resolusi: {meta.width}x{meta.height}",
        f"Bahasa: {meta.language}  |  Usia: {meta.age_group}",
        f"Encoder: {encoder}",
        "",
        ('PENGINGAT: saat upload ke YouTube, tandai video sebagai '
         '"Dibuat untuk anak-anak / Made for kids".'),
    ]) + "\n"
