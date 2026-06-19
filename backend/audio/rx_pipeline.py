"""WebRig – Audio RX pipeline placeholder.

Adapted from Q-Remote V3. Streams ALSA capture → WebSocket clients.
Will be fleshed out with actual ALSA integration.
"""

import logging

log = logging.getLogger(__name__)


class RxPipeline:
    """Placeholder — ALSA capture → WebSocket relay."""

    def __init__(self):
        self._clients = set()
        self.squelch_enabled = True
        self.squelch_threshold = 300

    def start(self, loop):
        log.info("RX audio pipeline: start (stub)")

    def stop(self):
        log.info("RX audio pipeline: stop")

    def add_client(self, ws):
        self._clients.add(ws)

    def remove_client(self, ws):
        self._clients.discard(ws)
