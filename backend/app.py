"""WebRig – FastAPI Application."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from backend.config import load_config, get
from backend.utils.logging import setup_logging

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
TEMPLATES_DIR = FRONTEND_DIR / "templates"


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    setup_logging()
    logger.info("WebRig starting up")

    # TODO: init rigctld client, audio pipelines, socketio

    yield

    logger.info("Shutting down...")


app = FastAPI(title="WebRig", version="0.1.0", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key="CHANGE-ME")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ─── Health / Status ──────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}


# ─── Main Page ────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    html = (FRONTEND_DIR / "index.html").read_text()
    return HTMLResponse(content=html)


# ─── Static Files ─────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")
