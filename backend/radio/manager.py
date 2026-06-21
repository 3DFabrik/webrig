"""WebRig – Radio Manager.

Polls rigctld at configurable intervals, holds radio state,
and emits changes via callbacks (for SocketIO).
"""

import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable

from backend.radio.rigctld import RigctldClient
from backend.config import get

log = logging.getLogger(__name__)


class RadioState:
    """Snapshot of current radio state."""

    def __init__(self):
        self.connected = False
        self.frequency = 0
        self.mode = "FM"
        self.passband = 0
        self.vfo = "VFOA"
        self.split = False
        self.ptt = False
        self.smeter_db = 0.0
        self.smeter_raw = 0.0
        self.rptr_shift = "NONE"
        self.rptr_offset = 0
        self.ctcss = 0.0
        self.dcs = 0
        self.af_gain = 0.0
        self.rf_gain = 0.0
        self.sql_level = 0.0
        self.agc = "OFF"
        self.nb = 0.0
        self.attenuator = False
        self.preamp = False


class RadioManager:
    """Manages radio connection and periodic polling."""

    def __init__(self):
        self.client = RigctldClient(
            host=get("radio.rigctld_host", "127.0.0.1"),
            port=get("radio.rigctld_port", 4532),
        )
        self.state = RadioState()
        self._running = False
        self._on_change: Optional[Callable[[str, object], Awaitable[None]]] = None
        self._smeter_interval = get("radio.poll_interval_ms", 200) / 1000
        self._freq_interval = get("radio.freq_poll_interval_ms", 1000) / 1000

    def on_change(self, callback):
        """Register async callback: callback(event_name, value)"""
        self._on_change = callback

    async def _emit(self, event: str, value):
        if self._on_change:
            try:
                await self._on_change(event, value)
            except Exception as e:
                log.error(f"Callback error for {event}: {e}")

    async def connect(self) -> bool:
        ok = await self.client.connect()
        self.state.connected = ok
        if ok:
            await self._full_poll()
            self._running = True
            asyncio.create_task(self._smeter_loop())
            asyncio.create_task(self._state_loop())
        await self._emit("connection", ok)
        return ok

    async def disconnect(self):
        self._running = False
        await self.client.disconnect()
        self.state.connected = False
        await self._emit("connection", False)

    async def _full_poll(self):
        """Poll all state values once."""
        try:
            self.state.frequency = await self.client.get_freq()
            self.state.mode, self.state.passband = await self.client.get_mode()
            self.state.vfo = await self.client.get_vfo()
        except Exception as e:
            log.warning(f"Full poll error: {e}")

    async def _smeter_loop(self):
        """Fast loop: S-Meter only (200ms default)."""
        while self._running:
            if not self.client.connected:
                await asyncio.sleep(0.5)
                continue
            try:
                db = await self.client.get_smeter()
                if db != self.state.smeter_db:
                    self.state.smeter_db = db
                    await self._emit("smeter", db)
                self.state.smeter_raw = await self.client.get_level("RAWSTRENGTH")
            except Exception as e:
                log.debug(f"SMeter poll error: {e}")
            await asyncio.sleep(self._smeter_interval)

    async def _state_loop(self):
        """Slow loop: freq, mode, vfo, ptt (1s default)."""
        while self._running:
            if not self.client.connected:
                await asyncio.sleep(0.5)
                continue
            try:
                freq = await self.client.get_freq()
                if freq != self.state.frequency:
                    self.state.frequency = freq
                    await self._emit("frequency", freq)

                mode, pb = await self.client.get_mode()
                if mode != self.state.mode or pb != self.state.passband:
                    self.state.mode = mode
                    self.state.passband = pb
                    await self._emit("mode", {"mode": mode, "passband": pb})

                ptt = await self.client.get_ptt()
                if ptt != self.state.ptt:
                    self.state.ptt = ptt
                    await self._emit("ptt", ptt)

                vfo = await self.client.get_vfo()
                if vfo != self.state.vfo:
                    self.state.vfo = vfo
                    await self._emit("vfo", vfo)

            except Exception as e:
                log.debug(f"State poll error: {e}")
            await asyncio.sleep(self._freq_interval)

    # ─── Control methods (called by SocketIO handlers) ────────────

    async def set_frequency(self, freq_hz: int):
        if await self.client.set_freq(freq_hz):
            self.state.frequency = freq_hz
            await self._emit("frequency", freq_hz)

    async def set_mode(self, mode: str, passband: int = 0):
        # Keep current passband if none specified (hamlib requires it)
        if passband <= 0:
            passband = self.state.passband
        if await self.client.set_mode(mode, passband):
            self.state.mode = mode
            self.state.passband = passband
            await self._emit("mode", {"mode": mode, "passband": passband})

    async def set_ptt(self, on: bool):
        if await self.client.set_ptt(on):
            self.state.ptt = on
            await self._emit("ptt", on)

    async def set_vfo(self, vfo: str):
        if await self.client.set_vfo(vfo):
            self.state.vfo = vfo
            await self._emit("vfo", vfo)

    async def set_split(self, on: bool):
        if await self.client.set_split(on):
            self.state.split = on
            await self._emit("split", on)

    async def set_rptr_shift(self, shift: str):
        if await self.client.set_rptr_shift(shift):
            self.state.rptr_shift = shift
            await self._emit("rptr_shift", shift)

    async def set_rptr_offset(self, offset_hz: int):
        if await self.client.set_rptr_offset(offset_hz):
            self.state.rptr_offset = offset_hz
            await self._emit("rptr_offset", offset_hz)

    async def set_ctcss(self, tone_hz: float):
        if await self.client.set_ctcss_sql(tone_hz):
            self.state.ctcss = tone_hz
            await self._emit("ctcss", tone_hz)

    async def set_dcs(self, code: int):
        if await self.client.set_dcs_sql(code):
            self.state.dcs = code
            await self._emit("dcs", code)

    async def set_af(self, gain: float):
        if await self.client.set_af(gain):
            self.state.af_gain = gain
            await self._emit("af", gain)

    async def set_rf(self, gain: float):
        if await self.client.set_rf(gain):
            self.state.rf_gain = gain
            await self._emit("rf", gain)

    async def set_sql(self, level: float):
        if await self.client.set_sql(level):
            self.state.sql_level = level
            await self._emit("sql", level)

    async def set_agc(self, mode: str):
        if await self.client.set_agc(mode):
            self.state.agc = mode
            await self._emit("agc", mode)

    async def set_nb(self, level: float):
        if await self.client.set_nb(level):
            self.state.nb = level
            await self._emit("nb", level)

    async def set_attenuator(self, on: bool):
        if await self.client.set_attenuator(on):
            self.state.attenuator = on
            await self._emit("attenuator", on)

    async def set_preamp(self, on: bool):
        if await self.client.set_preamp(on):
            self.state.preamp = on
            await self._emit("preamp", on)
