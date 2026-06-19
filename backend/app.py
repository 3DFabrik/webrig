"""WebRig – FastAPI Application with SocketIO."""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
import socketio

from backend.config import load_config, get
from backend.utils.logging import setup_logging
from backend.control.socketio_server import init_radio, sio
import backend.control.socketio_server as _sio_mod

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    setup_logging()
    logger.info("WebRig starting up")

    # Initialize radio
    radio = init_radio()
    try:
        connected = await radio.connect()
        if connected:
            logger.info("Radio connected via rigctld")
        else:
            logger.warning("Radio not available — running without radio")
    except Exception as e:
        logger.error(f"Radio init failed: {e}")

    yield

    logger.info("Shutting down...")
    if radio:
        await radio.disconnect()
    logger.info("Goodbye!")


app = FastAPI(title="WebRig", version="0.1.0", lifespan=lifespan)

app.add_middleware(SessionMiddleware, secret_key="webrig-dev-secret-change-me")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# SocketIO ASGI wrapper
asgi_app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="socket.io")


# ─── Health / Status ──────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    radio = _sio_mod.radio
    if radio and radio.state.connected:
        return {"status": "ok", "radio": "connected", "version": "0.1.0"}
    return {"status": "degraded", "radio": "disconnected", "version": "0.1.0"}


@app.get("/api/status")
async def get_status():
    radio = _sio_mod.radio
    if not radio:
        return {"state": "disconnected"}
    s = radio.state
    return {
        "state": "connected" if s.connected else "disconnected",
        "frequency": s.frequency,
        "mode": s.mode,
        "passband": s.passband,
        "vfo": s.vfo,
        "ptt": s.ptt,
        "smeter_db": s.smeter_db,
        "split": s.split,
    }


# ─── Stations API ─────────────────────────────────────────────────

@app.get("/api/stations")
async def get_stations():
    stations_file = Path(__file__).parent.parent / "data" / "stations.json"
    if stations_file.exists():
        return json.loads(stations_file.read_text())
    return []


@app.post("/api/stations")
async def add_station(station: dict):
    stations_file = Path(__file__).parent.parent / "data" / "stations.json"
    stations = []
    if stations_file.exists():
        stations = json.loads(stations_file.read_text())
    stations.append(station)
    stations_file.parent.mkdir(parents=True, exist_ok=True)
    stations_file.write_text(json.dumps(stations, indent=2))
    return {"status": "ok"}


# ─── Main Page ────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_index(request: Request):
    html = (FRONTEND_DIR / "index.html").read_text()
    return HTMLResponse(content=html)


# ─── Static Files ─────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")
