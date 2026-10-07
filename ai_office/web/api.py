"""FastAPI app: bagian publik (hanya-baca, tanpa login) + bagian admin (wajib login).

Keamanan admin (lihat auth.py): sesi cookie HttpOnly+SameSite=Strict (+Secure saat HTTPS),
CSRF double-submit untuk request yang mengubah data, rate-limit login, cek sesi di SERVER untuk
SEMUA endpoint admin. Menyembunyikan tombol di frontend bukan keamanan.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..events import Event, EventBus
from ..models import InvalidTransition
from ..orchestrator import Orchestrator
from .auth import (
    CSRF_COOKIE,
    CSRF_HEADER,
    SESSION_COOKIE,
    AdminStore,
    AuthError,
    AuthService,
    RateLimiter,
    SessionManager,
    load_secret_key,
)

log = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"
SSE_KEEPALIVE_SEC = 15.0

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; media-src 'self'; "
        "style-src 'self'; script-src 'self'; connect-src 'self'; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    ),
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}


def build_auth(orchestrator: Orchestrator) -> AuthService:
    data_dir = orchestrator.config.data_dir
    secret = load_secret_key(fallback_file=data_dir / "session_secret.key")
    return AuthService(
        admin=AdminStore(data_dir / "admin.json"),
        sessions=SessionManager(secret=secret),
        limiter=RateLimiter(),
    )


def create_app(orchestrator: Orchestrator, start_worker: bool = True,
               auth: AuthService | None = None) -> FastAPI:
    auth = auth or build_auth(orchestrator)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if start_worker:
            orchestrator.start_worker()
        yield
        if start_worker:
            orchestrator.stop_worker()

    app = FastAPI(title="AI Office", lifespan=lifespan, docs_url=None, redoc_url=None,
                  openapi_url=None)
    app.state.orchestrator = orchestrator
    app.state.auth = auth

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response

    # ---------------------------------------------------- dependency auth
    def require_admin(request: Request) -> None:
        token = request.cookies.get(SESSION_COOKIE)
        if not auth.is_authenticated(token):
            raise HTTPException(status_code=401, detail="Perlu login admin")

    def require_csrf(request: Request) -> None:
        header = request.headers.get(CSRF_HEADER)
        cookie = request.cookies.get(CSRF_COOKIE)
        if not header or not cookie or not _consteq(header, cookie):
            raise HTTPException(status_code=403, detail="CSRF token tidak valid")

    secure_cookie = orchestrator.config.server.host not in ("127.0.0.1", "localhost", "::1")

    # ======================================================== publik
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return {"summary": orchestrator.summary(), "agents": orchestrator.tracker.snapshot()}

    @app.get("/api/jobs")
    def jobs(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
        return [j.public_dict() for j in orchestrator.db.list_jobs(limit=limit)]

    @app.get("/api/jobs/{job_id}")
    def job(job_id: int) -> dict[str, Any]:
        found = orchestrator.db.get_job(job_id)
        if found is None:
            raise HTTPException(status_code=404, detail="Job tidak ditemukan")
        return found.public_dict()

    @app.get("/api/events")
    async def events(request: Request) -> StreamingResponse:
        return await _sse_stream(orchestrator, request)

    # ======================================================== auth
    @app.get("/api/auth/status")
    def auth_status(request: Request) -> dict[str, Any]:
        logged_in = auth.is_authenticated(request.cookies.get(SESSION_COOKIE))
        return {"authenticated": logged_in, "admin_configured": auth.admin.exists()}

    @app.post("/api/auth/login")
    def login(request: Request, response: Response,
              payload: dict[str, str] = Body(...)) -> dict[str, Any]:
        username = str(payload.get("username", ""))
        password = str(payload.get("password", ""))
        client = request.client.host if request.client else "unknown"
        try:
            token = auth.login(username, password, rate_key=client)
        except AuthError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        csrf = auth.sessions.new_csrf()
        response.set_cookie(SESSION_COOKIE, token, httponly=True, samesite="strict",
                            secure=secure_cookie, max_age=int(auth.sessions.ttl_sec), path="/")
        response.set_cookie(CSRF_COOKIE, csrf, httponly=False, samesite="strict",
                            secure=secure_cookie, max_age=int(auth.sessions.ttl_sec), path="/")
        return {"ok": True, "csrf_token": csrf}

    @app.post("/api/auth/logout")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        auth.sessions.destroy(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, path="/")
        response.delete_cookie(CSRF_COOKIE, path="/")
        return {"ok": True}

    # ======================================================== admin
    @app.get("/api/admin/jobs", dependencies=[Depends(require_admin)])
    def admin_jobs(limit: int = Query(50, ge=1, le=200)) -> list[dict[str, Any]]:
        return [j.admin_dict() for j in orchestrator.db.list_jobs(limit=limit)]

    @app.get("/api/admin/jobs/{job_id}", dependencies=[Depends(require_admin)])
    def admin_job(job_id: int) -> dict[str, Any]:
        found = orchestrator.db.get_job(job_id)
        if found is None:
            raise HTTPException(status_code=404, detail="Job tidak ditemukan")
        return {**found.admin_dict(), "logs": orchestrator.db.get_logs(job_id),
                "safety_reviews": orchestrator.db.get_safety_reviews(job_id)}

    @app.get("/api/admin/settings", dependencies=[Depends(require_admin)])
    def get_settings() -> dict[str, Any]:
        c = orchestrator.config
        return {"mode": orchestrator.mode, "voice_engine": c.voice.engine,
                "llm_provider": c.llm.provider, "language": c.content.language,
                "delivery_dir": str(c.delivery_dir)}

    @app.post("/api/admin/jobs",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def create_job(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
        topic = str(payload.get("topic", "")).strip()
        if not topic:
            raise HTTPException(status_code=400, detail="Topik wajib diisi")
        job = orchestrator.create_job(
            topic, age_group=payload.get("age_group") or None,
            style=payload.get("style") or None, language=payload.get("language") or None)
        return job.admin_dict()

    @app.post("/api/admin/jobs/{job_id}/approve-script",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def approve_script(job_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        edited = payload.get("script")
        return _guard(lambda: orchestrator.approve_script(job_id, edited))

    @app.post("/api/admin/jobs/{job_id}/approve-final",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def approve_final(job_id: int) -> dict[str, Any]:
        return _guard(lambda: orchestrator.approve_final(job_id))

    @app.post("/api/admin/jobs/{job_id}/reject",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def reject(job_id: int, payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:
        return _guard(lambda: orchestrator.reject(job_id, str(payload.get("reason", ""))))

    @app.post("/api/admin/jobs/{job_id}/retry",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def retry(job_id: int) -> dict[str, Any]:
        return _guard(lambda: orchestrator.retry(job_id))

    @app.post("/api/admin/mode",
              dependencies=[Depends(require_admin), Depends(require_csrf)])
    def set_mode(payload: dict[str, str] = Body(...)) -> dict[str, Any]:
        mode = str(payload.get("mode", ""))
        try:
            orchestrator.set_mode(mode)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"mode": orchestrator.mode}

    # ---------------------------------------------------------- halaman
    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/admin", include_in_schema=False)
    def admin_page() -> FileResponse:
        return FileResponse(STATIC_DIR / "admin.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def _guard(fn: Any) -> dict[str, Any]:
    try:
        job = fn()
    except InvalidTransition as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return job.admin_dict()


def _consteq(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a, b)


async def _sse_stream(orchestrator: Orchestrator, request: Request) -> StreamingResponse:
    bus: EventBus = orchestrator.bus
    queue = bus.subscribe()

    async def stream() -> AsyncIterator[str]:
        try:
            snap = {"summary": orchestrator.summary(), "agents": orchestrator.tracker.snapshot()}
            yield _sse(Event(type="snapshot", data=snap))
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(queue.get(), SSE_KEEPALIVE_SEC)
                    yield _sse(event)
                except TimeoutError:
                    snap = {"summary": orchestrator.summary(),
                            "agents": orchestrator.tracker.snapshot()}
                    yield _sse(Event(type="snapshot", data=snap))
        finally:
            bus.unsubscribe(queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(event: Event) -> str:
    payload = json.dumps(event.to_dict(), ensure_ascii=False)
    return f"id: {event.id}\nevent: {event.type}\ndata: {payload}\n\n"
