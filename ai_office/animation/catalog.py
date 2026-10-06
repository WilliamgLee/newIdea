"""Katalog pustaka animasi (template, karakter, pose, ekspresi, latar, objek, warna)."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

CATALOG_PATH = Path(__file__).with_name("catalog.yaml")


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    description: str
    items_min: int
    items_max: int
    count_range: tuple[int, int] | None = None   # None = template tidak memakai `count`
    color_allowed: bool = False


@dataclass(frozen=True)
class CharacterSpec:
    name: str
    description: str
    poses: frozenset[str]
    emotions: frozenset[str]


@dataclass(frozen=True)
class Catalog:
    templates: dict[str, TemplateSpec]
    characters: dict[str, CharacterSpec]
    backgrounds: dict[str, str]
    colors: frozenset[str]
    objects: dict[str, tuple[str, ...]]          # kategori -> nama objek
    all_objects: frozenset[str] = field(default=frozenset())

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Catalog:
        templates = {}
        for name, spec in data["templates"].items():
            lo, hi = spec.get("items", [0, 0])
            count = spec.get("count")
            templates[name] = TemplateSpec(
                name=name,
                description=spec["description"],
                items_min=int(lo),
                items_max=int(hi),
                count_range=(int(count[0]), int(count[1])) if count else None,
                color_allowed=spec.get("color") == "optional",
            )
        characters = {
            name: CharacterSpec(name=name, description=spec["description"],
                                poses=frozenset(spec["poses"]),
                                emotions=frozenset(spec["emotions"]))
            for name, spec in data["characters"].items()
        }
        objects = {cat: tuple(items) for cat, items in data["objects"].items()}
        return cls(
            templates=templates,
            characters=characters,
            backgrounds=dict(data["backgrounds"]),
            colors=frozenset(data["colors"]),
            objects=objects,
            all_objects=frozenset(o for items in objects.values() for o in items),
        )

    # ------------------------------------------------------------ validasi
    def scene_errors(self, scene_id: int, template: str, params: Any) -> list[str]:
        """Periksa satu scene terhadap katalog. `params` adalah objek SceneParams."""
        where = f"scene {scene_id}"
        errors: list[str] = []
        spec = self.templates.get(template)
        if spec is None:
            errors.append(f"{where}: template '{template}' tidak ada. "
                          f"Pilih salah satu: {', '.join(self.templates)}")
            return errors

        char = self.characters.get(params.character)
        if char is None:
            errors.append(f"{where}: karakter '{params.character}' tidak ada. "
                          f"Pilih: {', '.join(self.characters)}")
        else:
            if params.pose not in char.poses:
                errors.append(f"{where}: pose '{params.pose}' tidak ada untuk "
                              f"{char.name}. Pilih: {', '.join(sorted(char.poses))}")
            if params.emotion not in char.emotions:
                errors.append(f"{where}: emotion '{params.emotion}' tidak ada untuk "
                              f"{char.name}. Pilih: {', '.join(sorted(char.emotions))}")
        if params.background not in self.backgrounds:
            errors.append(f"{where}: background '{params.background}' tidak ada. "
                          f"Pilih: {', '.join(self.backgrounds)}")

        n = len(params.items)
        if not spec.items_min <= n <= spec.items_max:
            want = (str(spec.items_min) if spec.items_min == spec.items_max
                    else f"{spec.items_min}-{spec.items_max}")
            errors.append(f"{where}: template '{template}' butuh {want} item, bukan {n}")
        for item in params.items:
            if item not in self.all_objects:
                errors.append(f"{where}: objek '{item}' tidak ada di pustaka. "
                              f"Pilih dari daftar objek yang tersedia")

        if spec.count_range is None:
            if params.count is not None:
                errors.append(f"{where}: template '{template}' tidak memakai 'count'")
        else:
            lo, hi = spec.count_range
            if params.count is None or not lo <= params.count <= hi:
                errors.append(f"{where}: template '{template}' wajib 'count' antara {lo}-{hi}")

        if params.color is not None:
            if not spec.color_allowed:
                errors.append(f"{where}: template '{template}' tidak memakai 'color'")
            elif params.color not in self.colors:
                errors.append(f"{where}: warna '{params.color}' tidak ada. "
                              f"Pilih: {', '.join(sorted(self.colors))}")
        return errors

    # -------------------------------------------------------- untuk prompt
    def prompt_listing(self) -> str:
        """Daftar nama valid yang diberikan ke LLM."""
        lines = ["TEMPLATE SCENE (field `template`):"]
        for t in self.templates.values():
            rules = [f"items={t.items_min}" if t.items_min == t.items_max
                     else f"items={t.items_min}-{t.items_max}"]
            if t.count_range:
                rules.append(f"count wajib {t.count_range[0]}-{t.count_range[1]}")
            if t.color_allowed:
                rules.append("color opsional")
            lines.append(f"- {t.name}: {t.description} [{'; '.join(rules)}]")
        lines.append("\nKARAKTER (params.character), pose, dan emotion:")
        for c in self.characters.values():
            lines.append(f"- {c.name}: {c.description}. pose: {', '.join(sorted(c.poses))}. "
                         f"emotion: {', '.join(sorted(c.emotions))}")
        lines.append("\nBACKGROUND (params.background): " + ", ".join(self.backgrounds))
        lines.append("\nOBJEK (params.items):")
        for cat, items in self.objects.items():
            lines.append(f"- {cat}: {', '.join(items)}")
        lines.append("\nWARNA (params.color): " + ", ".join(sorted(self.colors)))
        return "\n".join(lines)


@lru_cache(maxsize=4)
def load_catalog(path: str | Path = CATALOG_PATH) -> Catalog:
    import yaml

    with Path(path).open("r", encoding="utf-8") as fh:
        return Catalog.from_dict(yaml.safe_load(fh))
