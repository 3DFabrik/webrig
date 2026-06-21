"""WebRig – FastAPI Application with SocketIO."""

import asyncio
import json
import logging
import subprocess
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
from backend.radio.rigctld_manager import rigctld_mgr
from backend.audio.rx_pipeline import RxPipeline
from backend.audio.tx_pipeline import TxPipeline

rx_audio = RxPipeline()
tx_audio = TxPipeline()

logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_config()
    setup_logging()
    logger.info("WebRig starting up")

    # Initialize audio pipelines
    rx_device = get("audio.device_rx", "default")
    tx_device = get("audio.device_tx", "default")
    rx_audio.device = rx_device
    tx_audio.device = tx_device
    rx_audio.squelch_enabled = get("audio.squelch_enabled", True)
    rx_audio.squelch_threshold = get("audio.squelch_threshold", 300)
    rx_audio.start(asyncio.get_event_loop())
    tx_audio.start()
    logger.info(f"Audio RX started (device={rx_device}), TX ready (device={tx_device})")

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
    rx_audio.stop()
    tx_audio.stop()
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
        "vfo_a": {"freq": s.vfo_a_freq, "mode": s.vfo_a_mode, "passband": s.vfo_a_passband},
        "vfo_b": {"freq": s.vfo_b_freq, "mode": s.vfo_b_mode, "passband": s.vfo_b_passband},
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


# ─── Config / Setup API ──────────────────────────────────────────

@app.get("/api/config")
async def get_config():
    """Return current radio/audio/ptt config."""
    import yaml
    cfg_path = Path(__file__).parent.parent / "config.yaml"
    local_path = Path(__file__).parent.parent / "config.local.yaml"
    cfg = yaml.safe_load(cfg_path.read_text()) or {}
    if local_path.exists():
        local = yaml.safe_load(local_path.read_text()) or {}
        # shallow merge top-level keys
        for k, v in local.items():
            if k in cfg and isinstance(cfg[k], dict) and isinstance(v, dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    return cfg


@app.post("/api/config")
async def save_config(request: Request):
    """Save config to config.local.yaml."""
    import yaml
    body = await request.json()
    cfg_path = Path(__file__).parent.parent / "config.local.yaml"
    cfg_path.write_text(yaml.dump(body, default_flow_style=False))
    return {"status": "ok"}


@app.post("/api/config/apply")
async def apply_config(request: Request):
    """Save config, restart rigctld, reconnect radio."""
    import yaml
    body = await request.json()

    # Save
    cfg_path = Path(__file__).parent.parent / "config.local.yaml"
    cfg_path.write_text(yaml.dump(body, default_flow_style=False))

    # Reload config in memory
    load_config()

    radio_cfg = body.get("radio", {})
    model = int(radio_cfg.get("model", 1))
    device = radio_cfg.get("device", "/dev/ttyUSB0")
    baudrate = int(radio_cfg.get("baudrate", 9600))
    host = radio_cfg.get("rigctld_host", "127.0.0.1")
    port = int(radio_cfg.get("rigctld_port", 4532))
    data_bits = int(radio_cfg.get("data_bits", 8))
    stop_bits = int(radio_cfg.get("stop_bits", 1))
    parity = radio_cfg.get("parity", "None")
    flow = radio_cfg.get("flow_control", "None")

    # Stop existing rigctld + radio
    if _sio_mod.radio:
        await _sio_mod.radio.disconnect()
    rigctld_mgr.stop()

    # Start rigctld with new params
    started = rigctld_mgr.start(model, device, baudrate, host, port,
                                 data_bits, stop_bits, parity, flow)
    if not started:
        return {"status": "error", "error": "Failed to start rigctld"}

    # Reconnect radio manager
    import time
    time.sleep(0.5)
    if _sio_mod.radio:
        ok = await _sio_mod.radio.connect()
        return {"status": "ok" if ok else "error",
                "radio": "connected" if ok else "failed to connect"}

    return {"status": "ok", "radio": "rigctld started"}


@app.post("/api/rigctld/test")
async def test_rigctld(request: Request):
    """Test rigctld connection with given params without saving.

    The test stops the running rigctld; the manager restarts it
    automatically afterwards. We also reconnect the radio manager
    so the frontend resumes receiving data.
    """
    body = await request.json()
    result = rigctld_mgr.test_connection(
        model=int(body.get("model", 1)),
        device=body.get("device", "/dev/ttyUSB0"),
        baudrate=int(body.get("baudrate", 9600)),
    )

    # Give rigctld a moment to come back up, then reconnect radio manager
    if rigctld_mgr.is_running():
        import asyncio as _aio
        await _aio.sleep(1.0)
        if _sio_mod.radio and not _sio_mod.radio.client.connected:
            try:
                await _sio_mod.radio.disconnect()
                await _sio_mod.radio.connect()
                logger.info("Radio manager reconnected after test")
            except Exception as e:
                logger.warning(f"Radio manager reconnect failed: {e}")

    return result


@app.get("/api/rigctld/status")
async def rigctld_status():
    """Check if rigctld is running."""
    return {"running": rigctld_mgr.is_running()}


@app.post("/api/rigctld/stop")
async def rigctld_stop():
    """Stop rigctld."""
    if _sio_mod.radio:
        await _sio_mod.radio.disconnect()
    rigctld_mgr.stop()
    return {"status": "stopped"}


# ─── Audio WebSocket Endpoints ────────────────────────────

@app.websocket("/audio/rx")
async def audio_rx_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("RX audio WebSocket client connected")
    rx_audio.add_client(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"RX audio WS error: {e}")
    finally:
        rx_audio.remove_client(websocket)
        logger.info("RX audio WebSocket client disconnected")


@app.websocket("/audio/tx")
async def audio_tx_ws(websocket: WebSocket):
    await websocket.accept()
    logger.info("TX audio WebSocket client connected")
    await tx_audio.add_client(websocket)
    try:
        while True:
            data = await websocket.receive_bytes()
            await tx_audio.handle_audio(websocket, data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"TX audio WS error: {e}")
    finally:
        await tx_audio.remove_client(websocket)
        logger.info("TX audio WebSocket client disconnected")


@app.get("/api/serial/ports")
async def serial_ports():
    """List available serial ports."""
    import glob
    ports = []
    # Common serial device patterns
    for pattern in ["/dev/ttyUSB*", "/dev/ttyACM*", "/dev/ttyS*", "/dev/ttyAMA*"]:
        for p in sorted(glob.glob(pattern)):
            try:
                import os
                # Try to get device info via sysfs
                basename = os.path.basename(p)
                sysfs = f"/sys/class/tty/{basename}/device/../uevent"
                desc = p
                if os.path.exists(sysfs):
                    with open(sysfs) as f:
                        for line in f:
                            if line.startswith("PRODUCT=") or line.startswith("HID_NAME="):
                                desc = f"{p} ({line.strip().split('=',1)[1]})"
                                break
                ports.append({"device": p, "label": desc})
            except Exception:
                ports.append({"device": p, "label": p})
    return {"ports": ports}


@app.get("/api/audio/devices")
async def audio_devices():
    """Scan for ALSA audio devices."""
    result = []
    try:
        proc = subprocess.run(
            ["arecord", "-l"],
            capture_output=True, text=True, timeout=5
        )
        for line in proc.stdout.splitlines():
            if "card" in line.lower():
                result.append(line.strip())
    except Exception:
        pass
    # Also list pcm devices
    try:
        proc = subprocess.run(
            ["aplay", "-l"],
            capture_output=True, text=True, timeout=5
        )
        playback = []
        for line in proc.stdout.splitlines():
            if "card" in line.lower():
                playback.append(line.strip())
        return {"capture": result, "playback": playback}
    except Exception:
        return {"capture": result, "playback": []}


@app.get("/api/rig/models")
async def rig_models():
    """Return all supported Hamlib models for dropdown population."""
    try:
        proc = subprocess.run(
            ["rigctl", "-l"],
            capture_output=True, text=True, timeout=5
        )
        models = []
        for line in proc.stdout.splitlines()[2:]:  # skip header
            parts = line.split(None, 4)
            if len(parts) >= 4:
                model_id = int(parts[0])
                mfg = parts[1]
                name = parts[2]
                version = parts[3] if len(parts) > 3 else ""
                models.append({
                    "id": model_id,
                    "mfg": mfg,
                    "name": name,
                    "label": f"{mfg} {name}",
                })
        return {"models": models, "count": len(models)}
    except Exception as e:
        return {"models": [], "count": 0, "error": str(e)}
