from __future__ import annotations

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from ai_office.orchestrator import Orchestrator
from ai_office.web.api import create_app


@pytest.fixture
def client(orch: Orchestrator):
    with TestClient(create_app(orch, start_worker=False)) as c:
        yield c


def test_fake_job_reaches_done_visible_via_api(client: TestClient, orch: Orchestrator) -> None:
    """Kriteria selesai M0: job palsu berjalan sampai done dan statusnya terlihat lewat API."""
    orch.set_mode("full_auto")
    job = orch.create_job("mengenal warna")
    assert client.get(f"/api/jobs/{job.id}").json()["status"] == "queued"

    orch.process_job(job.id)

    data = client.get(f"/api/jobs/{job.id}").json()
    assert data["status"] == "done"
    assert data["title"] == "Ayo Belajar: Mengenal Warna!"
    assert "artifacts" not in data  # bagian publik tidak membocorkan data internal

    status = client.get("/api/status").json()
    assert status["summary"]["done_jobs"] == 1
    assert {a["agent"] for a in status["agents"]} == {
        "writer", "safety", "voice", "animator", "editor", "delivery"}


def test_unknown_job_404(client: TestClient) -> None:
    assert client.get("/api/jobs/999").status_code == 404


def test_security_headers(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'self'" in r.headers["Content-Security-Policy"]
    assert r.headers["X-Content-Type-Options"] == "nosniff"


def test_no_mutating_endpoints_in_m0(client: TestClient) -> None:
    assert client.post("/api/jobs", json={"topic": "x"}).status_code == 405


def test_index_served(client: TestClient) -> None:
    r = client.get("/")
    assert r.status_code == 200 and "AI Office" in r.text


def test_office_canvas_and_module_served(client: TestClient) -> None:
    """M7: dashboard publik memuat kantor 2.5D (canvas + modul office.js)."""
    index = client.get("/").text
    assert '<canvas id="office">' in index
    assert 'type="module"' in index
    office = client.get("/static/office.js")
    assert office.status_code == 200 and "class Office" in office.text
