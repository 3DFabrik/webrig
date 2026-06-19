"""WebRig – Audio TX pipeline placeholder.

Adapted from Q-Remote V3. WebSocket → ALSA playback.
Will be fleshed out with actual ALSA integration.
"""

import logging

log = logging.getLogger(__name__)


class TxPipeline:
    """Placeholder — WebSocket → ALSA playback."""

    def __init__(self):
        self._clients = {}

    def start(self):
        log.info("TX audio pipeline: start (stub)")

    def stop(self):
        log.info("TX audio pipeline: stop")

    async def add_client(self, ws):
        self._clients[ws] = None

    async def remove_client(self, ws):
        self._clients.pop(ws, None)

    async def handle_audio(self, ws, data: bytes):
        pass
