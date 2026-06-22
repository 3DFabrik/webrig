"""
WebRig – Universal Capabilities Scanner

Scans all Hamlib Level/Func/VFO-Op/Parm constants for a given radio.
Returns capabilities + current values in a single dict.

This is the single source of truth for what a radio can do.
The frontend uses this to enable/disable/generate controls dynamically.
"""

import Hamlib
import logging

log = logging.getLogger(__name__)

# ─── Meta-constants to skip ────────────────────────────
_SKIP_LEVELS = {
    "RIG_LEVEL_FLOAT_LIST", "RIG_LEVEL_READONLY_LIST",
    "RIG_LEVEL_IS_FLOAT", "RIG_LEVEL_IS_INT",
    "RIG_LEVEL_SETTING", "RIG_LEVEL_NONE",
}
_SKIP_PARMS = {
    "RIG_PARM_FLOAT_LIST", "RIG_PARM_READONLY_LIST",
    "RIG_PARM_IS_FLOAT", "RIG_PARM_IS_INT",
    "RIG_PARM_SETTING", "RIG_PARM_NONE",
}
_SKIP_FUNCS = {"RIG_FUNC_NONE"}

# ─── TX-only levels (return garbage during RX) ─────────
_TX_ONLY_LEVELS = {
    "SWR", "ALC", "COMP_METER", "RFPOWER_METER",
    "RFPOWER_METER_WATTS",
}

# ─── Read-only levels (display only, no set) ───────────
_READONLY_LEVELS = {
    "STRENGTH", "RAWSTR", "SWR", "ALC", "COMP_METER",
    "RFPOWER_METER", "RFPOWER_METER_WATTS",
    "TEMP_METER", "VD_METER", "ID_METER",
}

# ─── Known int levels ──────────────────────────────────
_INT_LEVELS = {
    "AGC", "PREAMP", "ATT", "NB", "NR", "KEYSPD",
    "COMP", "VOXGAIN", "ANTIVOX", "BKINDL", "AGC_TIME",
    "SPECTRUM_MODE", "SPECTRUM_AVG", "SPECTRUM_SPEED",
    "METER", "BAND_SELECT", "USB_AF_INPUT",
}

# ─── Human-readable labels (DE) ────────────────────────
LEVEL_LABELS = {
    "AF": "Lautstärke", "RF": "RF Gain", "SQL": "Rauschsperre",
    "RFPOWER": "Sendeleistung", "MICGAIN": "Mikrofonverstärkung",
    "AGC": "AGC", "PREAMP": "Vorverstärker", "ATT": "Dämpfungsglied",
    "NR": "Noise Reduction", "NB": "Noise Blanker",
    "COMP": "Kompressor", "VOXGAIN": "VOX Gain", "ANTIVOX": "Anti-VOX",
    "KEYSPD": "CW Tempo (WPM)", "CWPITCH": "CW Tonhöhe",
    "NOTCHF": "Notch Frequenz", "NOTCHF_RAW": "Notch (Raw)",
    "PBT_IN": "PBT Inner", "PBT_OUT": "PBT Outer",
    "IF": "IF Shift", "APF": "Audio Peak Filter",
    "BALANCE": "Balance", "SLOPE_HIGH": "Filter High",
    "SLOPE_LOW": "Filter Low", "AGC_TIME": "AGC Time",
    "BKINDL": "Break-in Delay", "BKIN_DLYMS": "Break-in Delay (ms)",
    "MONITOR_GAIN": "Monitor Gain", "VOXDELAY": "VOX Delay",
    "STRENGTH": "Signalstärke", "RAWSTR": "Raw Signal",
    "SWR": "SWR", "ALC": "ALC", "COMP_METER": "Kompressions-Meter",
    "RFPOWER_METER": "Leistung (dB)", "RFPOWER_METER_WATTS": "Leistung (W)",
    "TEMP_METER": "Temperatur", "VD_METER": "Spannung",
    "ID_METER": "Strom", "METER": "Messwahl",
    "USB_AF": "USB Audio", "USB_AF_INPUT": "USB Audio Input",
    "BAND_SELECT": "Band-Auswahl",
    "SPECTRUM_ATT": "Spektrum Dämpfung", "SPECTRUM_AVG": "Spektrum Avg",
    "SPECTRUM_EDGE_HIGH": "Spektrum High", "SPECTRUM_EDGE_LOW": "Spektrum Low",
    "SPECTRUM_MODE": "Spektrum Mode", "SPECTRUM_REF": "Spektrum Ref",
    "SPECTRUM_SPAN": "Spektrum Span", "SPECTRUM_SPEED": "Spektrum Speed",
}

FUNC_LABELS = {
    "NB": "Noise Blanker", "NB2": "Noise Blanker 2",
    "NR": "Noise Reduction", "ANF": "Auto Notch",
    "APF": "Audio Peak Filter", "AFLT": "Audio Low Filter",
    "AIP": "RF Preamp", "FAGC": "Fast AGC",
    "DUAL_WATCH": "Dual Watch", "DIVERSITY": "Diversity",
    "COMP": "Speech Kompressor", "VOX": "VOX",
    "MON": "Monitor", "FBKIN": "Full Break-in",
    "SBKIN": "Half Break-in", "TUNER": "Antennentuner",
    "LOCK": "Sperre", "RIT": "RIT", "XIT": "XIT",
    "SATMODE": "Satellitenmodus", "SYNC": "Sync",
    "SLICE": "Slice", "BC": "Beat Cancel", "BC2": "Beat Cancel 2",
    "REV": "Reverse", "TONE": "Tone", "TSQL": "Tone SQL",
    "CSQL": "CTCSS SQL", "DSQL": "DCS SQL",
    "TBURST": "Tone Burst", "VSC": "Voice Storage",
    "AFC": "AFC", "ARO": "Auto Repeater Offset",
    "SCOPE": "Scope", "SPECTRUM": "Spektrum",
    "SPECTRUM_HOLD": "Spektrum Hold", "SCEN": "Scene",
    "ABM": "Auto Band Memory", "ANL": "ANL",
    "TRANSCEIVE": "Transceive", "SEND_MORSE": "Morse senden",
    "SEND_VOICE_MEM": "Voice Memo", "OVF_STATUS": "Overflow Status",
    "RESUME": "Resume", "MBC": "Multi-Band Charge",
    "MUTE": "Stummschaltung", "RF": "RF",
}

VFO_OP_LABELS = {
    "UP": "VFO ↑", "DOWN": "VFO ↓",
    "BAND_UP": "Band ↑", "BAND_DOWN": "Band ↓",
    "TOGGLE": "A/B", "CPY": "A→B", "XCHG": "A⇄B",
    "FROM_VFO": "From VFO", "TO_VFO": "To VFO",
    "MCL": "Memory Clear", "TUNE": "ATU Tune",
    "LEFT": "← Left", "RIGHT": "→ Right",
}

PARM_LABELS = {
    "APO": "Auto Power Off", "BACKLIGHT": "Beleuchtung",
    "BEEP": "Piepton", "BAT": "Batterie",
    "TIME": "Uhrzeit", "KEYERTYPE": "Keyer-Typ",
    "ANN": "Annoncen", "AFIF": "Audio IF",
    "AFIF_ACC": "Audio IF (ACC)", "AFIF_LAN": "Audio IF (LAN)",
    "AFIF_WLAN": "Audio IF (WLAN)", "BANDSELECT": "Band-Auswahl",
    "KEYLIGHT": "Tastaturbeleuchtung", "SCREENSAVER": "Bildschirmschoner",
}

# ─── AGC option values (common across radios) ──────────
AGC_OPTIONS = {
    0: "OFF", 1: "Super Fast", 2: "Fast",
    3: "Slow", 4: "Medium", 5: "User",
}

# ─── Select-type int levels (dropdown instead of slider) ──
_SELECT_LEVELS = {
    "AGC": AGC_OPTIONS,
    "METER": {0: "Meter A", 1: "Meter B", 2: "Meter C", 3: "Center"},
    "BAND_SELECT": {},  # dynamic
    "SPECTRUM_MODE": {0: "Center", 1: "Fixed", 2: "Scroll", 3: "Waterfall"},
    "USB_AF_INPUT": {0: "Off", 1: "Mic", 2: "Data", 3: "Mixed"},
}


def scan_caps(rig) -> dict:
    """
    Scan all capabilities of a Hamlib Rig object.
    Returns levels, funcs, vfo_ops, parms with can_get/can_set flags.
    Does NOT read current values — use read_all_values() for that.
    """
    caps = rig.caps
    result = {
        "levels": {},
        "funcs": {},
        "vfo_ops": [],
        "parms": {},
        "preamp_levels": [p for p in caps.preamp if p > 0],
        "att_levels": [a for a in caps.attenuator if a > 0],
    }

    # ─── Levels ──────────────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_LEVEL_") or name in _SKIP_LEVELS:
            continue
        short = name.replace("RIG_LEVEL_", "")
        if short.isdigit():
            continue
        token = getattr(Hamlib, name)
        can_get = bool(caps.has_get_level & token)
        can_set = bool(caps.has_set_level & token)
        if can_get or can_set:
            result["levels"][short] = {
                "can_get": can_get,
                "can_set": can_set,
                "is_int": short in _INT_LEVELS,
                "tx_only": short in _TX_ONLY_LEVELS,
                "readonly": short in _READONLY_LEVELS,
                "label": LEVEL_LABELS.get(short, short),
                "ui_type": _level_ui_type(short, can_set),
            }

    # ─── Funcs ───────────────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_FUNC_") or name in _SKIP_FUNCS:
            continue
        short = name.replace("RIG_FUNC_", "")
        token = getattr(Hamlib, name)
        can_get = bool(caps.has_get_func & token)
        can_set = bool(caps.has_set_func & token)
        if can_get or can_set:
            result["funcs"][short] = {
                "can_get": can_get,
                "can_set": can_set,
                "label": FUNC_LABELS.get(short, short),
            }

    # ─── VFO Operations ──────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_OP_"):
            continue
        short = name.replace("RIG_OP_", "")
        if short == "NONE":
            continue
        token = getattr(Hamlib, name)
        if caps.vfo_ops & token:
            result["vfo_ops"].append({
                "name": short,
                "label": VFO_OP_LABELS.get(short, short),
            })

    # ─── Parms ───────────────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_PARM_") or name in _SKIP_PARMS:
            continue
        short = name.replace("RIG_PARM_", "")
        token = getattr(Hamlib, name)
        can_get = bool(caps.has_get_parm & token)
        can_set = bool(caps.has_set_parm & token)
        if can_get or can_set:
            result["parms"][short] = {
                "can_get": can_get,
                "can_set": can_set,
                "label": PARM_LABELS.get(short, short),
            }

    return result


def _level_ui_type(short: str, can_set: bool) -> str:
    """Determine which UI control to use for a level."""
    if short in _READONLY_LEVELS or not can_set:
        return "display"
    if short in _SELECT_LEVELS:
        return "select"
    return "slider"


async def read_all_values(rig, caps_data: dict) -> dict:
    """
    Read all gettable values from the radio.
    Returns {level_name: value, "_func_<name>": value, "_parm_<name>": value}.
    """
    values = {}

    # ─── Levels ──────────────────────────────────────────
    for short, info in caps_data["levels"].items():
        if not info["can_get"]:
            continue
        if info.get("tx_only"):
            values[short] = None
            continue
        token = Hamlib.rig_parse_level(short)
        if token is None:
            continue
        try:
            if info.get("is_int"):
                try:
                    values[short] = int(rig.get_level_i(token))
                except Exception:
                    try:
                        values[short] = int(rig.get_level_i(Hamlib.RIG_VFO_CURR, token))
                    except Exception:
                        values[short] = None
            else:
                try:
                    values[short] = float(rig.get_level_f(token))
                except Exception:
                    try:
                        values[short] = float(rig.get_level_f(Hamlib.RIG_VFO_CURR, token))
                    except Exception:
                        values[short] = None
        except Exception as e:
            log.debug(f"read_all_values: {short} failed: {e}")
            values[short] = None

    # ─── Funcs ───────────────────────────────────────────
    for short, info in caps_data["funcs"].items():
        if not info["can_get"]:
            continue
        try:
            const = getattr(Hamlib, f"RIG_FUNC_{short}", None)
            if const is None:
                continue
            try:
                val = rig.get_func(const)
                values[f"_func_{short}"] = int(val) if val is not None else 0
            except Exception:
                try:
                    val = rig.get_func(Hamlib.RIG_VFO_CURR, const)
                    values[f"_func_{short}"] = int(val) if val is not None else 0
                except Exception:
                    values[f"_func_{short}"] = None
        except Exception as e:
            log.debug(f"read_all_values: func {short} failed: {e}")
            values[f"_func_{short}"] = None

    # ─── Parms ───────────────────────────────────────────
    for short, info in caps_data.get("parms", {}).items():
        if not info["can_get"]:
            continue
        try:
            const = getattr(Hamlib, f"RIG_PARM_{short}", None)
            if const is None:
                continue
            try:
                val = rig.get_parm(const)
                values[f"_parm_{short}"] = val
            except Exception:
                try:
                    val = rig.get_parm(Hamlib.RIG_VFO_CURR, const)
                    values[f"_parm_{short}"] = val
                except Exception:
                    values[f"_parm_{short}"] = None
        except Exception as e:
            log.debug(f"read_all_values: parm {short} failed: {e}")
            values[f"_parm_{short}"] = None

    return values
