"""Membuat subtitle .ass dengan highlight kata yang sedang diucapkan.

Memakai timing per kata dari VoiceResult. Tiap "baris subtitle" adalah satu kalimat
(dipecah bila terlalu panjang). Highlight dibuat dengan menumpuk beberapa event Dialogue:
satu event per kata aktif, yang hanya tampil selama kata itu diucapkan, dengan warna berbeda.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import SubtitleConfig, VideoConfig
from ..schemas import VoiceResult, WordTiming


@dataclass
class _Line:
    start: float
    end: float
    words: list[WordTiming]


def _hex_to_ass(color: str) -> str:
    """RRGGBB -> &HAABBGGRR (ASS pakai BGR + alpha). Alpha 00 = opaque."""
    c = color.lstrip("#")
    if len(c) != 6:
        c = "FFFFFF"
    rr, gg, bb = c[0:2], c[2:4], c[4:6]
    return f"&H00{bb}{gg}{rr}".upper()


def _wrap_words(words: list[WordTiming], max_chars: int) -> list[list[WordTiming]]:
    lines: list[list[WordTiming]] = []
    cur: list[WordTiming] = []
    length = 0
    for w in words:
        add = len(w.text) + (1 if cur else 0)
        if cur and length + add > max_chars:
            lines.append(cur)
            cur, length = [], 0
            add = len(w.text)
        cur.append(w)
        length += add
    if cur:
        lines.append(cur)
    return lines[:2]  # maksimal 2 baris per kalimat


def _ass_time(t: float) -> str:
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def _esc(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ")


def build_ass(voice: VoiceResult, scene_starts: dict[int, float], sub: SubtitleConfig,
              video: VideoConfig) -> str:
    """Kembalikan isi file .ass. `scene_starts` = waktu global awal tiap scene."""
    primary = _hex_to_ass(sub.text_color)
    outline = _hex_to_ass(sub.outline_color)
    highlight = _hex_to_ass(sub.highlight_color)
    margin_v = sub.y_offset

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video.width}
PlayResY: {video.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Base,{sub.font},{sub.font_size},{primary},{outline},&H64000000,-1,0,0,0,100,100,0,0,1,6,3,2,80,80,{margin_v},1
Style: Hi,{sub.font},{sub.font_size},{highlight},{outline},&H64000000,-1,0,0,0,106,106,0,0,1,6,3,2,80,80,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events: list[str] = []
    for sa in voice.scenes:
        base = scene_starts.get(sa.scene_id, 0.0)
        for sentence in sa.sentences:
            for line in _wrap_words(sentence.words, sub.max_chars_per_line):
                if not line:
                    continue
                g_start = base + line[0].start
                g_end = base + max(w.end for w in line)
                full = " ".join(_esc(w.text) for w in line)
                # lapisan dasar: seluruh baris, warna normal
                events.append(f"Dialogue: 0,{_ass_time(g_start)},{_ass_time(g_end)},Base,,0,0,0,,{full}")
                # lapisan highlight: tiap kata, hanya saat diucapkan
                for i, w in enumerate(line):
                    ws = base + w.start
                    we = base + max(w.end, w.start + 0.08)
                    before = " ".join(_esc(x.text) for x in line[:i])
                    after = " ".join(_esc(x.text) for x in line[i + 1:])
                    parts = []
                    if before:
                        parts.append("{\\alpha&HFF&}" + before + " {\\alpha&H00&}")
                    parts.append(_esc(w.text))
                    if after:
                        parts.append(" {\\alpha&HFF&}" + after)
                    text = "".join(parts)
                    events.append(
                        f"Dialogue: 1,{_ass_time(ws)},{_ass_time(we)},Hi,,0,0,0,,{text}")
    return header + "\n".join(events) + "\n"
