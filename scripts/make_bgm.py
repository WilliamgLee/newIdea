"""Buat 3 musik latar (BGM) orisinal untuk video anak, langsung disintesis dengan numpy.

Semua lagu dikomposisi di sini (melodi, akor, bas, perkusi), jadi 100% bebas hak cipta.
Hasil disimpan ke folder bgm di config (default data/bgm) sebagai .m4a (butuh ffmpeg; tanpa
ffmpeg disimpan .wav). Tiap lagu bisa diulang mulus (loop), karena editor memutarnya berulang.

Jalankan:
    python scripts/make_bgm.py
    python scripts/make_bgm.py --out data/bgm --force
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SR = 44100
REVERB_TAPS = ((0.11, 0.22), (0.23, 0.12), (0.37, 0.06))  # (detik, gain)


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n: int, attack: float, decay: float) -> np.ndarray:
    """Amplop: naik cepat lalu meluruh eksponensial."""
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-t / decay)


# ------------------------------------------------------------------ instrumen
def additive(freq: float, dur: float, partials: list[tuple[float, float, float]],
             attack: float = 0.005) -> np.ndarray:
    """partials: (kelipatan frekuensi, amplitudo, waktu luruh)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for mult, amp, decay in partials:
        out += amp * np.sin(2 * np.pi * freq * mult * t) * env(n, attack, decay)
    return out


def ukulele(f: float, dur: float) -> np.ndarray:
    return additive(f, dur, [(1, 1, 0.5), (2, 0.55, 0.3), (3, 0.3, 0.2), (4, 0.18, 0.12),
                             (5, 0.08, 0.08)], attack=0.003)


def glock(f: float, dur: float) -> np.ndarray:
    return additive(f, dur, [(1, 1, 0.7), (2.76, 0.35, 0.25), (5.4, 0.12, 0.08)], attack=0.002)


def marimba(f: float, dur: float) -> np.ndarray:
    return additive(f, dur, [(1, 1, 0.35), (4, 0.3, 0.06), (10, 0.05, 0.02)], attack=0.002)


def music_box(f: float, dur: float) -> np.ndarray:
    return additive(f, dur, [(1, 1, 1.2), (2, 0.3, 0.6), (3.01, 0.15, 0.3), (5.2, 0.05, 0.1)],
                    attack=0.002)


def whistle(f: float, dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.5 * t) * np.clip(t / 0.25, 0, 1)
    phase = 2 * np.cumsum(np.pi * f * vib / SR)
    wave_ = np.sin(phase) + 0.12 * np.sin(2 * phase)
    a = np.clip(t / 0.03, 0, 1) * np.clip((dur - t) / 0.06, 0, 1)
    return wave_ * a


def bass(f: float, dur: float) -> np.ndarray:
    # segitiga lembut (harmonik ganjil)
    return additive(f, dur, [(1, 1, 0.6), (3, 0.11, 0.35), (5, 0.04, 0.2)], attack=0.01)


def pad(freqs: list[float], dur: float) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.6, 0.6):
            out += np.sin(2 * np.pi * (f + det) * t) + 0.2 * np.sin(4 * np.pi * (f + det) * t)
    a = np.clip(t / 0.6, 0, 1) * np.clip((dur - t) / 0.6, 0, 1)
    return out * a / (2 * len(freqs))


def kick(dur: float = 0.18) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t / 0.04)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)


def noise_hit(dur: float, decay: float, rng: np.random.Generator, bright: bool = True) -> np.ndarray:
    n = int(dur * SR)
    x = rng.uniform(-1, 1, n)
    if bright:
        x = np.diff(x, prepend=0.0)  # high-pass kasar
    return x * np.exp(-np.arange(n) / SR / decay)


# ------------------------------------------------------------------ aransemen
@dataclass
class Track:
    name: str
    bpm: float
    beats: int  # panjang loop (ketukan)

    def __post_init__(self) -> None:
        self.spb = 60.0 / self.bpm
        self.length = int(self.beats * self.spb * SR)
        self.tail = int(2.0 * SR)
        self.buf = np.zeros(self.length + self.tail)

    def add(self, beat: float, sound: np.ndarray, gain: float) -> None:
        i = int(beat * self.spb * SR)
        end = min(len(self.buf), i + len(sound))
        if i < len(self.buf):
            self.buf[i:end] += gain * sound[: end - i]

    def render(self) -> np.ndarray:
        dry = self.buf.copy()
        for sec, g in REVERB_TAPS:
            k = int(sec * SR)
            self.buf[k:] += g * dry[:-k]
        out = self.buf[: self.length].copy()
        out[: self.tail] += self.buf[self.length:]  # ekor ke awal = loop mulus
        out -= out.mean()
        return out / (np.abs(out).max() + 1e-9) * 0.7


def notes(seq: str) -> list[tuple[float, float, int]]:
    """'76:1 79:1 81:2' -> [(beat, lama, midi)], 'r:1' = jeda."""
    out, beat = [], 0.0
    for tok in seq.split():
        pitch, length = tok.split(":")
        if pitch != "r":
            out.append((beat, float(length), int(pitch)))
        beat += float(length)
    return out


CHORDS = {
    "C": [60, 64, 67], "G": [55, 59, 62], "Am": [57, 60, 64], "F": [53, 57, 60],
    "Dm": [50, 53, 57], "Bb": [58, 62, 65], "Em": [52, 55, 59], "D": [50, 54, 57],
}


def sunny_steps(rng: np.random.Generator) -> Track:
    """Ceria & memantul: ukulele, glockenspiel, bas, shaker. C mayor, 112 bpm."""
    tr = Track("sunny_steps", 112, 64)
    prog = ["C", "G", "Am", "F"] * 4
    melody = notes("76:1 79:1 79:1 76:1 74:1 74:1 71:1 74:1 72:1 76:1 81:1 79:1 81:2 79:1 77:1 "
                   "76:1 79:1 84:1 79:1 83:1 81:1 79:1 74:1 72:1 76:1 81:1 76:1 77:1 76:1 74:2")
    for bar, ch in enumerate(prog):
        b0 = bar * 4
        tones = [midi_hz(m) for m in CHORDS[ch]]
        for off, g in ((0, 0.5), (1, 0.32), (1.5, 0.38), (2.5, 0.36), (3, 0.3)):
            for k, f in enumerate(tones):  # strum: senar berbunyi sedikit berurutan
                tr.add(b0 + off + k * 0.03, ukulele(f, 0.9), g * 0.33)
        root = midi_hz(CHORDS[ch][0] - 24)
        tr.add(b0, bass(root, 0.9), 0.55)
        tr.add(b0 + 2, bass(root * 1.5, 0.9), 0.45)
        for k in range(8):
            tr.add(b0 + k * 0.5, noise_hit(0.06, 0.02, rng), 0.05 if k % 2 else 0.035)
        tr.add(b0, kick(), 0.35)
        tr.add(b0 + 2, kick(), 0.3)
    for rep in range(2):
        for beat, length, m in melody:
            start = rep * 32 + beat
            tr.add(start, glock(midi_hz(m), length * tr.spb + 0.6), 0.4)
            if rep == 1:  # putaran kedua: oktaf atas tipis
                tr.add(start, glock(midi_hz(m + 12), length * tr.spb + 0.4), 0.1)
    return tr


def bubble_garden(rng: np.random.Generator) -> Track:
    """Jenaka: marimba arpeggio, siulan, tepuk tangan. F mayor, 100 bpm."""
    tr = Track("bubble_garden", 100, 64)
    prog = ["F", "Dm", "Bb", "C"] * 4
    melody = notes("81:1 84:1 81:2 77:1 81:1 86:2 86:1 84:1 82:1 81:1 79:2 76:1 79:1 "
                   "81:1 84:1 89:2 88:1 86:1 84:1 81:1 82:1 81:1 79:1 77:1 79:3 r:1")
    for bar, ch in enumerate(prog):
        b0 = bar * 4
        tones = CHORDS[ch] + [CHORDS[ch][0] + 12]
        order = [0, 1, 2, 3, 2, 1, 2, 3]
        for k, idx in enumerate(order):
            tr.add(b0 + k * 0.5, marimba(midi_hz(tones[idx] + 12), 0.5), 0.3 if k % 2 else 0.38)
        root = midi_hz(CHORDS[ch][0] - 12)
        tr.add(b0, bass(root, 1.6), 0.5)
        tr.add(b0 + 2, bass(root, 1.6), 0.42)
        for beat in (1, 3):
            tr.add(b0 + beat, noise_hit(0.12, 0.035, rng), 0.12)
        for k in range(4):  # ketukan kayu kecil di sela ketukan
            tr.add(b0 + k + 0.5, marimba(midi_hz(96), 0.08), 0.06)
    for rep in range(2):
        for beat, length, m in melody:
            tr.add(rep * 32 + beat, whistle(midi_hz(m), length * tr.spb * 0.92), 0.26)
    return tr


def little_stars(rng: np.random.Generator) -> Track:
    """Tenang & lembut: kotak musik, pad, birama 3/4. G mayor, 80 bpm."""
    tr = Track("little_stars", 80, 48)
    prog = ["G", "C", "D", "G", "Em", "C", "D", "G"] * 2
    melody = notes("83:1 86:1 83:1 84:1 88:1 84:1 81:1 78:1 81:1 79:3 "
                   "79:1 83:1 88:1 88:1 86:1 84:1 83:1 81:1 78:1 79:3")
    for bar, ch in enumerate(prog):
        b0 = bar * 3
        tones = [midi_hz(m) for m in CHORDS[ch]]
        tr.add(b0, pad(tones, 3 * tr.spb + 0.6), 0.22)
        low = CHORDS[ch][0]
        for k, m in enumerate((low, low + 7, low + 12)):
            tr.add(b0 + k, music_box(midi_hz(m + 12), 1.4), 0.16)
        tr.add(b0, bass(midi_hz(low - 12), 2.2), 0.35)
    for rep in range(2):
        for beat, length, m in melody:
            tr.add(rep * 24 + beat, music_box(midi_hz(m), length * tr.spb + 1.2), 0.42)
    del rng  # tanpa perkusi
    return tr


TRACKS = (sunny_steps, bubble_garden, little_stars)


# ------------------------------------------------------------------ simpan
def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Buat 3 musik latar orisinal untuk Kiki Classroom")
    parser.add_argument("--out", default=None, help="folder tujuan (default: music.bgm_dir di config)")
    parser.add_argument("--config", default=None, help="path config.yaml")
    parser.add_argument("--force", action="store_true", help="timpa file yang sudah ada")
    args = parser.parse_args(argv)

    if args.out:
        out_dir = Path(args.out)
    else:
        from ai_office.config import load_config

        cfg = load_config(args.config)
        out_dir = cfg.resolve(cfg.music.bgm_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    rng = np.random.default_rng(7)  # deterministik: hasil selalu sama

    for make in TRACKS:
        track = make(rng)
        target = out_dir / f"{track.name}.{'m4a' if ffmpeg else 'wav'}"
        if target.exists() and not args.force:
            print(f"Lewati {target.name} (sudah ada, pakai --force untuk menimpa)")
            continue
        audio = track.render()
        wav = out_dir / f"{track.name}.wav"
        write_wav(wav, audio)
        if ffmpeg:
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(wav), "-c:a", "aac",
                            "-b:a", "160k", str(target)], check=True)
            wav.unlink()
        print(f"Dibuat: {target}  ({len(audio) / SR:.1f} detik, bisa diulang mulus)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
