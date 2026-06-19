# WebRig – ToDo

## Projekt-Setup
- [x] Projekt-Skeleton (FastAPI, Config, Verzeichnisstruktur)
- [x] Git-Repo initialisiert (lokal, privat)
- [x] README.md
- [x] config.yaml Template
- [x] requirements.txt
- [x] rigctld Client (Backend, komplett)
- [x] Radio Manager (Backend, komplett)
- [ ] SocketIO Server (Backend)
- [ ] Auth-System (aus Q-Remote V3 adaptieren)
- [ ] .gitignore

## Backend – Radio
- [x] `rigctld.py` — TCP-Client mit allen Hamlib-Befehlen
- [x] `manager.py` — Polling, State-Management, Event-Callbacks
- [ ] SocketIO-Events: `smeter`, `frequency`, `mode`, `vfo`, `ptt`, `connection`
- [ ] SocketIO-Handler: `set_freq`, `set_mode`, `set_vfo`, `set_ptt`, etc.
- [ ] Verbindungstoleranz (Reconnect bei rigctld-Absturz)

## Backend – Audio
- [ ] `rx_pipeline.py` — ALSA Capture → WebSocket (aus V3 adaptieren)
- [ ] `tx_pipeline.py` — WebSocket → ALSA Playback (aus V3 adaptieren)
- [ ] Multi-Device-Support (AIOC, Soundkarte, USB-Audio)
- [ ] Squelch (aus V3 übernehmen)
- [ ] Audio-WebSocket-Routen in app.py

## Backend – Manuelles S-Meter
Das manuelle S-Meter ist ein Kern-Feature. Es geht über das bloße dB-Anzeigen hinaus:

- [ ] **Kalibrierung:** S-Meter-Rohwert → dBm-Kalibrierung pro Gerät
  - Offset und Scale einstellbar (jedes Funkgerät hat andere SMeter-Werte)
  - Kalibrierungs-Wizard: Referenzsignal bei bekanntem Pegel, dann Offset/Scale berechnen
  - Speicherung der Kalibrierung pro rigctld-Modell
- [ ] **S-Meter Skalen:**
  - S1-S9 in 6 dB Schritten (Standard IARU)
  - S9+10 bis S9+60 dB über S9
  - Umschaltbar: S-Units | dBm | μV (Feldstärke)
  - Anzeige der rohen Hamlib-STRENGTH-Werte zusätzlich
- [ ] **Peak-Hold / Average:**
  - Peak-Hold mit einstellbarer Hold-Time (1-10s)
  - Average-Modus (gleitender Durchschnitt, Fenstergröße einstellbar)
  - Quick/Slow Attack Umschaltung
- [ ] **Logging / Recording:**
  - S-Meter-Verlauf aufzeichnen (configurierbare Dauer: 5min, 30min, 2h)
  - CSV/JSON Export der Aufzeichnung
  - Live-Graph (Line-Chart) im Frontend
- [ ] **Alarme / Trigger:**
  - Signal-Schwellwert-Alarm (z.B. "Piepton wenn S-Meter > S7")
  - Delta-Alarm (plötzlicher Pegelabfall → QSB-Detektor)
  - Optional: Telegram-Benachrichtigung bei Trigger
- [ ] **Dual-SMeter (für Split-Betrieb):**
  - Separate S-Meter für TX und RX Frequenz (wenn Gerät unterstützt)
  - Umschaltbar TX/RX
- [ ] **Konfigurierbare Polling-Rate:**
  - Fast-Mode (100ms für Contest-Betrieb)
  - Normal (200ms, Standard)
  - Slow (500ms, Ressourcen-schonend)

## Backend – PTT
- [ ] PTT über Hamlib (`\set_ptt`)
- [ ] PTT über Serial RTS/DTR (für Geräte ohne CAT-PTT)
- [ ] PTT-Lock (Timeout-Schutz: automatisches Release nach X Sekunden)
- [ ] PTT via Frontend-Button + optional USB-Footswitch (GPIO)

## Frontend – Kern
- [ ] Layout: Header, Hauptbereich (Radio-Control), Footer
- [ ] Frequenzanzeige (groß, 7-Segment-Style oder Digital-LCD)
- [ ] Frequenz-Eingabe (Klick auf Ziffern + Tastatur)
- [ ] Mode-Dropdown (FM, USB, LSB, AM, CW, DIGI)
- [ ] VFO-A/B Toggle-Button
- [ ] Split-Anzeige
- [ ] PTT-Button (groß, rot, Touch-optimiert)
- [ ] Verbindungsstatus-Indicator (rigctld verbunden/getrennt)

## Frontend – S-Meter
- [ ] Analog-style Balken-Anzeige (S1 bis S9+60dB)
- [ ] Digitale dBm/dBμV Anzeige darunter
- [ ] Peak-Hold-Nadel (abfallend, einstellbare Geschwindigkeit)
- [ ] S-Meter Live-Graph (scrollend, wählbarer Zeitraum)
- [ ] Kalibrierungs-Panel (Admin)
- [ ] Aufnahme-Controls (Start/Stop/Export)
- [ ] Alarm-Konfiguration (Schwellwert, Aktivierung)
- [ ] S-Meter Raw-Wert Anzeige (Debug)

## Frontend – Erweitert
- [ ] Repeater-Shift-Selector (Simplex, +, -)
- [ ] Repeater-Offset Eingabe
- [ ] CTCSS/DCS Tone Selector
- [ ] AF/RF-Gain Slider
- [ ] Squelch Slider
- [ ] AGC-Selector (OFF/FAST/SLOW)
- [ ] Noise Blanker Slider
- [ ] Preamp / Attenuator Toggle
- [ ] Memory-Kanal-Browser (rigctld `\get_mem` / `\set_mem`)
- [ ] Quick-Macro-Buttons (benutzerdefinierbare Frequenz+Mode-Presets)
- [ ] Raw-CAT-Konsole (Power-User: sende beliebige CAT-Befehle)

## Frontend – Audio
- [ ] RX-Audio Streaming (WebSocket → WebAudio API)
- [ ] TX-Audio Streaming (Mic → WebSocket)
- [ ] Audio-Level-Meter (RX + TX)
- [ ] Mic-Gain-Regler
- [ ] Audio-Device-Selector (falls mehrere Soundkarten)

## Infrastruktur
- [ ] rigctld systemd-Service Template (pro Gerät)
- [ ] UDEV-Rules Template (stabile Device-Namen)
- [ ] Caddy-Reverse-Proxy Config (HTTPS, Domain)
- [ ] Deployment-Script für HamPi
- [ ] Auth: Login-Seite, Session-Management, User-Verwaltung

## Testing
- [ ] Backend-Tests (rigctld mock)
- [ ] Frontend-Tests
- [ ] Field-Test mit echtem Yaesu-Modell (folgt)
- [ ] Multi-User Test (mehrere Clients gleichzeitig)

## Nice-to-Have (später)
- [ ] DX-Cluster Integration (Spotting)
- [ ] APRS-Positionsanzeige
- [ ] Wasserfall/Spektrum (nur bei Geräten mit Panadapter)
- [ ] Bandscope
- [ ] Logging-Integration (QSO-Log)
- [ ] Mehrere Geräte gleichzeitig (Multi-Rig, mehrere rigctld-Instanzen)
