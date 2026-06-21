"""WebRig – Radio Manager (hamlib-direct).

Polls the radio via direct hamlib bindings, holds radio state,
and emits changes via callbacks (for SocketIO).
"""

import asyncio
import logging
import time
from typing import Optional, Callable, Awaitable

from backend.radio.hamlib_direct import HamlibDirectClient, find_model
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
        self.agc = 0
        self.nb = 0.0
        self.attenuator = False
        self.preamp = False
        # Per-VFO state
        self.vfo_a_freq = 0
        self.vfo_a_mode = "FM"
        self.vfo_a_passband = 0
        self.vfo_b_freq = 0
        self.vfo_b_mode = "FM"
        self.vfo_b_passband = 0


class RadioManager:
    """Manages radio connection and periodic polling via hamlib direct."""

    def __init__(self):
        model_id = get("radio.model_id", 3087)
        if isinstance(model_id, str):
            model_id = find_model(model_id)
        self.client = HamlibDirectClient(
            model=model_id,
            port=get("radio.serial_port", "/dev/ttyACM1"),
            baud=get("radio.serial_baud", 19200),
        )
        self.state = RadioState()
        self._running = False
        self._on_change: Optional[Callable[[str, object], Awaitable[None]]] = None
        self._smeter_interval = get("radio.poll_interval_ms", 200) / 1000
        self._freq_interval = get("radio.freq_poll_interval_ms", 1000) / 1000

    def on_change(self, callback):
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
        """Poll all state values once, including both VFOs."""
        try:
            self.state.frequency = await self.client.get_freq()
            self.state.mode, self.state.passband = await self.client.get_mode()
            self.state.vfo = await self.client.get_vfo()

            # Read both VFOs
            try:
                self.state.vfo_a_freq = await self.client.get_freq_vfo("VFOA")
                self.state.vfo_a_mode, self.state.vfo_a_passband = await self.client.get_mode_vfo("VFOA")
            except Exception:
                self.state.vfo_a_freq = self.state.frequency
                self.state.vfo_a_mode = self.state.mode
                self.state.vfo_a_passband = self.state.passband

            try:
                self.state.vfo_b_freq = await self.client.get_freq_vfo("VFOB")
                self.state.vfo_b_mode, self.state.vfo_b_passband = await self.client.get_mode_vfo("VFOB")
            except Exception:
                pass

            await self._emit("vfo_a", {"freq": self.state.vfo_a_freq,
                                       "mode": self.state.vfo_a_mode,
                                       "passband": self.state.vfo_a_passband})
            await self._emit("vfo_b", {"freq": self.state.vfo_b_freq,
                                       "mode": self.state.vfo_b_mode,
                                       "passband": self.state.vfo_b_passband})

            # Send available preamp/att levels to frontend
            await self._emit("rig_caps", {
                "preamp_levels": self.client.get_preamp_levels(),
                "att_levels": self.client.get_attenuator_levels(),
                "has_tuner": self.client.has_set_func("TUNER"),
            })

            # Read and emit secondary controls with capability checks
            # Some radios support set but not get for certain levels (e.g. X6100 PREAMP/ATT)
            for feature, getter, emitter, ctrl_id in [
                ("AGC", self.client.get_agc, lambda v: self._emit("agc", v), "agc-select"),
                ("PREAMP", self.client.get_preamp, lambda v: self._emit("preamp", v), "preamp-btn"),
                ("ATT", self.client.get_attenuator, lambda v: self._emit("attenuator", v), "att-btn"),
            ]:
                try:
                    if self.client.has_get_level(feature):
                        val = await getter()
                        await emitter(val)
                    else:
                        # Can set but not get — leave at default, frontend toggles locally
                        log.info(f"{feature}: radio doesn't support readback, toggle-only")
                except Exception:
                    log.debug(f"{feature}: capability check failed")

        except Exception as e:
            log.warning(f"Full poll error: {e}")

    async def _smeter_loop(self):
        """Fast loop: S-Meter only."""
        while self._running:
            if not self.state.connected:
                await asyncio.sleep(0.5)
                continue
            try:
                db = await self.client.get_smeter()
                if db != self.state.smeter_db:
                    self.state.smeter_db = db
                    await self._emit("smeter", db)
            except Exception as e:
                log.debug(f"SMeter poll error: {e}")
            await asyncio.sleep(self._smeter_interval)

    async def _state_loop(self):
        """Slow loop: freq, mode, vfo, ptt. Also monitors connection health."""
        fail_count = 0
        while self._running:
            if not self.state.connected:
                await asyncio.sleep(0.5)
                continue
            try:
                freq = await self.client.get_freq()
                if freq > 0:  # 0 means read error
                    fail_count = 0
                    if freq != self.state.frequency:
                        self.state.frequency = freq
                        await self._emit("frequency", freq)
                else:
                    raise Exception("get_freq returned 0")

                mode, pb = await self.client.get_mode()
                if mode != self.state.mode or pb != self.state.passband:
                    self.state.mode = mode
                    self.state.passband = pb
                    await self._emit("mode", {"mode": mode, "passband": pb})

                ptt = await self.client.get_ptt()
                if ptt != self.state.ptt:
                    self.state.ptt = ptt
                    await self._emit("ptt", ptt)

            except Exception as e:
                fail_count += 1
                log.warning(f"State poll error ({fail_count}): {e}")
                if fail_count >= 3:
                    log.error("Radio connection lost")
                    self.state.connected = False
                    await self._emit("connection", False)
                    await self._emit("radio_error", "Radio connection lost")
                    # Try to reconnect
                    asyncio.create_task(self._reconnect_loop())
            await asyncio.sleep(self._freq_interval)

    async def _reconnect_loop(self):
        """Attempt to reconnect to the radio every 3 seconds."""
        while self._running and not self.state.connected:
            await asyncio.sleep(3)
            try:
                log.info("Attempting radio reconnect...")
                await self.client.disconnect()
                ok = await self.client.connect()
                if ok:
                    log.info("Radio reconnected!")
                    self.state.connected = True
                    await self._emit("connection", True)
                    await self._emit("radio_reconnected", {})
                    await self._full_poll()
            except Exception as e:
                log.debug(f"Reconnect failed: {e}")

    # ─── Control methods ─────────────────────────────────────

    async def set_frequency(self, freq_hz: int):
        if await self.client.set_freq(freq_hz):
            self.state.frequency = freq_hz
            await self._emit("frequency", freq_hz)

    async def set_mode(self, mode: str, passband: int = 0):
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

    async def set_af(self, gain: float):
        if await self.client.set_af(gain):
            self.state.af_gain = gain

    async def set_rf(self, gain: float):
        if await self.client.set_rf(gain):
            self.state.rf_gain = gain

    async def set_sql(self, level: float):
        if await self.client.set_sql(level):
            self.state.sql_level = level

    async def set_agc(self, mode):
        if await self.client.set_agc(mode):
            self.state.agc = int(mode) if isinstance(mode, (int, str)) and str(mode).isdigit() else mode
            await self._emit("agc", int(mode) if str(mode).isdigit() else mode)

    async def set_nb(self, level: float):
        if await self.client.set_nb(level):
            self.state.nb = level

    async def set_attenuator(self, on: bool, level: int = 0):
        if await self.client.set_attenuator(on, level):
            self.state.attenuator = on
            await self._emit("attenuator", on)

    async def set_preamp(self, on: bool, level: int = 0):
        if await self.client.set_preamp(on, level):
            self.state.preamp = on
            await self._emit("preamp", on)
