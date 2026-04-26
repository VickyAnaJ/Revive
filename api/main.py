"""Revive api process (FastAPI). Hosts C5a, C5b, C5c, C5d, C11.

Per design §6d Architecture Quanta Q3.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

DATA_LOCAL_DIR = Path(__file__).parent.parent / "data" / "local"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure data/local/ exists on startup so C11 LocalSessionLog can write later (FR9).
    DATA_LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Revive API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Smoke test endpoint. Returns 200 if the api process is up."""
    return {
        "status": "ok",
        "version": app.version,
        "data_local_writable": str(DATA_LOCAL_DIR.exists() and os.access(DATA_LOCAL_DIR, os.W_OK)),
    }
