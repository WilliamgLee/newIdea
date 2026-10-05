from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("pydantic")
pytest.importorskip("yaml")

from mock_llm import ScriptedLLM

from ai_office.agents.base import AgentContext
from ai_office.agents.fake import fake_script
from ai_office.agents.safety import SafetyAgent, automated_checks, load_rubric
from ai_office.agents.writer import WriterAgent
from ai_office.animation.catalog import load_catalog
from ai_office.config import AppConfig
from ai_office.db import Database
from ai_office.llm.structured import StructuredOutputError
from ai_office.models import Job
from ai_office.schemas import Script

ROOT = Path(__file__).resolve().parent.parent
RUBRIC = load_rubric(ROOT / "safety_rubric.yaml")


def all_ok_review(verdict: str = "pass", bad: str | None = None) -> dict[str, Any]:
    items = [{"criterion": c, "ok": c != bad, "reason": "bermasalah" if c == bad else "baik"}
             for c in RUBRIC.ids]
    return {"verdict": verdict, "items": items,
            "suggestions": ["Ganti kalimat"] if bad else [], "summary": "ringkas"}


@pytest.fixture
def config(tmp_path: Path) -> AppConfig:
    # base_dir = root repo agar content_profile.yaml & safety_rubric.yaml terbaca
    cfg = AppConfig.from_dict({"paths": {"data_dir": str(tmp_path / "data"),
                                         "output_dir": str(tmp_path / "out")}}, base_dir=ROOT)
    cfg.ensure_dirs()
    return cfg


@pytest.fixture
def job(config: AppConfig) -> Job:
    db = Database(config.db_path)
    db.init()
    return db.create_job("mengenal warna", "3-6", "ceria", "id")


def ctx_for(job: Job, config: AppConfig, feedback: dict[str, Any] | None = None,
            artifacts: dict[str, Any] | None = None) -> tuple[AgentContext, list[str]]:
    logs: list[str] = []
    job = copy.deepcopy(job)
    job.artifacts = artifacts or {}
    workdir = config.output_dir / f"job_{job.id}"
    workdir.mkdir(parents=True, exist_ok=True)
    return AgentContext(job=job, config=config, workdir=workdir, log=logs.append,
                        feedback=feedback), logs


# ------------------------------------------------------------------ writer
def test_writer_produces_valid_script(config: AppConfig, job: Job) -> None:
    llm_output = fake_script("mengenal warna", age_group="9-12", language="en")
    llm = ScriptedLLM([llm_output])
    writer = WriterAgent(config, llm, load_catalog(), profile={"channel_name": "Dunia Ceria"})
    ctx, _ = ctx_for(job, config)

    result = writer.run(ctx)

    script = Script.model_validate(result["script"])
    assert script.age_group == "3-6" and script.language == "id"   # dipaksa dari job
    assert result["attempts"] == 1
    saved = json.loads((ctx.workdir / "script.json").read_text(encoding="utf-8"))
    assert saved["title"] == script.title

    call = llm.calls[0]
    system = call["messages"][0].content
    for name in ("intro", "count_objects", "outro", "kiki", "apel", "Dunia Ceria", "3-6"):
        assert name in system                                       # daftar valid ada di prompt
    assert "mengenal warna" in call["messages"][1].content
    assert call["json_schema"]["$defs"]["Scene"]["properties"]["template"]["enum"]


def test_writer_retries_with_validation_errors(config: AppConfig, job: Job) -> None:
    bad = fake_script("mengenal warna")
    bad["scenes"][1]["template"] = "menari"
    llm = ScriptedLLM(["```json\n" + json.dumps(bad) + "\n```", fake_script("mengenal warna")])
    ctx, logs = ctx_for(job, config)

    result = WriterAgent(config, llm, load_catalog(), profile={}).run(ctx)

    assert result["attempts"] == 2
    retry_msg = llm.calls[1]["messages"][-1].content
    assert "template 'menari' tidak ada" in retry_msg
    assert any("Percobaan 1/3 tidak valid" in m for m in logs)


def test_writer_gives_up(config: AppConfig, job: Job) -> None:
    llm = ScriptedLLM(["{}"] * 3)
    ctx, _ = ctx_for(job, config)
    with pytest.raises(StructuredOutputError):
        WriterAgent(config, llm, load_catalog(), profile={}).run(ctx)
    assert len(llm.calls) == 3


def test_writer_revision_prompt_contains_feedback(config: AppConfig, job: Job) -> None:
    previous = fake_script("mengenal warna")
    previous["title"] = "Judul Lama Sekali"
    feedback = {"verdict": "revise", "items": [
        {"criterion": "bahasa_sederhana", "ok": False, "reason": "kalimat scene 2 terlalu sulit"},
        {"criterion": "fakta_benar", "ok": True, "reason": "ok"}],
        "suggestions": ["Pakai kata yang lebih mudah"]}
    llm = ScriptedLLM([fake_script("mengenal warna")])
    ctx, _ = ctx_for(job, config, feedback=feedback,
                     artifacts={"writer": {"script": previous}})
    WriterAgent(config, llm, load_catalog(), profile={}).run(ctx)
    user = llm.calls[0]["messages"][1].content
    assert "REVISI" in user and "Judul Lama Sekali" in user
    assert "kalimat scene 2 terlalu sulit" in user and "Pakai kata yang lebih mudah" in user
    assert "fakta_benar" not in user                     # hanya kriteria yang gagal


# ------------------------------------------------------- pemeriksaan otomatis
def script_with(**changes: Any) -> Script:
    data = fake_script("mengenal warna")
    for scene_id, narration in changes.get("narrations", {}).items():
        data["scenes"][scene_id - 1]["narration"] = narration
    return Script.model_validate(data)


def test_clean_script_has_no_flags() -> None:
    assert automated_checks(script_with(), RUBRIC) == []


@pytest.mark.parametrize(("narration", "criterion"), [
    ("Ada hantu di sana. Wah!", "tanpa_kekerasan_menakutkan"),
    ("Kunjungi www.contoh.com ya.", "tanpa_data_pribadi_merek_iklan"),
    ("Telepon 0812 3456 7890 ya.", "tanpa_data_pribadi_merek_iklan"),
    ("Jangan lupa subscribe ya!", "tanpa_manipulasi"),
    ("Ayo minta mama belikan mainan.", "tanpa_manipulasi"),
    ("Anjing berbunyi ga-woof!", "fakta_benar"),
    ("Ini kalimat yang sangat panjang sekali dan berisi terlalu banyak kata untuk anak kecil.",
     "bahasa_sederhana"),
])
def test_automated_flags(narration: str, criterion: str) -> None:
    flags = automated_checks(script_with(narrations={2: narration}), RUBRIC)
    assert criterion in {f.criterion for f in flags}


def test_counting_digits_not_phone_and_word_boundaries() -> None:
    script = script_with(narrations={2: "Hitung: 1 2 3 4 5 6 7 8 9 10.",
                                     3: "Kucing mematikan lampu. Klikkk!"})
    crits = {f.criterion for f in automated_checks(script, RUBRIC)}
    assert "tanpa_data_pribadi_merek_iklan" not in crits
    assert "tanpa_manipulasi" not in crits              # "Klikkk" bukan kata "klik"


# ------------------------------------------------------------ safety agent
def safety_ctx(job: Job, config: AppConfig, script: dict[str, Any]):
    return ctx_for(job, config, artifacts={"writer": {"script": script}})


def test_safety_pass(config: AppConfig, job: Job) -> None:
    llm = ScriptedLLM([all_ok_review()])
    ctx, _ = safety_ctx(job, config, fake_script("mengenal warna"))
    report = SafetyAgent(config, llm, RUBRIC).run(ctx)
    assert report["verdict"] == "pass"
    assert {i["criterion"] for i in report["items"]} == set(RUBRIC.ids)
    system = llm.calls[0]["messages"][0].content
    assert all(c in system for c in RUBRIC.ids)
    assert llm.calls[0]["temperature"] == config.safety.temperature


def test_safety_llm_pass_but_automated_flag_forces_revise(config: AppConfig, job: Job) -> None:
    script = fake_script("mengenal warna")
    script["scenes"][1]["narration"] = "Ada hantu. Lihat apel."
    llm = ScriptedLLM([all_ok_review()])
    ctx, _ = safety_ctx(job, config, script)
    report = SafetyAgent(config, llm, RUBRIC).run(ctx)
    assert report["verdict"] == "revise" and report["llm_verdict"] == "pass"
    item = next(i for i in report["items"] if i["criterion"] == "tanpa_kekerasan_menakutkan")
    assert item["ok"] is False and "hantu" in item["reason"] and item["source"] == "automated"
    assert any("hantu" in s for s in report["suggestions"])


def test_safety_inconsistent_llm_verdict_is_conservative(config: AppConfig, job: Job) -> None:
    llm = ScriptedLLM([all_ok_review(verdict="pass", bad="fakta_benar")])
    ctx, _ = safety_ctx(job, config, fake_script("mengenal warna"))
    assert SafetyAgent(config, llm, RUBRIC).run(ctx)["verdict"] == "revise"


def test_safety_retries_invalid_review(config: AppConfig, job: Job) -> None:
    incomplete = {"verdict": "pass", "items": [{"criterion": "bahasa_sederhana", "ok": True}]}
    llm = ScriptedLLM([incomplete, all_ok_review()])
    ctx, _ = safety_ctx(job, config, fake_script("mengenal warna"))
    assert SafetyAgent(config, llm, RUBRIC).run(ctx)["verdict"] == "pass"
    assert "belum menilai kriteria" in llm.calls[1]["messages"][-1].content


def test_rubric_file_is_valid() -> None:
    assert len(RUBRIC.ids) == 7
    assert RUBRIC.max_words_per_sentence == 12
