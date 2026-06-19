# WebRig

Universelles Web-Interface für Funkgeräte über Hamlib (rigctld).

## Überblick

WebRig ist eine Web-Anwendung, die jedes Hamlib-kompatible Funkgerät über den Browser fernsteuerbar macht — Frequenz, Mode, PTT, Audio (RX/TX), S-Meter und mehr.

**Backend:** Python / FastAPI / SocketIO / rigctld
**Frontend:** HTML / JS / CSS (kein Framework, vanilla)

## Features (geplant)

- 📻 Universelle Hamlib-Anbindung (alle rigctld-Geräte)
- 🎛️ Frequenz- & Mode-Steuerung (VFO-A/B)
- 📊 S-Meter (real-time, inkl. manuellem S-Meter mit allen Funktionen)
- 📡 PTT (Push-To-Talk) über Hamlib / CAT / Serial
- 🔊 Audio RX/TX über WebSockets (ALSA)
- 💾 Memory-Kanal-Browser & Quick-Macros
- 🔐 Login & User-Management
- 📱 Mobile-friendly (Touch-Bedienung)

## Status

🚧 In Entwicklung — Projekt-Skeleton steht, Hardware-Testing folgt.

## Installation

```bash
# rigctld starten (gerätespezifisch)
rigctld -m <model> -r <device> -s <baudrate> -T 127.0.0.1 -t 4532

# WebRig starten
cd webrig
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:asgi_app --host 0.0.0.0 --port 8081
```

## Konfiguration

Siehe `config.yaml`. Eigene Anpassungen in `config.local.yaml` (gitignored).

## Authoren

- Patric (DF7ZZ)
- Norbot 🤖
