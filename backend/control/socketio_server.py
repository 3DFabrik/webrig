"""WebRig – SocketIO server placeholder.

Real-time events between backend and frontend:
- smeter: S-Meter updates (200ms)
- frequency: VFO frequency changes
- mode: mode/passband changes
- vfo: VFO-A/B switches
- ptt: PTT state changes
- connection: radio connect/disconnect
"""

import logging

log = logging.getLogger(__name__)

# Placeholder — will use python-socketio
# sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

radio = None


def init_radio():
    """Initialize radio manager."""
    pass
