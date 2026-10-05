from __future__ import annotations

import copy
import json
from typing import Any

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from pydantic import ValidationError

from ai_office.agents.fake import fake_script
from ai_office.animation.catalog import Catalog, load_catalog
from ai_office.config import VideoConfig
from ai_office.schemas import (
    OutputInvalid,
    VideoMetadata,
    WordTiming,
    parse_safety_review,
    parse_script,
    script_json_schema,
)


@pytest.fixture
def catalog() -> Catalog:
    return load_catalog()


def good() -> dict[str, Any]:
    return copy.deepcopy(fake_script("mengenal warna"))


def errors_of(data: Any, catalog: Catalog, video: VideoConfig | None = None) -> str:
    with pytest.raises(OutputInvalid) as exc:
        parse_script(data, catalog, video)
    return " | ".join(exc.value.errors)


def test_valid_script(catalog: Catalog) -> None:
    script = parse_script(good(), catalog, VideoConfig())
    assert len(script.scenes) == 5
    assert script.total_duration_sec == 30
    assert script.hashtags[0] == "#Shorts"


def test_hashtags_normalized(catalog: Catalog) -> None:
    data = good()
    data["hashtags"] = ["BelajarWarna", "#belajar warna", "#Shorts", "#!!"]
    assert parse_script(data, catalog).hashtags == ["#Shorts", "#BelajarWarna"]


def test_not_a_dict(catalog: Catalog) -> None:
    assert "objek JSON" in errors_of([1, 2], catalog)


def test_too_few_scenes(catalog: Catalog) -> None:
    data = good()
    data["scenes"] = data["scenes"][:3]
    data["total_duration_sec"] = 18
    assert "scenes" in errors_of(data, catalog)


def test_unknown_template(catalog: Catalog) -> None:
    data = good()
    data["scenes"][1]["template"] = "dance_party"
    assert "template 'dance_party' tidak ada" in errors_of(data, catalog)


def test_unknown_pose_emotion_background_object(catalog: Catalog) -> None:
    data = good()
    p = data["scenes"][1]["params"]
    p.update(pose="backflip", emotion="angry", background="moon", items=["dinosaurus"])
    msg = errors_of(data, catalog)
    for word in ("pose 'backflip'", "emotion 'angry'", "background 'moon'", "'dinosaurus'"):
        assert word in msg


def test_count_rules(catalog: Catalog) -> None:
    data = good()
    data["scenes"][2]["params"]["count"] = None          # count_objects wajib count
    data["scenes"][1]["params"]["count"] = 2             # show_object tidak memakai count
    msg = errors_of(data, catalog)
    assert "wajib 'count'" in msg and "tidak memakai 'count'" in msg


def test_items_count_rule(catalog: Catalog) -> None:
    data = good()
    data["scenes"][0]["params"]["items"] = ["apel"]      # intro tidak memakai item
    assert "butuh 0 item" in errors_of(data, catalog)


def test_hook_must_start_scene_one(catalog: Catalog) -> None:
    data = good()
    data["hook"] = "Siapa suka warna?"
    assert "hook" in errors_of(data, catalog)


def test_hook_too_long(catalog: Catalog) -> None:
    data = good()
    data["hook"] = "Hai teman ayo kita belajar bersama sama hari ini ya"
    data["scenes"][0]["narration"] = data["hook"] + "."
    assert "hook maksimal" in errors_of(data, catalog)


def test_scene_ids_sequential(catalog: Catalog) -> None:
    data = good()
    data["scenes"][2]["id"] = 7
    assert "berurutan" in errors_of(data, catalog)


def test_total_duration_must_match(catalog: Catalog) -> None:
    data = good()
    data["total_duration_sec"] = 45
    assert "total_duration_sec" in errors_of(data, catalog)


def test_duration_range_from_config(catalog: Catalog) -> None:
    data = good()
    for s in data["scenes"]:
        s["duration_sec"] = 4
    data["total_duration_sec"] = 20
    assert "antara 25-35" in errors_of(data, catalog, VideoConfig())


def test_narration_too_dense(catalog: Catalog) -> None:
    data = good()
    data["scenes"][1]["narration"] = " ".join(["kata"] * 25)
    assert "terlalu panjang" in errors_of(data, catalog)


def test_extra_field_rejected(catalog: Catalog) -> None:
    data = good()
    data["scenes"][0]["musik"] = "ceria"
    assert "musik" in errors_of(data, catalog)


def test_json_schema_contains_catalog_enums(catalog: Catalog) -> None:
    schema = script_json_schema(catalog)
    json.dumps(schema)  # harus bisa dikirim ke Ollama
    assert "count_objects" in schema["$defs"]["Scene"]["properties"]["template"]["enum"]
    params = schema["$defs"]["SceneParams"]["properties"]
    assert "kiki" in params["character"]["enum"]
    assert "apel" in params["items"]["items"]["enum"]


# ------------------------------------------------------------ review keamanan
IDS = ["a", "b"]


def test_safety_review_valid() -> None:
    r = parse_safety_review({"verdict": "pass", "items": [
        {"criterion": "a", "ok": True, "reason": ""},
        {"criterion": "b", "ok": True, "reason": "baik"}], "extra": 1}, IDS)
    assert r.verdict == "pass"


def test_safety_review_missing_unknown_duplicate() -> None:
    with pytest.raises(OutputInvalid) as exc:
        parse_safety_review({"verdict": "pass", "items": [
            {"criterion": "a", "ok": True}, {"criterion": "a", "ok": True},
            {"criterion": "z", "ok": True}]}, IDS)
    msg = " ".join(exc.value.errors)
    assert "belum menilai" in msg and "tidak dikenal" in msg and "lebih dari sekali" in msg


def test_safety_review_not_ok_needs_reason() -> None:
    with pytest.raises(OutputInvalid):
        parse_safety_review({"verdict": "revise", "items": [
            {"criterion": "a", "ok": False, "reason": ""},
            {"criterion": "b", "ok": True}]}, IDS)


def test_safety_review_bad_verdict() -> None:
    with pytest.raises(OutputInvalid):
        parse_safety_review({"verdict": "maybe", "items": []}, IDS)


# --------------------------------------------------------- suara & metadata
def test_word_timing_order() -> None:
    WordTiming(text="hai", start=0.1, end=0.4)
    with pytest.raises(ValidationError):
        WordTiming(text="hai", start=0.5, end=0.4)


def test_metadata_limits() -> None:
    from datetime import UTC, datetime

    meta = VideoMetadata(job_id=1, title="Judul", description="Desc", hashtags=["#Shorts"],
                         duration_sec=30, age_group="3-6", language="id",
                         learning_goal="x", created_at=datetime.now(UTC))
    assert meta.made_for_kids is True
    with pytest.raises(ValidationError):
        VideoMetadata(job_id=1, title="x", description="", hashtags=[], duration_sec=61,
                      age_group="3-6", language="id", learning_goal="x",
                      created_at=datetime.now(UTC))
