"""WebRig – rigctld TCP client.

Communicates with rigctld (Hamlib daemon) over TCP.
This is the universal radio interface — no device-specific code here.
"""

import asyncio
import logging
from typing import Optional

log = logging.getLogger(__name__)


class RigctldClient:
    """Async TCP client for rigctld."""

    def __init__(self, host: str = "127.0.0.1", port: int = 4532):
        self.host = host
        self.port = port
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self.connected = False
        self._lock = asyncio.Lock()

    async def connect(self) -> bool:
        try:
            self._reader, self._writer = await asyncio.open_connection(
                self.host, self.port
            )
            self.connected = True
            log.info(f"Connected to rigctld at {self.host}:{self.port}")
            return True
        except Exception as e:
            log.error(f"Failed to connect to rigctld: {e}")
            self.connected = False
            return False

    async def disconnect(self):
        self.connected = False
        if self._writer:
            self._writer.close()
            try:
                await self._writer.wait_closed()
            except Exception:
                pass
        self._reader = None
        self._writer = None

    async def _send(self, command: str, n_lines: int = 1) -> str:
        """Send raw command and return response (1 line by default).

        Some rigctld commands return multiple lines (e.g. \\get_mode
        returns mode + passband on separate lines). Use n_lines to read
        them all.
        """
        if not self.connected or not self._writer:
            raise ConnectionError("rigctld not connected")
        async with self._lock:
            self._writer.write((command + "\n").encode())
            await self._writer.drain()
            lines = []
            for _ in range(n_lines):
                raw = await self._reader.readline()
                lines.append(raw.decode().strip())
            return "\n".join(lines) if n_lines > 1 else (lines[0] if lines else "")

    # ─── High-level commands ──────────────────────────────────────

    async def get_freq(self) -> int:
        """Get current VFO frequency in Hz."""
        resp = await self._send("\\get_freq")
        try:
            return int(resp)
        except (ValueError, TypeError):
            log.warning(f"get_freq unexpected response: {resp!r}")
            return 0

    async def set_freq(self, freq_hz: int) -> bool:
        """Set VFO frequency."""
        resp = await self._send(f"\\set_freq {freq_hz}")
        return resp == "RPRT 0"

    async def get_mode(self) -> tuple[str, int]:
        """Get current mode and passband. Returns (mode, bandwidth_hz).

        rigctld returns two lines: mode, then passband.
        """
        resp = await self._send("\\get_mode", n_lines=2)
        lines = resp.split("\n")
        if len(lines) >= 2:
            mode = lines[0].strip()
            try:
                passband = int(lines[1].strip())
            except ValueError:
                passband = 0
            return mode, passband
        elif len(lines) == 1 and lines[0]:
            return lines[0].strip(), 0
        return "FM", 0

    async def set_mode(self, mode: str, passband: int = 0) -> bool:
        """Set mode (FM, USB, LSB, AM, CW, etc.)."""
        cmd = f"\\set_mode {mode}"
        if passband > 0:
            cmd += f" {passband}"
        resp = await self._send(cmd)
        return resp == "RPRT 0"

    async def get_vfo(self) -> str:
        """Get active VFO (VFOA, VFOB, MEM)."""
        return await self._send("\\get_vfo")

    async def set_vfo(self, vfo: str) -> bool:
        """Set active VFO."""
        resp = await self._send(f"\\set_vfo {vfo}")
        return resp == "RPRT 0"

    async def get_ptt(self) -> bool:
        """Get PTT status. Returns True if transmitting."""
        resp = await self._send("\\get_ptt")
        return resp == "1"

    async def set_ptt(self, on: bool) -> bool:
        """Engage or release PTT."""
        resp = await self._send(f"\\set_ptt {1 if on else 0}")
        return resp == "RPRT 0"

    async def get_level(self, level: str = "STRENGTH") -> float:
        """Get signal level. Default: raw S-Meter strength."""
        resp = await self._send(f"\\get_level {level}")
        try:
            return float(resp)
        except ValueError:
            return 0.0

    async def get_smeter(self) -> float:
        """Get S-Meter in dB (via SQL or STRENGTH)."""
        # STRENGTH returns dB relative to S9
        return await self.get_level("STRENGTH")

    async def get_info(self) -> dict:
        """Get rig info (model, firmware)."""
        resp = await self._send("\\get_info")
        return {"info": resp}

    async def send_raw(self, cmd: str) -> str:
        """Send raw CAT command (passthrough)."""
        return await self._send(cmd)

    async def get_split(self) -> bool:
        """Check if split mode is active."""
        resp = await self._send("\\get_split")
        return resp == "1"

    async def set_split(self, on: bool) -> bool:
        """Enable/disable split mode."""
        resp = await self._send(f"\\set_split {1 if on else 0}")
        return resp == "RPRT 0"

    async def get_rptr_shift(self) -> str:
        """Get repeater shift (NONE, +, -)."""
        return await self._send("\\get_rptr_shift")

    async def set_rptr_shift(self, shift: str) -> bool:
        """Set repeater shift (NONE, +, -)."""
        resp = await self._send(f"\\set_rptr_shift {shift}")
        return resp == "RPRT 0"

    async def get_rptr_offset(self) -> int:
        """Get repeater offset in Hz."""
        resp = await self._send("\\get_rptr_offs")
        try:
            return int(resp)
        except ValueError:
            return 0

    async def set_rptr_offset(self, offset_hz: int) -> bool:
        """Set repeater offset."""
        resp = await self._send(f"\\set_rptr_offs {offset_hz}")
        return resp == "RPRT 0"

    async def get_ctcss_sql(self) -> float:
        """Get CTCSS squelch tone in Hz."""
        resp = await self._send("\\get_ctcss_sql")
        try:
            return float(resp)
        except ValueError:
            return 0.0

    async def set_ctcss_sql(self, tone_hz: float) -> bool:
        """Set CTCSS squelch tone."""
        resp = await self._send(f"\\set_ctcss_sql {tone_hz}")
        return resp == "RPRT 0"

    async def get_dcs_sql(self) -> int:
        """Get DCS squelch code."""
        resp = await self._send("\\get_dcs_sql")
        try:
            return int(resp)
        except ValueError:
            return 0

    async def set_dcs_sql(self, code: int) -> bool:
        """Set DCS squelch code."""
        resp = await self._send(f"\\set_dcs_sql {code}")
        return resp == "RPRT 0"

    async def get_af(self) -> float:
        """Get AF gain."""
        return await self.get_level("AF")

    async def set_af(self, gain: float) -> bool:
        """Set AF gain."""
        resp = await self._send(f"\\set_level AF {gain}")
        return resp == "RPRT 0"

    async def get_rf(self) -> float:
        """Get RF gain."""
        return await self.get_level("RF")

    async def set_rf(self, gain: float) -> bool:
        """Set RF gain."""
        resp = await self._send(f"\\set_level RF {gain}")
        return resp == "RPRT 0"

    async def get_sql(self) -> float:
        """Get squelch level."""
        return await self.get_level("SQL")

    async def set_sql(self, level: float) -> bool:
        """Set squelch level."""
        resp = await self._send(f"\\set_level SQL {level}")
        return resp == "RPRT 0"

    async def get_agc(self) -> str:
        """Get AGC setting."""
        return await self._send("\\get_level AGC")

    async def set_agc(self, mode: str) -> bool:
        """Set AGC (OFF, FAST, SLOW, SUPERFAST, USERSLOW)."""
        resp = await self._send(f"\\set_level AGC {mode}")
        return resp == "RPRT 0"

    async def get_nb(self) -> float:
        """Get noise blanker level."""
        return await self.get_level("NB")

    async def set_nb(self, level: float) -> bool:
        """Set noise blanker level."""
        resp = await self._send(f"\\set_level NB {level}")
        return resp == "RPRT 0"

    async def get_attenuator(self) -> bool:
        """Get attenuator status."""
        resp = await self._send("\\get_level ATT")
        return resp not in ("0", "OFF")

    async def set_attenuator(self, on: bool) -> bool:
        """Set attenuator on/off."""
        resp = await self._send(f"\\set_level ATT {1 if on else 0}")
        return resp == "RPRT 0"

    async def get_preamp(self) -> bool:
        """Get preamp status."""
        resp = await self._send("\\get_level PREAMP")
        return resp not in ("0", "OFF")

    async def set_preamp(self, on: bool) -> bool:
        """Set preamp on/off."""
        resp = await self._send(f"\\set_level PREAMP {1 if on else 0}")
        return resp == "RPRT 0"
