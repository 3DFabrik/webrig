"""WebRig – SocketIO server.

Real-time bidirectional communication between backend and frontend.
Handles all radio control commands and pushes state updates to clients.
"""

import asyncio
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
    async def on_set_preamp(sid, data):
        # data can be bool (toggle) or {on: bool, level: int}
        if isinstance(data, dict):
            await radio.set_preamp(bool(data.get("on", True)), int(data.get("level", 0)))
        else:
            await radio.set_preamp(bool(data))

    @sio.on("set_attenuator")
    async def on_set_attenuator(sid, data):
        if isinstance(data, dict):
            await radio.set_attenuator(bool(data.get("on", True)), int(data.get("level", 0)))
        else:
            await radio.set_attenuator(bool(data))

    @sio.on("set_tuner")
    async def on_set_tuner(sid, on):
        log.info(f"set_tuner received: on={on}, radio={radio is not None}")
        if radio is None:
            return
        if not on:
            await radio._emit("tuner", "off")
            return
        # Prefer RIG_OP_TUNE (VFO operation) — works for Icom IC-7300 etc.
        if radio.client.has_vfo_op("TUNE"):
            log.info("Using vfo_op(TUNE)")
            ok = await radio.client.vfo_op("TUNE")
            if ok:
                await radio._emit("tuner", "tuning")
                asyncio.create_task(_poll_tuner(radio))
            else:
                log.warning("vfo_op(TUNE) returned False")
                await radio._emit("tuner", "error")
            return
        # Fallback: set_func(TUNER) for radios that support it
        if radio.client.has_set_func("TUNER"):
            log.info("Using set_func(TUNER)")
            await radio.client.set_func("TUNER", True)
            await radio._emit("tuner", "tuning")
            asyncio.create_task(_poll_tuner(radio))
            return
        log.info("Radio does not support TUNE")
        await radio._emit("tuner", "unsupported")

    @sio.on("set_rfpower")
    async def on_set_rfpower(sid, val):
        await radio.client.set_rfpower(float(val))
        await radio._emit("rfpower", float(val))

    @sio.on("set_poll_rate")
    async def on_set_poll_rate(sid, ms):
        radio._smeter_interval = int(ms) / 1000
        log.info(f"SMeter poll rate set to {ms}ms")

    # Wire radio manager events → SocketIO broadcast
    async def on_radio_change(event, value):
        await sio.emit(event, value)

    radio.on_change(on_radio_change)

    return radio


async def _poll_tuner(radio):
    """Wait for ATU tuning to complete.
    Since we can't reliably poll tuner status on all radios,
    we use a fixed wait time (IC-7300 typically takes 2-5s)."""
    log = logging.getLogger(__name__)
    await asyncio.sleep(5)
    await radio._emit("tuner", "done")
    log.info("ATU tuning done (fixed wait)")


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
