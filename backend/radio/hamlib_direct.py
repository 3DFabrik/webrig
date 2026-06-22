"""WebRig – Direct Hamlib backend.

Uses Python Hamlib bindings (python3-hamlib) to talk to the radio
directly over serial. No rigctld daemon, no TCP, no extra processes.

Universally works with any radio hamlib supports (200+ models).
"""

import asyncio
import logging
import time
from typing import Optional

import Hamlib

log = logging.getLogger(__name__)

# ─── Hamlib debug control ──────────────────────────────────────
Hamlib.rig_set_debug(Hamlib.RIG_DEBUG_NONE)

# ─── Mode name ↔ constant mapping ──────────────────────────────
_MODE_CONSTANTS = {}
for _name in dir(Hamlib):
    if _name.startswith("RIG_MODE_"):
        _const = getattr(Hamlib, _name)
        _short = _name.replace("RIG_MODE_", "")
        _MODE_CONSTANTS[_short] = _const

# Reverse: constant → short name
_MODE_NAMES = {v: k for k, v in _MODE_CONSTANTS.items()}

# ─── Level token cache ─────────────────────────────────────────
_LEVEL_TOKENS = {}
for _name in ['AF', 'RF', 'SQL', 'MICGAIN', 'VOXGAIN', 'NR', 'NB', 'COMP',
              'AGC', 'ATT', 'PREAMP', 'STRENGTH', 'RFPOWER', 'SWR',
              'RIT', 'XIT']:
    try:
        _LEVEL_TOKENS[_name] = Hamlib.rig_parse_level(_name)
    except Exception:
        pass

# ─── Function token cache ──────────────────────────────────────
_FUNC_CONSTANTS = {}
for _name in dir(Hamlib):
    if _name.startswith("RIG_FUNC_"):
        _short = _name.replace("RIG_FUNC_", "")
        _FUNC_CONSTANTS[_short] = getattr(Hamlib, _name)

# ─── VFO operation token cache ──────────────────────────────
_VFO_OP_CONSTANTS = {}
for _name in dir(Hamlib):
    if _name.startswith("RIG_OP_"):
        _short = _name.replace("RIG_OP_", "")
        _VFO_OP_CONSTANTS[_short] = getattr(Hamlib, _name)


def list_supported_models() -> dict:
    """Return {model_id: 'Mfg Model'} for all hamlib models."""
    # hamlib doesn't expose a clean iterator in Python; use known ranges
    models = {}
    for n in range(1, 5000):
        try:
            caps = Hamlib.rig_get_caps(n)
            if caps and caps.model_name:
                models[n] = f"{caps.mfg_name} {caps.model_name}"
        except Exception:
            pass
    return models


def find_model(name_or_id: str) -> int:
    """Find a hamlib model number by name (case-insensitive substring)."""
    # Direct numeric
    try:
        return int(name_or_id)
    except ValueError:
        pass
    # Search by name
    name_lower = name_or_id.lower()
    models = list_supported_models()
    for mid, mname in models.items():
        if name_lower in mname.lower():
            return mid
    raise ValueError(f"No hamlib model matching '{name_or_id}'")


class HamlibDirectClient:
    """Direct serial radio client using hamlib Python bindings.

    Drop-in replacement for RigctldClient — same method signatures,
    but no TCP socket, no rigctld process.
    """

    def __init__(self, model: int = 3087, port: str = "/dev/ttyACM1",
                 baud: int = 19200):
        self.model = model
        self.port = port
        self.baud = baud
        self.connected = False
        self._rig: Optional[Hamlib.Rig] = None
        self._lock = asyncio.Lock()

    async def connect(self) -> bool:
        try:
            self._rig = Hamlib.Rig(self.model)
            self._rig.set_conf("rig_pathname", self.port)
            self._rig.set_conf("serial_speed", str(self.baud))
            self._rig.open()
            self.connected = True
            mfg = self._rig.caps.mfg_name
            name = self._rig.caps.model_name
            log.info(f"Connected to {mfg} {name} via {self.port}@{self.baud}")
            return True
        except Exception as e:
            log.error(f"Failed to open radio: {e}")
            self.connected = False
            return False

    async def disconnect(self):
        if self._rig:
            try:
                self._rig.close()
            except Exception:
                pass
            self._rig = None
        self.connected = False

    def _run(self, func, *args):
        """Run blocking hamlib call in executor."""
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, func, *args)

    # ─── Frequency ────────────────────────────────────────────

    async def get_freq(self, vfo=None) -> int:
        def _do():
            try:
                if vfo:
                    return int(self._rig.get_freq(vfo))
                return int(self._rig.get_freq())
            except Exception:
                return 0
        return await self._run(_do)

    async def set_freq(self, freq_hz: int) -> bool:
        def _do():
            try:
                self._rig.set_freq(Hamlib.RIG_VFO_CURR, freq_hz)
                # Verify the radio accepted the frequency
                actual = int(self._rig.get_freq())
                if actual != freq_hz:
                    log.debug(f"set_freq rejected: sent {freq_hz}, got {actual}")
                    return False
                return True
            except Exception as e:
                log.debug(f"set_freq error: {e}")
                return False
        return await self._run(_do)

    # ─── Mode ─────────────────────────────────────────────────

    async def get_mode(self, vfo=None) -> tuple:
        """Returns (mode_name, passband_hz)."""
        def _do():
            try:
                if vfo:
                    result = self._rig.get_mode(vfo)
                else:
                    result = self._rig.get_mode()
                # result = [mode_const, width]
                mode_const, width = result[0], result[1]
                mode_name = _MODE_NAMES.get(mode_const, f"MODE_{mode_const}")
                return mode_name, int(width)
            except Exception as e:
                log.debug(f"get_mode error: {e}")
                return "FM", 0
        return await self._run(_do)

    async def set_mode(self, mode: str, passband: int = 0) -> bool:
        def _do():
            try:
                mode_const = _MODE_CONSTANTS.get(mode.upper())
                if mode_const is None:
                    log.warning(f"Unknown mode: {mode}")
                    return False
                self._rig.set_mode(mode_const)
                return True
            except Exception as e:
                log.debug(f"set_mode error: {e}")
                return False
        return await self._run(_do)

    # ─── VFO ──────────────────────────────────────────────────

    async def get_vfo(self) -> str:
        def _do():
            try:
                vfo = self._rig.get_vfo()
                # Map VFO constant to name
                for name in ['VFOA', 'VFOB', 'MEM', 'CURR']:
                    const = getattr(Hamlib, f'RIG_VFO_{name}', None)
                    if const is not None and vfo == const:
                        return name if name != 'CURR' else 'VFOA'
                return 'VFOA'
            except Exception:
                return 'VFOA'
        return await self._run(_do)

    async def set_vfo(self, vfo: str) -> bool:
        def _do():
            try:
                const = getattr(Hamlib, f'RIG_VFO_{vfo}', None)
                if const is None:
                    return False
                self._rig.set_vfo(const)
                return True
            except Exception:
                return False
        return await self._run(_do)

    async def get_freq_vfo(self, vfo: str) -> int:
        const = getattr(Hamlib, f'RIG_VFO_{vfo}', Hamlib.RIG_VFO_A)
        return await self.get_freq(const)

    async def get_mode_vfo(self, vfo: str) -> tuple:
        const = getattr(Hamlib, f'RIG_VFO_{vfo}', Hamlib.RIG_VFO_A)
        return await self.get_mode(const)

    # ─── PTT ──────────────────────────────────────────────────

    async def get_ptt(self) -> bool:
        def _do():
            try:
                return bool(self._rig.get_ptt(Hamlib.RIG_VFO_CURR))
            except Exception:
                return False
        return await self._run(_do)

    async def set_ptt(self, on: bool) -> bool:
        def _do():
            try:
                self._rig.set_ptt(Hamlib.RIG_VFO_CURR, 1 if on else 0)
                return True
            except Exception as e:
                log.debug(f"set_ptt error: {e}")
                return False
        return await self._run(_do)

    # ─── Split ────────────────────────────────────────────────

    async def get_split(self) -> bool:
        def _do():
            try:
                # get_split_vfo needs args: returns (split, tx_vfo)
                result = self._rig.get_split_vfo(Hamlib.RIG_VFO_CURR, 0)
                return bool(result[0]) if result else False
            except Exception:
                return False
        return await self._run(_do)

    async def set_split(self, on: bool) -> bool:
        def _do():
            try:
                if on:
                    self._rig.set_split_vfo(Hamlib.RIG_SPLIT_ON, Hamlib.RIG_VFO_B)
                else:
                    self._rig.set_split_vfo(Hamlib.RIG_SPLIT_OFF, Hamlib.RIG_VFO_A)
                return True
            except Exception as e:
                log.debug(f"set_split error: {e}")
                return False
        return await self._run(_do)

    # ─── Levels (AGC, AF, RF, SQL, MICGAIN, etc.) ────────────

    def _get_level_token(self, name: str):
        return _LEVEL_TOKENS.get(name.upper())

    async def get_level_float(self, name: str) -> float:
        """Get a float level (AF, RF, MICGAIN, STRENGTH, etc.)."""
        token = self._get_level_token(name)
        if token is None:
            return 0.0

        def _do():
            try:
                return float(self._rig.get_level_f(token))
            except Exception:
                try:
                    return float(self._rig.get_level_f(Hamlib.RIG_VFO_CURR, token))
                except Exception as e:
                    log.warning(f"get_level_f({name}) vfo fallback failed: {e}")
                    return 0.0
        return await self._run(_do)

    async def get_level_int(self, name: str) -> int:
        """Get an int level (AGC, ATT, PREAMP)."""
        token = self._get_level_token(name)
        if token is None:
            return 0

        def _do():
            try:
                return int(self._rig.get_level_i(token))
            except Exception:
                try:
                    return int(self._rig.get_level_i(Hamlib.RIG_VFO_CURR, token))
                except Exception as e:
                    log.warning(f"get_level_i({name}) vfo fallback failed: {e}")
                    return 0
        return await self._run(_do)

    async def set_level(self, name: str, value) -> bool:
        token = self._get_level_token(name)
        if token is None:
            return False

        def _do():
            try:
                self._rig.set_level(token, float(value))
                return True
            except Exception:
                try:
                    self._rig.set_level(Hamlib.RIG_VFO_CURR, token, float(value))
                    return True
                except Exception as e:
                    log.debug(f"set_level {name} error: {e}")
                    return False
        return await self._run(_do)

    # ─── S-Meter ──────────────────────────────────────────────

    async def get_smeter(self) -> float:
        """Get S-Meter in dB (relative to S9).

        STRENGTH is an integer level in hamlib (dB relative to S9),
        so we use get_level_i, not get_level_f.
        """
        token = self._get_level_token("STRENGTH")
        if token is None:
            return 0.0

        def _do():
            try:
                return float(self._rig.get_level_i(token))
            except Exception:
                try:
                    return float(self._rig.get_level_i(Hamlib.RIG_VFO_CURR, token))
                except Exception as e:
                    log.debug(f"get_smeter failed: {e}")
                    return 0.0
        return await self._run(_do)

    # ─── AGC ──────────────────────────────────────────────────

    async def get_agc(self) -> int:
        """Get AGC setting as integer (0=OFF, 1=SuperFast, 2=Fast, 3=Slow, etc.)."""
        return await self.get_level_int("AGC")

    async def set_agc(self, mode) -> bool:
        """Set AGC. Accepts int (hamlib enum) or str ('FAST', 'SLOW')."""
        if isinstance(mode, str) and not mode.isdigit():
            # Convert text to hamlib AGC enum value
            try:
                mode = Hamlib.rig_levelagcvalue(mode.upper())
            except Exception:
                mode = 2  # default Fast
        return await self.set_level("AGC", int(mode))

    # ─── AF / RF / SQL / MICGAIN / VOXGAIN / NR ──────────────

    async def get_af(self) -> float:
        return await self.get_level_float("AF")

    async def set_af(self, gain: float) -> bool:
        return await self.set_level("AF", gain)

    async def get_rf(self) -> float:
        return await self.get_level_float("RF")

    async def set_rf(self, gain: float) -> bool:
        return await self.set_level("RF", gain)

    async def get_sql(self) -> float:
        return await self.get_level_float("SQL")

    async def set_sql(self, level: float) -> bool:
        return await self.set_level("SQL", level)

    async def get_micgain(self) -> float:
        return await self.get_level_float("MICGAIN")

    async def set_micgain(self, gain: float) -> bool:
        return await self.set_level("MICGAIN", gain)

    async def get_voxgain(self) -> float:
        return await self.get_level_float("VOXGAIN")

    async def set_voxgain(self, gain: float) -> bool:
        return await self.set_level("VOXGAIN", gain)

    async def get_nr(self) -> float:
        return await self.get_level_float("NR")

    async def set_nr(self, level: float) -> bool:
        return await self.set_level("NR", level)

    # ─── Attenuator / Preamp ──────────────────────────────────

    def get_preamp_levels(self) -> list:
        """Return available preamp dB levels from caps (e.g. [10])."""
        if self._rig is None:
            return []
        try:
            return [p for p in self._rig.caps.preamp if p > 0]
        except Exception:
            return []

    def get_attenuator_levels(self) -> list:
        """Return available attenuator dB levels from caps (e.g. [12])."""
        if self._rig is None:
            return []
        try:
            return [a for a in self._rig.caps.attenuator if a > 0]
        except Exception:
            return []

    async def get_attenuator(self) -> bool:
        val = await self.get_level_int("ATT")
        return val > 0

    async def set_attenuator(self, on: bool, level: int = 0) -> bool:
        # If level specified, use it; otherwise toggle between 0 and first available
        levels = self.get_attenuator_levels()
        if level > 0:
            val = level
        elif levels and on:
            val = levels[0]
        else:
            val = 0
        return await self.set_level("ATT", val)

    async def get_preamp(self) -> bool:
        val = await self.get_level_int("PREAMP")
        return val > 0

    async def set_preamp(self, on: bool, level: int = 0) -> bool:
        # If level specified, use it; otherwise toggle between 0 and first available
        levels = self.get_preamp_levels()
        if level > 0:
            val = level
        elif levels and on:
            val = levels[0]
        else:
            val = 0
        return await self.set_level("PREAMP", val)

    # ─── NB (Noise Blanker) ──────────────────────────────────

    async def get_nb(self) -> float:
        return await self.get_level_float("NB")

    async def set_nb(self, level: float) -> bool:
        return await self.set_level("NB", level)

    # ─── SWR / ALC / RFPOWER ────────────────────────────────

    async def get_swr(self) -> float:
        return await self.get_level_float("SWR")

    async def get_alc(self) -> float:
        return await self.get_level_float("ALC")

    async def get_rfpower(self) -> float:
        return await self.get_level_float("RFPOWER")

    async def set_rfpower(self, val: float) -> bool:
        return await self.set_level("RFPOWER", val)

    # ─── Functions (NB, NR, ANF, etc. as toggles) ────────────

    async def get_func(self, name: str) -> bool:
        const = _FUNC_CONSTANTS.get(name.upper())
        if const is None:
            return False

        def _do():
            try:
                return bool(self._rig.get_func(const))
            except Exception:
                return False
        return await self._run(_do)

    async def set_func(self, name: str, on: bool) -> bool:
        const = _FUNC_CONSTANTS.get(name.upper())
        if const is None:
            return False

        def _do():
            try:
                self._rig.set_func(const, 1 if on else 0)
                return True
            except Exception:
                return False
        return await self._run(_do)

    def has_get_func(self, name: str) -> bool:
        """Check if the radio supports getting a function."""
        const = _FUNC_CONSTANTS.get(name.upper())
        if const is None or self._rig is None:
            return False
        try:
            return bool(self._rig.caps.has_get_func & const)
        except Exception:
            return False

    def has_set_func(self, name: str) -> bool:
        """Check if the radio supports setting a function."""
        const = _FUNC_CONSTANTS.get(name.upper())
        if const is None or self._rig is None:
            return False
        try:
            return bool(self._rig.caps.has_set_func & const)
        except Exception:
            return False

    # ─── VFO Operations (TUNE, CPY, XCHG, etc.) ──────────────

    async def vfo_op(self, name: str) -> bool:
        """Execute a VFO operation (e.g. TUNE)."""
        const = _VFO_OP_CONSTANTS.get(name.upper())
        if const is None:
            return False

        def _do():
            try:
                self._rig.vfo_op(Hamlib.RIG_VFO_CURR, const)
                return True
            except Exception as e:
                log.error(f"vfo_op({name}) failed: {e}")
                return False
        return await self._run(_do)

    def has_vfo_op(self, name: str) -> bool:
        """Check if the radio supports a VFO operation."""
        const = _VFO_OP_CONSTANTS.get(name.upper())
        if const is None or self._rig is None:
            return False
        try:
            return bool(self._rig.caps.vfo_ops & const)
        except Exception:
            return False

    # ─── Capability check ────────────────────────────────────

    def has_get_level(self, name: str) -> bool:
        """Check if the radio supports getting a level."""
        token = self._get_level_token(name)
        if token is None or self._rig is None:
            return False
        try:
            # Python binding has_get_level() returns None (broken SWIG),
            # but caps.has_get_level bitfield works
            return bool(self._rig.caps.has_get_level & token)
        except Exception:
            return False

    def has_set_level(self, name: str) -> bool:
        """Check if the radio supports setting a level."""
        token = self._get_level_token(name)
        if token is None or self._rig is None:
            return False
        try:
            return bool(self._rig.caps.has_set_level & token)
        except Exception:
            return False

    # ─── Raw level access (compat with old get_level) ────────

    async def get_level(self, name: str = "STRENGTH") -> float:
        """Generic level getter — tries float first, then int."""
        return await self.get_level_float(name)
