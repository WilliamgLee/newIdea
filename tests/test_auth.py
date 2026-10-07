"""Test M6: autentikasi & endpoint admin. Mencakup login, logout, sesi kedaluwarsa, CSRF,
rate-limit/lockout, dan akses endpoint admin tanpa login."""

from __future__ import annotations

import time

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")
pytest.importorskip("argon2")

from fastapi.testclient import TestClient

from ai_office.orchestrator import Orchestrator
from ai_office.web.api import create_app
from ai_office.web.auth import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    AdminStore,
    AuthService,
    RateLimiter,
    SessionManager,
    hash_password,
    verify_password,
)

USER = "admin"
PW = "s3cretpass!"


@pytest.fixture
def auth(orch: Orchestrator) -> AuthService:
    store = AdminStore(orch.config.data_dir / "admin.json")
    store.save(USER, hash_password(PW))
    return AuthService(admin=store, sessions=SessionManager(secret=b"test-secret-key"),
                       limiter=RateLimiter(max_attempts=3, lockout_sec=100))


@pytest.fixture
def client(orch: Orchestrator, auth: AuthService):
    with TestClient(create_app(orch, start_worker=False, auth=auth)) as c:
        yield c


def do_login(client: TestClient, user: str = USER, pw: str = PW):
    return client.post("/api/auth/login", json={"username": user, "password": pw})


# ------------------------------------------------------------ hashing
def test_argon2_hash_roundtrip() -> None:
    h = hash_password("hello-world")
    assert h.startswith("$argon2") and "hello-world" not in h   # bukan plaintext
    assert verify_password(h, "hello-world") is True
    assert verify_password(h, "wrong") is False


# ------------------------------------------------------------ login/logout
def test_login_success_sets_cookies(client: TestClient) -> None:
    r = do_login(client)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert SESSION_COOKIE in r.cookies and CSRF_COOKIE in r.cookies
    # cookie sesi HttpOnly, SameSite=Strict
    set_cookie = r.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower() and "samesite=strict" in set_cookie.lower()


def test_login_wrong_password_generic_error(client: TestClient) -> None:
    r = do_login(client, pw="salah")
    assert r.status_code == 401
    assert "salah" in r.json()["detail"].lower()           # pesan generik
    assert SESSION_COOKIE not in r.cookies


def test_login_wrong_username(client: TestClient) -> None:
    assert do_login(client, user="bukanadmin").status_code == 401


def test_auth_status_reflects_session(client: TestClient) -> None:
    assert client.get("/api/auth/status").json() == {"authenticated": False,
                                                      "admin_configured": True}
    do_login(client)
    assert client.get("/api/auth/status").json()["authenticated"] is True


def test_logout_clears_session(client: TestClient) -> None:
    do_login(client)
    client.post("/api/auth/logout", headers=_csrf(client))
    assert client.get("/api/auth/status").json()["authenticated"] is False


# ------------------------------------------------------- akses admin
def _csrf(client: TestClient) -> dict[str, str]:
    return {"X-CSRF-Token": client.cookies.get(CSRF_COOKIE, "")}


ADMIN_GET = ["/api/admin/jobs", "/api/admin/jobs/1", "/api/admin/settings"]
ADMIN_POST = [
    ("/api/admin/jobs", {"topic": "x"}),
    ("/api/admin/jobs/1/approve-script", {}),
    ("/api/admin/jobs/1/approve-final", {}),
    ("/api/admin/jobs/1/reject", {}),
    ("/api/admin/jobs/1/retry", {}),
    ("/api/admin/mode", {"mode": "full_auto"}),
]


@pytest.mark.parametrize("path", ADMIN_GET)
def test_admin_get_requires_login(client: TestClient, path: str) -> None:
    assert client.get(path).status_code == 401


@pytest.mark.parametrize(("path", "body"), ADMIN_POST)
def test_admin_post_requires_login(client: TestClient, path: str, body: dict) -> None:
    # tanpa login -> 401, bahkan dengan CSRF palsu
    r = client.post(path, json=body, headers={"X-CSRF-Token": "x"})
    assert r.status_code == 401


# ------------------------------------------------------------ CSRF
@pytest.mark.parametrize(("path", "body"), ADMIN_POST)
def test_mutating_requires_csrf(client: TestClient, path: str, body: dict) -> None:
    do_login(client)
    # login sukses tapi TANPA header CSRF -> 403
    r = client.post(path, json=body)
    assert r.status_code == 403


def test_csrf_mismatch_rejected(client: TestClient) -> None:
    do_login(client)
    r = client.post("/api/admin/mode", json={"mode": "full_auto"},
                    headers={"X-CSRF-Token": "token-palsu"})
    assert r.status_code == 403


def test_admin_actions_work_with_login_and_csrf(client: TestClient,
                                                orch: Orchestrator) -> None:
    do_login(client)
    h = _csrf(client)
    r = client.post("/api/admin/jobs", json={"topic": "animal sounds"}, headers=h)
    assert r.status_code == 200
    job_id = r.json()["id"]
    orch.process_job(job_id)                               # jalan sampai gerbang 1
    assert client.get(f"/api/admin/jobs/{job_id}").json()["status"] == "awaiting_script_approval"
    r = client.post(f"/api/admin/jobs/{job_id}/approve-script", json={}, headers=h)
    assert r.status_code == 200 and r.json()["status"] == "voicing"
    # mode switch
    assert client.post("/api/admin/mode", json={"mode": "full_auto"},
                       headers=h).json()["mode"] == "full_auto"


def test_admin_job_detail_has_internal_data(client: TestClient, orch: Orchestrator) -> None:
    do_login(client)
    job = orch.create_job("x")
    orch.process_job(job.id)
    data = client.get(f"/api/admin/jobs/{job.id}").json()
    assert "artifacts" in data and "logs" in data and "safety_reviews" in data


# ------------------------------------------------------------ sesi kedaluwarsa
def test_expired_session_rejected(orch: Orchestrator) -> None:
    store = AdminStore(orch.config.data_dir / "admin.json")
    store.save(USER, hash_password(PW))
    auth = AuthService(admin=store,
                       sessions=SessionManager(secret=b"k", ttl_sec=0.3))
    with TestClient(create_app(orch, start_worker=False, auth=auth)) as client:
        do_login(client)
        assert client.get("/api/auth/status").json()["authenticated"] is True
        time.sleep(0.4)
        assert client.get("/api/auth/status").json()["authenticated"] is False


def test_tampered_session_cookie_rejected(client: TestClient) -> None:
    do_login(client)
    client.cookies.set(SESSION_COOKIE, "tampered.invalidsig")
    assert client.get("/api/admin/jobs").status_code == 401


# ------------------------------------------------------------ rate limit
def test_lockout_after_repeated_failures(client: TestClient) -> None:
    for _ in range(3):                                     # max_attempts=3
        assert do_login(client, pw="salah").status_code == 401
    # terkunci: password benar pun ditolak sementara
    r = do_login(client)
    assert r.status_code == 401 and "coba lagi" in r.json()["detail"].lower()


def test_rate_limit_resets_on_success() -> None:
    limiter = RateLimiter(max_attempts=3, lockout_sec=100)
    limiter.record_failure("ip")
    limiter.record_failure("ip")
    limiter.reset("ip")
    assert limiter.locked("ip") == 0


# ------------------------------------------------------------ halaman
def test_admin_page_served(client: TestClient) -> None:
    r = client.get("/admin")
    assert r.status_code == 200 and "Panel Admin" in r.text


def test_login_when_no_admin_configured(orch: Orchestrator) -> None:
    auth = AuthService(admin=AdminStore(orch.config.data_dir / "noadmin.json"),
                       sessions=SessionManager(secret=b"k"))
    with TestClient(create_app(orch, start_worker=False, auth=auth)) as client:
        assert client.get("/api/auth/status").json()["admin_configured"] is False
        # tidak bisa login (verifikasi tetap waktu-konstan, tidak crash)
        assert do_login(client).status_code == 401
