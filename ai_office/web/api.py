"""FastAPI app.

M0: hanya endpoint PUBLIK hanya-baca (status, daftar job, SSE).
Endpoint admin (membuat job, approve/reject, dsb.) ditambahkan di M6 bersama autentikasi.
Sementara itu aksi admin dilakukan lewat CLI lokal: `python -m ai_office.cli`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..events import Event, EventBus
from ..orchestrator import Orchestrator

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


def create_app(orchestrator: Orchestrator, start_worker: bool = True) -> FastAPI:
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

    @app.middleware("http")
    async def security_headers(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response

    # ---------------------------------------------------------- publik
    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return {
            "summary": orchestrator.summary(),
            "agents": orchestrator.tracker.snapshot(),
        }

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
        bus: EventBus = orchestrator.bus
        queue = bus.subscribe()

        async def stream() -> AsyncIterator[str]:
            try:
                snapshot = {"summary": orchestrator.summary(),
                            "agents": orchestrator.tracker.snapshot()}
                yield _sse(Event(type="snapshot", data=snapshot))
                while not await request.is_disconnected():
                    try:
                        event = await asyncio.wait_for(queue.get(), SSE_KEEPALIVE_SEC)
                        yield _sse(event)
                    except TimeoutError:
                        # keepalive + snapshot berkala (menangkap perubahan dari proses CLI)
                        snapshot = {"summary": orchestrator.summary(),
                                    "agents": orchestrator.tracker.snapshot()}
                        yield _sse(Event(type="snapshot", data=snapshot))
            finally:
                bus.unsubscribe(queue)

        return StreamingResponse(
            stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ---------------------------------------------------------- halaman
    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def _sse(event: Event) -> str:
    payload = json.dumps(event.to_dict(), ensure_ascii=False)
    return f"id: {event.id}\nevent: {event.type}\ndata: {payload}\n\n"
