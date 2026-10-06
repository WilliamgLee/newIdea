"""Autentikasi admin: hashing argon2id, sesi cookie bertanda tangan, CSRF, rate-limit.

Prinsip:
- Kredensial admin TIDAK pernah di-hardcode. Dibuat lewat scripts/set_admin.py ke data/admin.json
  (di-gitignore), hanya menyimpan username + HASH argon2id (bukan password).
- Verifikasi login hanya di server. Cookie sesi HttpOnly + SameSite=Strict (+Secure saat HTTPS),
  berisi session id acak yang ditandatangani (HMAC) dengan masa kedaluwarsa.
- Proteksi CSRF (double-submit token) untuk semua request yang mengubah data.
- Rate-limit + lockout sementara untuk login; perbandingan waktu-konstan; pesan error generik.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SESSION_COOKIE = "ai_office_session"
CSRF_COOKIE = "ai_office_csrf"
CSRF_HEADER = "X-CSRF-Token"
SESSION_TTL_SEC = 8 * 3600
# Rate limit login
MAX_ATTEMPTS = 5
LOCKOUT_SEC = 300
ATTEMPT_WINDOW_SEC = 900


class AuthError(Exception):
    pass


# ----------------------------------------------------------------- hashing
def _get_hasher():
    try:
        from argon2 import PasswordHasher

        return PasswordHasher()
    except ImportError as exc:  # pragma: no cover
        raise AuthError(
            "Paket argon2-cffi belum terpasang. Jalankan: pip install -r requirements.txt"
        ) from exc


def hash_password(password: str) -> str:
    return _get_hasher().hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    from argon2.exceptions import VerifyMismatchError

    try:
        _get_hasher().verify(stored_hash, password)
        return True
    except VerifyMismatchError:
        return False
    except Exception:  # noqa: BLE001 - hash rusak dll. -> dianggap gagal
        return False


# ----------------------------------------------------------------- admin store
@dataclass
class AdminStore:
    path: Path

    def exists(self) -> bool:
        return self.path.exists()

    def load(self) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return None

    def save(self, username: str, password_hash: str) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"username": username, "password_hash": password_hash,
                        "created_at": time.time()}, indent=2),
            encoding="utf-8")
        # batasi izin file (POSIX; di Windows diabaikan tanpa error)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def username(self) -> str | None:
        data = self.load()
        return data.get("username") if data else None


# ----------------------------------------------------------------- sesi (HMAC)
def _sign(secret: bytes, value: str) -> str:
    sig = hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()
    return f"{value}.{sig}"


def _unsign(secret: bytes, token: str) -> str | None:
    if not token or token.count(".") < 1:
        return None
    value, _, sig = token.rpartition(".")
    expected = hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(sig, expected):
        return value
    return None


@dataclass
class SessionManager:
    secret: bytes
    ttl_sec: float = SESSION_TTL_SEC
    _sessions: dict[str, float] = field(default_factory=dict)  # sid -> expiry

    def create(self) -> str:
        sid = secrets.token_urlsafe(32)
        self._sessions[sid] = time.time() + self.ttl_sec
        return _sign(self.secret, sid)

    def validate(self, token: str | None) -> bool:
        if not token:
            return False
        sid = _unsign(self.secret, token)
        if sid is None:
            return False
        expiry = self._sessions.get(sid)
        if expiry is None:
            return False
        if time.time() > expiry:
            self._sessions.pop(sid, None)
            return False
        return True

    def destroy(self, token: str | None) -> None:
        if not token:
            return
        sid = _unsign(self.secret, token)
        if sid:
            self._sessions.pop(sid, None)

    def new_csrf(self) -> str:
        return secrets.token_urlsafe(24)


# ----------------------------------------------------------------- rate limit
@dataclass
class RateLimiter:
    max_attempts: int = MAX_ATTEMPTS
    lockout_sec: float = LOCKOUT_SEC
    window_sec: float = ATTEMPT_WINDOW_SEC
    _fails: dict[str, list[float]] = field(default_factory=dict)
    _locked_until: dict[str, float] = field(default_factory=dict)

    def locked(self, key: str) -> float:
        """Sisa detik lockout (0 bila tidak terkunci)."""
        until = self._locked_until.get(key, 0)
        remaining = until - time.time()
        return max(0, remaining)

    def record_failure(self, key: str) -> None:
        now = time.time()
        fails = [t for t in self._fails.get(key, []) if now - t < self.window_sec]
        fails.append(now)
        self._fails[key] = fails
        if len(fails) >= self.max_attempts:
            self._locked_until[key] = now + self.lockout_sec
            self._fails[key] = []

    def reset(self, key: str) -> None:
        self._fails.pop(key, None)
        self._locked_until.pop(key, None)


# ----------------------------------------------------------------- secret key
def load_secret_key(env_name: str = "AI_OFFICE_SECRET_KEY",
                    fallback_file: Path | None = None) -> bytes:
    """Secret untuk menandatangani sesi. Dari env; kalau tidak ada, dari/ke file lokal."""
    val = os.environ.get(env_name)
    if val:
        return val.encode()
    if fallback_file is not None:
        if fallback_file.exists():
            return fallback_file.read_bytes()
        key = secrets.token_bytes(48)
        fallback_file.parent.mkdir(parents=True, exist_ok=True)
        fallback_file.write_bytes(key)
        try:
            os.chmod(fallback_file, 0o600)
        except OSError:
            pass
        return key
    return secrets.token_bytes(48)


@dataclass
class AuthService:
    """Perekat semua komponen auth, dipakai handler API."""

    admin: AdminStore
    sessions: SessionManager
    limiter: RateLimiter = field(default_factory=RateLimiter)

    def login(self, username: str, password: str, rate_key: str) -> str:
        """Kembalikan token sesi bila sukses. Raise AuthError (pesan generik) bila gagal/terkunci."""
        locked = self.limiter.locked(rate_key)
        if locked > 0:
            raise AuthError(f"Terlalu banyak percobaan. Coba lagi dalam {int(locked)} detik.")
        data = self.admin.load()
        # selalu lakukan verifikasi (waktu-konstan) walau admin belum ada / username beda
        stored = (data or {}).get("password_hash", "")
        dummy = "$argon2id$v=19$m=65536,t=3,p=4$" + "A" * 22 + "$" + "A" * 43
        ok_user = bool(data) and hmac.compare_digest(
            (data or {}).get("username", ""), username)
        ok_pass = verify_password(stored or dummy, password)
        if ok_user and ok_pass:
            self.limiter.reset(rate_key)
            return self.sessions.create()
        self.limiter.record_failure(rate_key)
        raise AuthError("Username atau password salah.")

    def is_authenticated(self, session_token: str | None) -> bool:
        return self.sessions.validate(session_token)
