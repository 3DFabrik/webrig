# WebRig Frontend Plan

## Layout-Konzept

```
┌─────────────────────────────────────────────────────────────┐
│ 🔊 WebRig  │  ● Connected  │  👤 Patric  │  ⚙️ Admin  │ ⟲  │
├──────────┬──────────────────────────────────┬───────────────┤
│          │                                  │               │
│  VFO-A   │     ████████ S-Meter ████████    │    AUDIO      │
│ 145.500  │     S1═S3═S5═S7═S9═══+20═+40     │   AF ████     │
│   FM     │     ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░     │   RF ███      │
│          │     Peak: S7.3 (-103 dBm)        │   SQL ██      │
│  VFO-B   │                                  │               │
│ 438.725  │     [▓▓ Live Graph ▓▓]           │   🎤 TX       │
│   FM     │     ┄┄┄┄┄╱╲┄┄┄┄┄┄┄╲╱╲┄┄┄┄┄┄┄    │   Mic ██      │
│          │                                  │               │
├──────────┼──────────────────────────────────┤               │
│ Mode: FM │  Shift: -  Offs: -0.6  CTCSS:    │    PTT        │
│ Filter:W │  136.5 Hz                        │   ╔════╗      │
│          │                                  │   ║ TX ║      │
│ Macros:  │  Stationsliste:                  │   ╚════╝      │
│ [2m Sim] │  [DB0KÖ] [DB0SU] [DM0KÖ] ...    │               │
│ [70cm]   │                                  │               │
├──────────┴──────────────────────────────────┴───────────────┤
│ AGC: FAST │ NB: ██ │ Preamp: ON │ Att: OFF │ Split: OFF    │
└─────────────────────────────────────────────────────────────┘
```

## Module

### 1. Status-Leiste (Header)
- Verbindungsstatus (rigctld: grün/rot Dot)
- Aktiver User
- Admin-Button (nur Admins)
- Logout

### 2. VFO-Bereich (links)
- Große Frequenzanzeige (7-Segment monospaced)
- Klickbare Ziffern (Hoch/Runter pro Stelle)
- Tastatur-Eingabe
- VFO-A/B Toggle
- A=B Button
- Split Toggle + Anzeige
- Memory-Channel Anzeige

### 3. Mode & Filter
- Mode-Dropdown: FM, USB, LSB, AM, CW, RTTY, DIGI
- Filter/Bandbreite Selector

### 4. PTT
- Großer PTT-Button (rot, Touch + Spacebar)
- TX-Timeout Countdown
- TX/RX Status-LED

### 5. Repeater / Tones
- Shift: Simplex / + / -
- Offset-Eingabe (kHz)
- CTCSS-Tone Selector (67.0–254.1 Hz)
- DCS-Code Selector
- Tone-Squelch / Tone-Burst Umschaltung

### 6. S-Meter (mitte, groß)
- Analog-Balken S1 bis S9+60dB (IARU-Skala)
- Umschaltbar: S-Units | dBm | μV | Raw
- Digitale Präzisionsanzeige
- Raw-Wert Debug-Anzeige
- Peak-Hold-Nadel (Hold-Time 1-10s Slider)
- Average-Modus (gleitender Durchschnitt)
- Attack: Fast / Slow
- Live-Graph (scrollendes Line-Chart: 5min/30min/2h)
- Record Start/Stop + CSV/JSON Export
- Alarme: Schwellwert, Delta (QSB-Detektor)
- Kalibrierung (Admin): Offset & Scale, Wizard

### 7. Audio (rechts)
- AF-Gain Slider
- RF-Gain Slider
- Squelch Slider
- RX-Level-Meter
- Mic-Gain Slider
- TX-Level-Meter
- Mute Toggles
- Audio-Device-Selector (Admin)

### 8. Quick-Macros (links unten)
- Benutzerdefinierbare Preset-Buttons
- Pro User speicherbar
- Klick → setzt Frequenz+Mode+Tone

### 9. Stationsliste (mitte unten)
- Global für alle Geräte
- Pro Eintrag: Call, Name, Frequenz, Mode, Offset, CTCSS/DCS, Standort, Band
- Such- & Filterfunktion (Band, Mode, Region)
- Klick → übernimmt Werte ins Funkgerät
- Import/Export: CSV, Repeater-Book JSON
- Admin: CRUD; User: lesen+anwenden

### 10. Signal-Verarbeitung (Footer-Leiste)
- AGC-Selector: OFF/FAST/SLOW/SUPERFAST
- Noise-Blanker Slider
- Preamp Toggle
- Attenuator Toggle

### 11. Admin-Menü (modal/separate View)

#### 11.1 Schnittstellen
- Audio: RX/TX Device (ALSA), Sample-Rate, Test-Tone
- Serial/rigctld: Host:Port, Hamlib-Modell, Device, Baudrate
- PTT-Mode: Hamlib/Serial-RTS/Serial-DTR/VOX
- PTT-Serial-Port (falls separat)
- "Verbindung testen" Button

#### 11.2 Noise Cancelling / DSP
- Noise-Reduction Toggle + Stärke
- Notch-Filter (Auto oder manuelle Frequenz)
- Audio-Compressor für TX
- Equalizer 3-Band (Bass/Mid/Treble) RX+TX

#### 11.3 User-Verwaltung
- User hinzufügen/bearbeiten/löschen
- Admin-Flag
- Session-Timeout pro User
- Aktivitäts-Log

#### 11.4 System
- rigctld-Status + Neustart
- Audio-Geräte-Scan
- UDEV-Status
- Log-Viewer
- Server-Neustart

#### 11.5 S-Meter Kalibrierung
- Offset & Scale Regler
- Kalibrierungs-Wizard
- Speicherung pro Modell
