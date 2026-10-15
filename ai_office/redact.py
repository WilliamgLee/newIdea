"""Penyamaran rahasia (Rahasia_OAuth) untuk log, artefak job, dan respons API.

Isi modul:
- ``mask_secrets(text, secrets)``: fungsi murni. Menutupi setiap kemunculan rahasia,
  termasuk rahasia yang saling tumpang-tindih, berulang, atau bersambung.
- ``Redactor``: registry rahasia yang thread-safe, dengan ``mask()`` dan
  ``logging_filter()``.
- ``redactor``: instance global yang dipakai orchestrator dan uploader.
- ``install_logging_filter()``: memasang filter pada root logger dan handler-nya.

Requirements: 5.13
"""
from __future__ import annotations

import logging
import threading
from collections.abc import Iterable

MASK = "***"
# Rahasia yang lebih pendek dari ini diabaikan. Tujuannya mencegah over-masking
# (misalnya kata umum), sekaligus menjamin teks selalu memendek per putaran
# masking (len(rahasia) > len(MASK)), sehingga loop di mask_secrets pasti berhenti.
MIN_SECRET_LEN = 8


def _normalize(secrets: Iterable[str]) -> list[str]:
    """Saring rahasia yang valid (str, panjang >= MIN_SECRET_LEN), unik, terpanjang dulu."""
    uniq = {s for s in secrets if isinstance(s, str) and len(s) >= MIN_SECRET_LEN}
    return sorted(uniq, key=len, reverse=True)


def _covered_intervals(text: str, secrets: list[str]) -> list[tuple[int, int]]:
    """Semua rentang [start, end) yang memuat kemunculan rahasia, sudah digabung.

    Kemunculan yang tumpang-tindih (``find`` maju 1 karakter) ikut dihitung, dan
    rentang yang bersinggungan atau bersambung digabung menjadi satu.
    """
    spans: list[tuple[int, int]] = []
    for secret in secrets:
        start = text.find(secret)
        while start != -1:
            spans.append((start, start + len(secret)))
            start = text.find(secret, start + 1)
    if not spans:
        return []
    spans.sort()
    merged = [spans[0]]
    for s, e in spans[1:]:
        last_s, last_e = merged[-1]
        if s <= last_e:  # tumpang-tindih atau bersambung
            merged[-1] = (last_s, max(last_e, e))
        else:
            merged.append((s, e))
    return merged


def mask_secrets(text: str, secrets: Iterable[str]) -> str:
    """Ganti setiap rentang teks yang memuat rahasia dengan ``MASK``.

    Jaminan (Property 13):
    - hasil tidak memuat satu pun rahasia (panjang >= ``MIN_SECRET_LEN``) sebagai substring;
    - teks yang tidak memuat rahasia dikembalikan apa adanya.

    Penggantian bisa membentuk rahasia baru dari gabungan ``MASK`` dan teks di
    sekitarnya (bila rahasia mengandung ``*``). Karena itu proses diulang sampai
    tidak ada rahasia tersisa. Setiap putaran memendekkan teks, jadi loop pasti berhenti.
    """
    if not text:
        return text
    valid = _normalize(secrets)
    if not valid:
        return text
    while True:
        intervals = _covered_intervals(text, valid)
        if not intervals:
            return text
        parts: list[str] = []
        pos = 0
        for s, e in intervals:
            parts.append(text[pos:s])
            parts.append(MASK)
            pos = e
        parts.append(text[pos:])
        text = "".join(parts)


class Redactor:
    """Registry rahasia yang thread-safe."""

    def __init__(self, secrets: Iterable[str] = ()) -> None:
        self._lock = threading.Lock()
        self._secrets: frozenset[str] = frozenset()
        self.register(*secrets)

    def register(self, *secrets: str | None) -> None:
        """Daftarkan rahasia. Nilai kosong, None, atau terlalu pendek diabaikan."""
        valid = {s for s in secrets if isinstance(s, str) and len(s) >= MIN_SECRET_LEN}
        if not valid:
            return
        with self._lock:
            self._secrets = self._secrets | valid

    def unregister(self, *secrets: str) -> None:
        with self._lock:
            self._secrets = self._secrets - set(secrets)

    def clear(self) -> None:
        with self._lock:
            self._secrets = frozenset()

    def secrets(self) -> frozenset[str]:
        """Snapshot himpunan rahasia saat ini (immutable)."""
        with self._lock:
            return self._secrets

    def mask(self, text: str) -> str:
        """Samarkan ``text`` memakai rahasia yang terdaftar saat ini."""
        if not isinstance(text, str):
            text = str(text)
        snapshot = self.secrets()
        if not snapshot:
            return text
        return mask_secrets(text, snapshot)

    def logging_filter(self) -> "RedactingFilter":
        return RedactingFilter(self)


class RedactingFilter(logging.Filter):
    """``logging.Filter`` yang menyamarkan pesan, traceback, dan stack log.

    Record tidak pernah dibuang (selalu mengembalikan True). Pesan diformat lebih
    dulu (``getMessage``), lalu disamarkan dan disimpan kembali ke ``msg`` dengan
    ``args`` dikosongkan. Traceback diformat ke ``exc_text`` lalu disamarkan, dan
    Formatter standar akan memakai ``exc_text`` tersebut.
    """

    def __init__(self, redactor: Redactor) -> None:
        super().__init__()
        self.redactor = redactor

    def filter(self, record: logging.LogRecord) -> bool:
        if not self.redactor.secrets():
            return True
        try:
            message = record.getMessage()
        except Exception:  # args tidak cocok dengan format; samarkan apa adanya
            message = f"{record.msg} {record.args}"
        record.msg = self.redactor.mask(message)
        record.args = None
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = self.redactor.mask(record.exc_text)
        if record.stack_info:
            record.stack_info = self.redactor.mask(record.stack_info)
        return True


# Instance global: uploader mendaftarkan client.secrets(), dan orchestrator memakai
# redactor.mask() untuk pesan error.
redactor = Redactor()

_installed_filter: RedactingFilter | None = None
_install_lock = threading.Lock()


def install_logging_filter(target: Redactor | None = None) -> RedactingFilter:
    """Pasang filter penyamaran pada root logger dan semua handler-nya (idempoten).

    Filter pada logger hanya berlaku untuk record yang dibuat langsung di logger
    itu. Record dari child logger yang dipropagasi hanya melewati filter handler,
    jadi filter juga dipasang di setiap handler root. Panggil lagi setelah menambah
    handler baru di root.
    """
    global _installed_filter
    with _install_lock:
        if _installed_filter is None or (target is not None and _installed_filter.redactor is not target):
            if _installed_filter is not None:
                _uninstall_locked()
            _installed_filter = RedactingFilter(target or redactor)
        flt = _installed_filter
        root = logging.getLogger()
        if flt not in root.filters:
            root.addFilter(flt)
        for handler in root.handlers:
            if flt not in handler.filters:
                handler.addFilter(flt)
        return flt


def _uninstall_locked() -> None:
    global _installed_filter
    flt = _installed_filter
    if flt is None:
        return
    root = logging.getLogger()
    root.removeFilter(flt)
    for handler in root.handlers:
        handler.removeFilter(flt)
    _installed_filter = None


def uninstall_logging_filter() -> None:
    """Lepas filter dari root logger dan handler-nya. Berguna untuk test."""
    with _install_lock:
        _uninstall_locked()


__all__ = [
    "MASK",
    "MIN_SECRET_LEN",
    "mask_secrets",
    "Redactor",
    "RedactingFilter",
    "redactor",
    "install_logging_filter",
    "uninstall_logging_filter",
]
