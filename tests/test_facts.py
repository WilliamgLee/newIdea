"""Kamus fakta (agents/facts.yaml): pemeriksaan pasti tanpa LLM."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from ai_office.agents.facts import fact_issues
from ai_office.agents.safety import automated_checks, load_rubric
from ai_office.schemas import Script

ROOT = Path(__file__).resolve().parent.parent
BASE = json.loads((ROOT / "examples" / "colors_en.json").read_text(encoding="utf-8"))


def script_with(scene_no: int, **changes) -> Script:
    """Salin contoh colors_en lalu ubah satu scene (narration/template/params...)."""
    data = copy.deepcopy(BASE)
    scene = data["scenes"][scene_no - 1]
    params = changes.pop("params", None)
    scene.update(changes)
    if params:
        scene["params"].update(params)
    return Script.model_validate(data)


def issues(script: Script) -> str:
    return " | ".join(fact_issues(script))


@pytest.mark.parametrize("name", ["colors_en.json", "mengenal_warna.json", "animal_sounds.json"])
def test_examples_have_no_fact_issues(name: str) -> None:
    data = json.loads((ROOT / "examples" / name).read_text(encoding="utf-8"))
    assert fact_issues(Script.model_validate(data)) == []


def test_unnatural_object_color() -> None:
    s = script_with(2, narration="Look, this is an apple. The apple is blue. Blue!",
                    params={"color": "biru"})
    assert "tidak wajar untuk apel" in issues(s)


def test_narration_color_differs_from_screen() -> None:
    s = script_with(2, narration="Look, this is an apple. The apple is green. Green!")
    assert "narasi menyebut warna hijau" in issues(s)


def test_free_color_objects_are_not_flagged() -> None:
    # balon boleh warna apa saja
    s = script_with(4, narration="Let's count the purple balloons. One, two, three!",
                    params={"color": "ungu"})
    assert issues(s) == ""


def test_wrong_animal_sound() -> None:
    s = script_with(5, narration="The cow says woof woof. Can you guess?")
    assert "bunyi 'woof' adalah bunyi anjing, bukan sapi" in issues(s)


def test_correct_animal_sounds_in_one_sentence() -> None:
    s = script_with(5, narration="The cow says moo and the dog says woof!")
    assert issues(s) == ""


def test_repeated_letters_are_the_same_sound() -> None:
    s = script_with(5, narration="The cow says mooooo! Can you guess?")
    assert issues(s) == ""


def test_fish_is_silent() -> None:
    s = script_with(5, narration="The fish says quack. Guess what!")
    assert "bunyi 'quack' adalah bunyi bebek" in issues(s)


@pytest.mark.parametrize("sentence,ok", [
    ("A triangle has three sides.", True),
    ("A triangle has four sides.", False),
    ("A square has four straight sides.", True),
    ("A circle has no corners.", True),
    ("A star has five points.", True),
    ("A star has six points.", False),
    ("Persegi punya empat sisi.", True),
    ("Segitiga punya lima sudut.", False),
])
def test_shape_facts(sentence: str, ok: bool) -> None:
    s = script_with(3, narration=sentence)
    assert (issues(s) == "") is ok


def test_count_must_match_narration() -> None:
    s = script_with(4, narration="Let's count the blue balloons. One, two!")
    assert "menghitung sampai 2 tetapi jumlah objek 3" in issues(s)


def test_count_must_be_spoken() -> None:
    s = script_with(4, narration="Look at all the blue balloons!")
    assert "sebutkan hitungannya" in issues(s)


def test_on_screen_count_must_match() -> None:
    s = script_with(4, on_screen_text="5 blue")
    assert "teks layar '5 blue'" in issues(s)


def test_safety_flags_facts_on_english_rubric() -> None:
    rubric = load_rubric(ROOT / "safety_rubric_en.yaml")
    s = script_with(5, narration="The cow says woof woof. Can you guess?")
    flags = automated_checks(s, rubric)
    assert any(f.criterion == "facts_correct" and "woof" in f.reason for f in flags)
