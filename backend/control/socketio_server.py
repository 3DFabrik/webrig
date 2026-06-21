"""WebRig – SocketIO server.

Real-time bidirectional communication between backend and frontend.
Handles all radio control commands and pushes state updates to clients.
"""

import logging
import socketio as sio_module

from backend.radio.manager import RadioManager
from backend.config import get

log = logging.getLogger(__name__)

sio = sio_module.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
radio: RadioManager = None


def init_radio():
    """Initialize radio manager and wire up SocketIO events."""
    global radio
    radio = RadioManager()

    @sio.on("connect")
    async def on_connect(sid, environ):
        log.info(f"Client connected: {sid}")
        if radio.state.connected:
            await sio.emit("connection", True, to=sid)
            await _push_full_state(sid)

    @sio.on("disconnect")
    async def on_disconnect(sid):
        log.info(f"Client disconnected: {sid}")

    @sio.on("set_freq")
    async def on_set_freq(sid, freq):
        await radio.set_frequency(int(freq))

    @sio.on("set_mode")
    async def on_set_mode(sid, data):
        if isinstance(data, str):
            await radio.set_mode(data)
        elif isinstance(data, dict):
            await radio.set_mode(data.get("mode", "FM"), data.get("passband", 0))

    @sio.on("set_vfo")
    async def on_set_vfo(sid, vfo):
        await radio.set_vfo(vfo)

    @sio.on("set_ptt")
    async def on_set_ptt(sid, on):
        await radio.set_ptt(bool(on))

    @sio.on("set_split")
    async def on_set_split(sid, on):
        await radio.set_split(bool(on))

    @sio.on("set_rptr_shift")
    async def on_set_rptr_shift(sid, shift):
        await radio.set_rptr_shift(shift)

    @sio.on("set_rptr_offset")
    async def on_set_rptr_offset(sid, offset):
        await radio.set_rptr_offset(int(offset))

    @sio.on("set_ctcss")
    async def on_set_ctcss(sid, tone):
        await radio.set_ctcss(float(tone))

    @sio.on("set_dcs")
    async def on_set_dcs(sid, code):
        await radio.set_dcs(int(code))

    @sio.on("set_af")
    async def on_set_af(sid, gain):
        await radio.set_af(float(gain))

    @sio.on("set_micgain")
    async def on_set_micgain(sid, gain):
        await radio.client.set_micgain(float(gain))

    @sio.on("set_rf")
    async def on_set_rf(sid, gain):
        await radio.set_rf(float(gain))

    @sio.on("set_sql")
    async def on_set_sql(sid, level):
        await radio.set_sql(float(level))

    @sio.on("set_agc")
    async def on_set_agc(sid, mode):
        await radio.set_agc(mode)

    @sio.on("set_nb")
    async def on_set_nb(sid, level):
        await radio.set_nb(float(level))

    @sio.on("set_preamp")
    async def on_set_preamp(sid, on):
        await radio.set_preamp(bool(on))

    @sio.on("set_attenuator")
    async def on_set_attenuator(sid, on):
        await radio.set_attenuator(bool(on))

    @sio.on("set_poll_rate")
    async def on_set_poll_rate(sid, ms):
        radio._smeter_interval = int(ms) / 1000
        log.info(f"SMeter poll rate set to {ms}ms")

    # Wire radio manager events → SocketIO broadcast
    async def on_radio_change(event, value):
        await sio.emit(event, value)

    radio.on_change(on_radio_change)

    return radio


async def _push_full_state(sid):
    """Send current state to a newly connected client."""
    if not radio or not radio.state.connected:
        return
    await sio.emit("frequency", radio.state.frequency, to=sid)
    await sio.emit("mode", {"mode": radio.state.mode, "passband": radio.state.passband}, to=sid)
    await sio.emit("vfo", radio.state.vfo, to=sid)
    await sio.emit("ptt", radio.state.ptt, to=sid)
    await sio.emit("smeter", radio.state.smeter_db, to=sid)
    await sio.emit("vfo_a", {"freq": radio.state.vfo_a_freq,
                             "mode": radio.state.vfo_a_mode,
                             "passband": radio.state.vfo_a_passband}, to=sid)
    await sio.emit("vfo_b", {"freq": radio.state.vfo_b_freq,
                             "mode": radio.state.vfo_b_mode,
                             "passband": radio.state.vfo_b_passband}, to=sid)
    # Secondary controls
    try:
        await sio.emit("agc", await radio.client.get_agc(), to=sid)
    except Exception:
        pass
    try:
        if radio.client.has_get_level("PREAMP"):
            await sio.emit("preamp", await radio.client.get_preamp(), to=sid)
    except Exception:
        pass
    try:
        if radio.client.has_get_level("ATT"):
            await sio.emit("attenuator", await radio.client.get_attenuator(), to=sid)
    except Exception:
        pass
