"""WebRig – TX Audio Pipeline: WebSocket → μ-law decode → aplay.

Receives μ-law audio from browser mic, plays through radio sound card.
"""

import asyncio
import logging
import struct
import subprocess

log = logging.getLogger(__name__)

# μ-law decode table
_ULAW_TO_PCM = [0] * 256
for i in range(256):
    u = ~i & 0xFF
    t = ((u & 0x0F) << 3) + 0x84
    t <<= (u >> 4) & 0x07
    _ULAW_TO_PCM[i] = (0x84 - t) if (u & 0x80) else (t - 0x84)


def ulaw_to_pcm(ulaw_data: bytes) -> bytes:
    """Decode μ-law bytes to 16-bit LE PCM."""
    n = len(ulaw_data)
    pcm = bytearray(n * 2)
    for i in range(n):
        val = _ULAW_TO_PCM[ulaw_data[i]]
        struct.pack_into('<h', pcm, i * 2, val)
    return bytes(pcm)


class TxPipeline:
    def __init__(self, device: str = "default"):
        self.device = device
        self._aplay = None
        self._clients = set()
        self._loop = None
        self.is_transmitting = False

    def set_device(self, device: str):
        self.device = device

    def start(self):
        self._loop = asyncio.get_event_loop()
        log.info("TX pipeline ready")

    def get_rx_clients(self):
        """Override or set this to return RX client set for relay."""
        return set()

    async def add_client(self, ws):
        self._clients.add(ws)
        log.info(f"TX client added, total: {len(self._clients)}")

    async def remove_client(self, ws):
        self._clients.discard(ws)
        if not self._clients:
            self._stop_aplay()
        log.info(f"TX client removed, total: {len(self._clients)}")

    async def handle_audio(self, ws, data: bytes):
        if not data:
            return

        if self._aplay is None or self._aplay.poll() is not None:
            self._start_aplay()

        pcm = ulaw_to_pcm(data)
        try:
            self._aplay.stdin.write(pcm)
            self._aplay.stdin.flush()
        except Exception as e:
            log.error(f"aplay write error: {e}")
            self._stop_aplay()

    def _start_aplay(self):
        try:
            self._aplay = subprocess.Popen(
                ['aplay', '-D', self.device, '-f', 'S16_LE', '-r', '8000', '-c', '1', '-t', 'raw'],
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.is_transmitting = True
            log.info(f"aplay started (device={self.device})")
        except Exception as e:
            log.error(f"Failed to start aplay: {e}")
            self._aplay = None

    def _stop_aplay(self):
        if self._aplay:
            try:
                self._aplay.stdin.close()
                self._aplay.terminate()
                self._aplay.wait(timeout=2)
            except Exception:
                self._aplay.kill()
            self._aplay = None
            self.is_transmitting = False
            log.info("aplay stopped")

    def stop(self):
        self._stop_aplay()
        self._clients.clear()
        log.info("TX pipeline stopped")
