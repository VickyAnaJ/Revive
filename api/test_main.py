"""Smoke test for the api process. Closes 0.V15 (qualification ladder runnable)."""
from fastapi.testclient import TestClient

from .main import app


def test_health_returns_ok():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
