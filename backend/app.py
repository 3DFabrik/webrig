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
import re

from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from starlette.middleware.sessions import SessionMiddleware
import socketio

from backend.config import load_config, get
from backend.utils.logging import setup_logging
from backend.control.socketio_server import init_radio, sio
import backend.control.socketio_server as _sio_mod
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

    # Migrate flat config → profiles if radios.yaml doesn't exist
    from backend.profiles import load_profiles, migrate_from_flat_config
    profiles = load_profiles()
    if not profiles.get("radios"):
        logger.info("No profiles found — migrating from flat config")
        flat = {
            "radio": get("radio", {}),
            "audio": get("audio", {}),
            "ptt": get("ptt", {}),
        }
        migrate_from_flat_config(flat)


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
            logger.info("Radio connected")
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
    """Save config to config.local.yaml (backward compat).
    Also updates the active radio profile if one exists."""
    import yaml
    body = await request.json()

    # If this is a profile-aware save (has _profile_id)
    profile_id = body.pop("_profile_id", None)
    if profile_id:
        from backend.profiles import update_profile, get_profile
        existing = get_profile(profile_id) or {}
        profile = {
            "name": existing.get("name", profile_id),
            "model_id": body.get("radio", {}).get("model_id", 1),
            "serial_port": body.get("radio", {}).get("serial_port", "/dev/ttyUSB0"),
            "serial_baud": body.get("radio", {}).get("serial_baud", 19200),
            "data_bits": body.get("radio", {}).get("data_bits", 8),
            "stop_bits": body.get("radio", {}).get("stop_bits", 1),
            "parity": body.get("radio", {}).get("parity", "None"),
            "flow_control": body.get("radio", {}).get("flow_control", "None"),
            "audio": body.get("audio", {}),
            "ptt": body.get("ptt", {}),
        }
        try:
            update_profile(profile_id, profile)
        except ValueError:
            pass  # profile might not exist yet

    # Still save flat config for backward compat
    cfg_path = Path(__file__).parent.parent / "config.local.yaml"
    cfg_path.write_text(yaml.dump(body, default_flow_style=False))
    return {"status": "ok"}


@app.post("/api/config/apply")
async def apply_config(request: Request):
    """Save config, reconnect radio with new settings."""
    import yaml
    body = await request.json()

    # Save
    cfg_path = Path(__file__).parent.parent / "config.local.yaml"
    cfg_path.write_text(yaml.dump(body, default_flow_style=False))

    # Reload config in memory
    load_config()

    # Disconnect existing radio
    if _sio_mod.radio:
        await _sio_mod.radio.disconnect()

    # Reconnect with new config
    from backend.radio.manager import RadioManager
    radio = RadioManager()
    _sio_mod.radio = radio
    # Wire up events
    async def on_radio_change(event, value):
        await sio.emit(event, value)
    radio.on_change(on_radio_change)

    ok = await radio.connect()
    return {"status": "ok" if ok else "error",
            "radio": "connected" if ok else "failed to connect"}


@app.post("/api/radio/test")
async def test_radio(request: Request):
    """Test radio connection with given params without saving."""
    from backend.radio.hamlib_direct import HamlibDirectClient
    body = await request.json()
    model = int(body.get("model_id", body.get("model", 1)))
    device = body.get("serial_port", body.get("device", "/dev/ttyUSB0"))
    baud = int(body.get("serial_baud", body.get("baudrate", 9600)))

    client = HamlibDirectClient(model=model, port=device, baud=baud)
    ok = await client.connect()
    if ok:
        info = f"Connected to {client._rig.caps.mfg_name} {client._rig.caps.model_name}"
        await client.disconnect()
        return {"ok": True, "info": info}
    return {"ok": False, "error": "Connection failed"}


# ─── Radio Profile Management ───────────────────────────

@app.get("/api/radios")
async def list_radios():
    """List all radio profiles."""
    from backend.profiles import load_profiles
    data = load_profiles()
    # Add id to each profile for frontend
    result = []
    for pid, profile in data.get("radios", {}).items():
        entry = {"id": pid, **profile}
        # Mark if connected (matches active radio)
        entry["active"] = (pid == data.get("active"))
        result.append(entry)
    return {"radios": result, "active": data.get("active")}


@app.post("/api/radios")
async def create_radio(request: Request):
    """Create a new radio profile."""
    from backend.profiles import create_profile
    body = await request.json()
    profile_id = body.get("id", "")
    name = body.get("name", profile_id)
    if not profile_id:
        return JSONResponse({"error": "id required"}, status_code=400)
    profile = {
        "name": name,
        "model_id": body.get("model_id", 1),
        "serial_port": body.get("serial_port", "/dev/ttyUSB0"),
        "serial_baud": body.get("serial_baud", 19200),
        "data_bits": body.get("data_bits", 8),
        "stop_bits": body.get("stop_bits", 1),
        "parity": body.get("parity", "None"),
        "flow_control": body.get("flow_control", "None"),
        "audio": body.get("audio", {}),
        "ptt": body.get("ptt", {}),
    }
    try:
        data = create_profile(profile_id, profile)
        return {"status": "ok", "data": data}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=409)


@app.put("/api/radios/{profile_id}")
async def update_radio(profile_id: str, request: Request):
    """Update an existing radio profile."""
    from backend.profiles import update_profile
    body = await request.json()
    profile = {
        "name": body.get("name", profile_id),
        "model_id": body.get("model_id", 1),
        "serial_port": body.get("serial_port", "/dev/ttyUSB0"),
        "serial_baud": body.get("serial_baud", 19200),
        "data_bits": body.get("data_bits", 8),
        "stop_bits": body.get("stop_bits", 1),
        "parity": body.get("parity", "None"),
        "flow_control": body.get("flow_control", "None"),
        "audio": body.get("audio", {}),
        "ptt": body.get("ptt", {}),
    }
    try:
        data = update_profile(profile_id, profile)
        return {"status": "ok", "data": data}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=404)


@app.delete("/api/radios/{profile_id}")
async def delete_radio(profile_id: str):
    """Delete a radio profile."""
    from backend.profiles import delete_profile
    try:
        data = delete_profile(profile_id)
        return {"status": "ok", "data": data}
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


@app.post("/api/radios/{profile_id}/connect")
async def connect_radio(profile_id: str):
    """Switch to a radio profile and connect."""
    from backend.profiles import get_profile, set_active, profile_to_flat
    profile = get_profile(profile_id)
    if not profile:
        return JSONResponse({"error": f"Profile '{profile_id}' not found"}, status_code=404)

    # Set as active
    set_active(profile_id)

    # Convert to flat config and reconnect
    flat = profile_to_flat(profile)
    cfg_path = Path(__file__).parent.parent / "config.local.yaml"
    import yaml
    cfg_path.write_text(yaml.dump(flat, default_flow_style=False))
    load_config()

    # Disconnect existing
    if _sio_mod.radio:
        await _sio_mod.radio.disconnect()

    # Reconnect
    from backend.radio.manager import RadioManager
    radio = RadioManager()
    _sio_mod.radio = radio
    async def on_radio_change(event, value):
        await sio.emit(event, value)
    radio.on_change(on_radio_change)
    ok = await radio.connect()
    return {"status": "ok" if ok else "error",
            "radio": "connected" if ok else "failed",
            "active": profile_id}


@app.post("/api/radios/{profile_id}/test")
async def test_radio_profile(profile_id: str):
    """Test connection for a specific profile (read-only, no save)."""
    from backend.profiles import get_profile
    from backend.radio.hamlib_direct import HamlibDirectClient
    profile = get_profile(profile_id)
    if not profile:
        return JSONResponse({"error": f"Profile '{profile_id}' not found"}, status_code=404)

    client = HamlibDirectClient(
        model=int(profile.get("model_id", 1)),
        port=profile.get("serial_port", "/dev/ttyUSB0"),
        baud=int(profile.get("serial_baud", 9600)),
    )
    ok = await client.connect()
    if ok:
        info = f"Connected to {client._rig.caps.mfg_name} {client._rig.caps.model_name}"
        await client.disconnect()
        return {"ok": True, "info": info}
    return {"ok": False, "error": "Connection failed"}


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


def _parse_alsa_devices(output: str):
    """Parse `aplay -l` / `arecord -l` output into structured device list.

    Returns list of dicts:
      {hw: 'hw:CARD=0,DEV=0', card: 0, device: 0,
       name: 'USB Audio CODEC', subdevices: 1}
    """
    devices = []
    for line in output.splitlines():
        # Example: "card 0: Codec [USB Audio CODEC], device 0: ..."
        m = re.match(
            r'card\s+(\d+):\s+(.+?)\s+\[(.+?)\],\s+device\s+(\d+):',
            line
        )
        if m:
            card_num = int(m.group(1))
            card_id = m.group(2).strip()
            card_name = m.group(3).strip()
            dev_num = int(m.group(4))
            devices.append({
                "hw": f"hw:CARD={card_num},DEV={dev_num}",
                "card": card_num,
                "device": dev_num,
                "card_id": card_id,
                "name": card_name,
                "label": f"[{card_num}] {card_name} (dev {dev_num})",
            })
    return devices


@app.get("/api/audio/devices")
async def audio_devices():
    """Scan for ALSA audio devices with readable names."""
    capture = []
    playback = []
    try:
        proc = subprocess.run(["arecord", "-l"], capture_output=True, text=True, timeout=5)
        capture = _parse_alsa_devices(proc.stdout)
    except Exception:
        pass
    try:
        proc = subprocess.run(["aplay", "-l"], capture_output=True, text=True, timeout=5)
        playback = _parse_alsa_devices(proc.stdout)
    except Exception:
        pass
    return {
        "capture": capture,
        "playback": playback,
        "default": "default",
    }


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
