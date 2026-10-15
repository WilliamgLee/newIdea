"""Pemeriksaan fakta tanpa LLM berbasis kamus (facts.yaml).

Model lokal kecil sering keliru soal fakta sederhana (warna buah, bunyi hewan, jumlah sisi
bentuk, hitungan). Pemeriksaan di sini pasti dan murah; hasilnya ditandai pada kriteria fakta
rubrik sehingga Penulis Naskah diminta merevisi.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..schemas import Script

FACTS_PATH = Path(__file__).with_name("facts.yaml")
_TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_SENTENCE = re.compile(r"[^.!?]+")
_DIGITS = re.compile(r"\d+")


def _squash(word: str) -> str:
    """Huruf berulang dianggap sama: "mooo" -> "mo", "woof" -> "wof"."""
    return re.sub(r"(.)\1+", r"\1", word)


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


@dataclass(frozen=True)
class Facts:
    object_colors: dict[str, frozenset[str]]
    color_words: dict[str, str]              # kata/frasa -> warna katalog
    animal_names: dict[str, str]             # kata -> objek hewan
    animal_sounds: dict[str, frozenset[str]]  # hewan -> bunyi (sudah di-squash)
    sound_owner: dict[str, frozenset[str]]   # bunyi (squash) -> hewan pemiliknya
    shapes: dict[str, dict[str, int]]        # bentuk -> {sides/corners/points: n}
    shape_names: dict[str, str]              # kata -> bentuk
    shape_parts: dict[str, str]              # kata -> sides/corners/points
    numbers: dict[str, int]

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Facts:
        color_words = {w.lower(): color for color, words in data["color_words"].items()
                       for w in words}
        animal_sounds = {animal: frozenset(_squash(s.lower()) for s in sounds or [])
                         for animal, sounds in data["animal_sounds"].items()}
        owners: dict[str, set[str]] = {}
        for animal, sounds in animal_sounds.items():
            for s in sounds:
                owners.setdefault(s, set()).add(animal)
        shapes: dict[str, dict[str, int]] = {}
        shape_names: dict[str, str] = {}
        for shape, spec in data["shapes"].items():
            shapes[shape] = {k: int(v) for k, v in spec.items() if k != "names"}
            for name in spec.get("names", []):
                shape_names[name.lower()] = shape
        return cls(
            object_colors={o: frozenset(c) for o, c in data["object_colors"].items()},
            color_words=color_words,
            animal_names={w.lower(): a for a, words in data["animal_names"].items() for w in words},
            animal_sounds=animal_sounds,
            sound_owner={s: frozenset(a) for s, a in owners.items()},
            shapes=shapes,
            shape_names=shape_names,
            shape_parts={w.lower(): part for part, words in data["shape_parts"].items()
                         for w in words},
            numbers={w.lower(): int(n) for n, words in data["number_words"].items() for w in words},
        )

    # ---------------------------------------------------------------- bantu
    def number_of(self, token: str) -> int | None:
        if token.isdigit():
            return int(token)
        return self.numbers.get(token)

    def numbers_in(self, text: str) -> list[int]:
        out = []
        for tok in _tokens(text):
            n = self.number_of(tok)
            if n is not None and n > 0:
                out.append(n)
        return out

    def colors_in(self, text: str) -> set[str]:
        """Warna katalog yang disebut di teks (frasa panjang dicocokkan lebih dulu)."""
        low = " " + " ".join(_tokens(text)) + " "
        found: set[str] = set()
        for phrase in sorted(self.color_words, key=len, reverse=True):
            key = f" {phrase} "
            if key in low:
                found.add(self.color_words[phrase])
                low = low.replace(key, " ")
        return found

    def animals_in(self, text: str) -> set[str]:
        return {self.animal_names[t] for t in _tokens(text) if t in self.animal_names}


@lru_cache(maxsize=4)
def load_facts(path: str | Path = FACTS_PATH) -> Facts:
    import yaml

    with Path(path).open("r", encoding="utf-8") as fh:
        return Facts.from_dict(yaml.safe_load(fh))


# ------------------------------------------------------------------ pemeriksaan
def fact_issues(script: Script, facts: Facts | None = None) -> list[str]:
    """Daftar masalah fakta (kosong = aman). Setiap pesan menyebut scene-nya."""
    facts = facts or load_facts()
    issues: list[str] = []
    for scene in script.scenes:
        where = f"scene {scene.id}"
        p = scene.params
        narration = scene.narration
        issues += _color_issues(facts, where, scene.template, p.items, p.color, narration)
        issues += _sound_issues(facts, where, narration, p.items)
        issues += _shape_issues(facts, where, narration)
        if scene.template == "count_objects" and p.count is not None:
            issues += _count_issues(facts, where, p.count, narration, scene.on_screen_text)
    return issues


def _color_issues(facts: Facts, where: str, template: str, items: list[str],
                  color: str | None, narration: str) -> list[str]:
    if not color or not items or template == "color_change":
        return []  # color_change sengaja berganti-ganti warna
    out = []
    obj = items[0]
    allowed = facts.object_colors.get(obj)
    if allowed is not None and color not in allowed:
        out.append(f"{where}: warna '{color}' tidak wajar untuk {obj} "
                   f"(yang wajar: {', '.join(sorted(allowed))})")
    said = facts.colors_in(narration)
    if said and color not in said:
        out.append(f"{where}: narasi menyebut warna {', '.join(sorted(said))} tetapi warna "
                   f"objek di layar '{color}'")
    return out


def _sound_issues(facts: Facts, where: str, narration: str, items: list[str]) -> list[str]:
    out = []
    for sentence in _SENTENCE.findall(narration):
        animals = facts.animals_in(sentence)
        if not animals:
            continue
        sounds = [t for t in _tokens(sentence) if _squash(t) in facts.sound_owner]
        for snd in sounds:
            owners = facts.sound_owner[_squash(snd)]
            if not owners & animals:
                who = ", ".join(sorted(animals))
                real = ", ".join(sorted(owners))
                out.append(f"{where}: bunyi '{snd}' adalah bunyi {real}, bukan {who}")
        silent = [a for a in animals if not facts.animal_sounds.get(a)]
        if silent and sounds and animals == set(silent):
            out.append(f"{where}: {', '.join(silent)} tidak bersuara, jangan beri bunyi")
    return out


def _shape_issues(facts: Facts, where: str, narration: str) -> list[str]:
    out = []
    for sentence in _SENTENCE.findall(narration):
        toks = _tokens(sentence)
        shapes = [facts.shape_names[t] for t in toks if t in facts.shape_names]
        if not shapes:
            continue
        shape = shapes[0]
        for i, tok in enumerate(toks):
            part = facts.shape_parts.get(tok)
            if part is None or part not in facts.shapes[shape]:
                continue
            # angka terdekat sebelum kata bagian (boleh diselingi 2 kata, mis. "three straight sides")
            said = None
            for j in range(i - 1, max(-1, i - 4), -1):
                said = facts.number_of(toks[j])
                if said is not None:
                    break
            want = facts.shapes[shape][part]
            if said is not None and said != want:
                out.append(f"{where}: {shape} punya {want} {tok}, bukan {said}")
    return out


def _count_issues(facts: Facts, where: str, count: int, narration: str,
                  on_screen: str) -> list[str]:
    out = []
    said = facts.numbers_in(narration)
    if not said:
        out.append(f"{where}: sebutkan hitungannya di narasi (jumlah objek {count})")
    elif max(said) != count:
        out.append(f"{where}: narasi menghitung sampai {max(said)} tetapi jumlah objek {count}")
    shown = [int(d) for d in _DIGITS.findall(on_screen or "")]
    if shown and shown[0] != count:
        out.append(f"{where}: teks layar '{on_screen}' tidak sama dengan jumlah objek {count}")
    return out
