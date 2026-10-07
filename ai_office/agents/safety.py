"""Penasihat Keamanan Anak: meninjau naskah dengan rubrik (LLM) + pemeriksaan otomatis."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..config import AppConfig
from ..llm.base import LLMProvider, Message
from ..llm.structured import generate_structured
from ..models import AgentName
from ..schemas import (
    AutomatedFlag,
    SafetyItem,
    SafetyReport,
    SafetyReview,
    Script,
    parse_safety_review,
    word_count,
)
from .base import Agent, AgentContext, AgentError

PROMPT_DIR = Path(__file__).with_name("prompts")

_URL = re.compile(r"(https?://|www\.)\S+|\b[\w-]+\.(com|id|net|org|co)\b", re.IGNORECASE)
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_PHONE_CANDIDATE = re.compile(r"\+?\d[\d\s().-]{6,}\d")


class _PhoneDetector:
    """Nomor telepon = deretan angka (boleh dipisah spasi/strip) berisi >= 9 digit dengan
    kelompok angka minimal 3 digit (agar hitungan "1 2 3 ... 10" tidak dianggap nomor)."""

    @staticmethod
    def search(text: str) -> bool:
        for m in _PHONE_CANDIDATE.finditer(text):
            chunk = m.group(0)
            digits = sum(ch.isdigit() for ch in chunk)
            groups = [g for g in re.split(r"[^\d]+", chunk) if g]
            if digits >= 9 and max(len(g) for g in groups) >= 3:
                return True
        return False


_PHONE = _PhoneDetector()
_MENTION = re.compile(r"(?<!\w)@\w{2,}")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class Criterion:
    id: str
    description: str


@dataclass
class Rubric:
    criteria: list[Criterion]
    max_words_per_sentence: int = 12
    banned_words: dict[str, list[str]] = field(default_factory=dict)
    brands: list[str] = field(default_factory=list)
    detect_contact_info: bool = True

    @property
    def ids(self) -> list[str]:
        return [c.id for c in self.criteria]

    def description(self, criterion_id: str) -> str:
        return next((c.description for c in self.criteria if c.id == criterion_id), "")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Rubric:
        criteria = [Criterion(id=str(c["id"]), description=" ".join(str(c["description"]).split()))
                    for c in data.get("criteria", [])]
        if not criteria:
            raise ValueError("Rubrik keamanan harus punya minimal 1 kriteria")
        ids = [c.id for c in criteria]
        if len(set(ids)) != len(ids):
            raise ValueError("id kriteria rubrik tidak boleh duplikat")
        auto = data.get("automated_checks") or {}
        banned = {k: [str(w) for w in v or []] for k, v in (auto.get("banned_words") or {}).items()}
        unknown = set(banned) - set(ids)
        if unknown:
            raise ValueError(f"banned_words memakai kriteria yang tidak ada: {sorted(unknown)}")
        return cls(
            criteria=criteria,
            max_words_per_sentence=int(auto.get("max_words_per_sentence", 12)),
            banned_words=banned,
            brands=[str(b) for b in auto.get("brands") or []],
            detect_contact_info=bool(auto.get("detect_contact_info", True)),
        )


def load_rubric(path: Path) -> Rubric:
    import yaml

    with path.open("r", encoding="utf-8") as fh:
        return Rubric.from_dict(yaml.safe_load(fh) or {})


def _phrase_regex(phrase: str) -> re.Pattern[str]:
    return re.compile(r"(?<!\w)" + re.escape(phrase.lower()) + r"(?!\w)")


def automated_checks(script: Script, rubric: Rubric) -> list[AutomatedFlag]:
    """Pemeriksaan pasti tanpa LLM. Kriteria yang dipakai harus ada di rubrik."""
    ids = set(rubric.ids)
    flags: list[AutomatedFlag] = []

    def flag(criterion: str, reason: str) -> None:
        if criterion in ids:
            flags.append(AutomatedFlag(criterion=criterion, reason=reason))

    texts: list[tuple[str, str]] = [("judul", script.title), ("hook", script.hook),
                                    ("learning_goal", script.learning_goal)]
    for s in script.scenes:
        texts.append((f"scene {s.id}", s.narration))
        if s.on_screen_text:
            texts.append((f"teks layar scene {s.id}", s.on_screen_text))
    texts.append(("hashtag", " ".join(script.hashtags)))

    for criterion, words in rubric.banned_words.items():
        for word in words:
            rx = _phrase_regex(word)
            for where, text in texts:
                if rx.search(text.lower()):
                    flag(criterion, f"{where}: mengandung kata terlarang '{word}'")

    brand_criterion = "tanpa_data_pribadi_merek_iklan"
    for brand in rubric.brands:
        rx = _phrase_regex(brand)
        for where, text in texts:
            if rx.search(text.lower()):
                flag(brand_criterion, f"{where}: menyebut merek '{brand}'")

    if rubric.detect_contact_info:
        for where, text in texts:
            for rx, what in ((_URL, "link/URL"), (_EMAIL, "email"), (_PHONE, "nomor telepon"),
                             (_MENTION, "@mention")):
                if where == "hashtag" and what == "@mention":
                    continue
                if rx.search(text):
                    flag(brand_criterion, f"{where}: mengandung {what}")

    for s in script.scenes:
        for sentence in _SENTENCE_SPLIT.split(s.narration):
            n = word_count(sentence)
            if n > rubric.max_words_per_sentence:
                flag("bahasa_sederhana",
                     f"scene {s.id}: kalimat {n} kata (maks {rubric.max_words_per_sentence}): "
                     f"\"{sentence[:60]}\"")
    return flags


def merge_review(review: SafetyReview, flags: list[AutomatedFlag], rubric: Rubric) -> SafetyReport:
    """Gabungkan penilaian LLM + otomatis. Lulus HANYA jika semua kriteria ok di keduanya."""
    by_id = {i.criterion: i for i in review.items}
    items: list[SafetyItem] = []
    for c in rubric.criteria:
        llm_item = by_id[c.id]
        auto = [f.reason for f in flags if f.criterion == c.id]
        ok = llm_item.ok and not auto
        reasons = ([llm_item.reason] if llm_item.reason else []) + auto
        source = ("llm+automated" if auto and not llm_item.ok
                  else "automated" if auto else "llm")
        items.append(SafetyItem(criterion=c.id, description=c.description, ok=ok,
                                reason=" | ".join(reasons) or "ok", source=source))
    all_ok = all(i.ok for i in items)
    verdict = "pass" if (all_ok and review.verdict == "pass") else "revise"
    suggestions = list(review.suggestions)
    if flags:
        suggestions.append("Hapus/ganti bagian yang ditandai pemeriksaan otomatis: "
                           + "; ".join(f.reason for f in flags[:5]))
    if verdict == "revise" and not suggestions:
        suggestions.append("Perbaiki kriteria yang belum ok sesuai alasan di atas.")
    return SafetyReport(
        verdict=verdict, items=items, suggestions=suggestions,
        summary=review.summary, automated_flags=flags, llm_verdict=review.verdict,
    )


class SafetyAgent(Agent):
    name = AgentName.SAFETY

    def __init__(self, config: AppConfig, provider: LLMProvider,
                 rubric: Rubric | None = None) -> None:
        self.config = config
        self.provider = provider
        self._rubric_override = rubric
        self._rubric_cache: dict[str, Rubric] = {}

    def _rubric_for(self, language: str) -> Rubric:
        """Rubrik sesuai bahasa: safety_rubric_<lang>.yaml bila ada, selain itu rubric_file config.

        Penting: kriteria LLM dan automated_checks diambil dari file yang sama, jadi id-nya
        selalu konsisten (English vs Indonesia tidak akan tercampur).
        """
        if self._rubric_override is not None:
            return self._rubric_override
        if language in self._rubric_cache:
            return self._rubric_cache[language]
        base = self.config.resolve(self.config.safety.rubric_file)
        lang_file = base.with_name(f"safety_rubric_{language}.yaml")
        path = lang_file if lang_file.exists() else base
        rubric = load_rubric(path)
        self._rubric_cache[language] = rubric
        return rubric

    def is_available(self) -> bool:
        return self.provider.is_available()

    def system_prompt(self, age_group: str, language: str = "en") -> str:
        from .writer import load_prompt_template

        template = load_prompt_template("safety_system", language)
        rubric_obj = self._rubric_for(language)
        rubric = "\n".join(f"- {c.id}: {c.description}" for c in rubric_obj.criteria)
        return template.substitute(age_group=age_group, rubric=rubric)

    def run(self, ctx: AgentContext) -> dict[str, Any]:
        raw_script = (ctx.artifacts.get(AgentName.WRITER.value) or {}).get("script")
        if not raw_script:
            raise AgentError("Naskah belum ada untuk ditinjau")
        script = Script.model_validate(raw_script)
        rubric = self._rubric_for(script.language)

        flags = automated_checks(script, rubric)
        if flags:
            ctx.log(f"Pemeriksaan otomatis menemukan {len(flags)} masalah")

        ctx.log(f"Meninjau naskah dengan {self.provider.name}:{self.provider.model}")
        user = ("Review the following script:\n" if script.language == "en"
                else "Tinjau naskah berikut:\n") + json.dumps(raw_script, ensure_ascii=False,
                                                              indent=2)
        review, attempts = generate_structured(
            self.provider,
            [Message("system", self.system_prompt(script.age_group, script.language)),
             Message("user", user)],
            parse=lambda data: parse_safety_review(data, rubric.ids),
            max_retries=self.config.pipeline.max_llm_retries,
            temperature=self.config.safety.temperature,
            log=ctx.log,
        )
        report = merge_review(review, flags, rubric)
        failed = [i.criterion for i in report.items if not i.ok]
        ctx.log(f"Hasil review: {report.verdict}"
                + (f" (belum ok: {', '.join(failed)})" if failed else "")
                + f" - percobaan ke-{attempts}")
        return report.model_dump(mode="json")
