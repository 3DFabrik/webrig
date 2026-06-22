"""
WebRig – Universal Capabilities Scanner

Scans all Hamlib Level/Func/VFO-Op constants for a given radio,
returns capabilities + current values in a single dict.

This replaces the old hardcoded per-feature polling.
"""

import Hamlib
import logging

log = logging.getLogger(__name__)

# Constants to skip (meta-constants, not actual levels)
_SKIP_LEVELS = {
    "RIG_LEVEL_FLOAT_LIST",
    "RIG_LEVEL_READONLY_LIST",
    "RIG_LEVEL_IS_FLOAT",
    "RIG_LEVEL_IS_INT",
    "RIG_LEVEL_SETTING",
}

# Levels that are TX-only (can't read during RX)
_TX_ONLY_LEVELS = {"SWR", "ALC", "COMP_METER", "RFPOWER_METER", "RFPOWER_METER_WATTS"}

# Funcs to skip
_SKIP_FUNCS = {
    "RIG_FUNC_NONE",
}

# Known int levels (use get_level_i instead of get_level_f)
_INT_LEVELS = {
    "AGC", "PREAMP", "ATT", "NB", "NR", "KEYSPD", "COMP",
    "VOXGAIN", "ANTIVOX", "BKINDL", "AGC_TIME",
    "SPECTRUM_MODE", "SPECTRUM_AVG", "SPECTRUM_SPEED",
}


def scan_caps(rig) -> dict:
    """
    Scan all capabilities of a Hamlib Rig object.
    Returns a dict with levels, funcs, vfo_ops, preamp_levels, att_levels.
    Does NOT read current values — use read_values() for that.
    """
    caps = rig.caps
    result = {
        "levels": {},
        "funcs": {},
        "vfo_ops": [],
        "preamp_levels": [p for p in caps.preamp if p > 0],
        "att_levels": [a for a in caps.attenuator if a > 0],
    }

    # ─── Levels ──────────────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_LEVEL_") or name in _SKIP_LEVELS:
            continue
        short = name.replace("RIG_LEVEL_", "")
        token = getattr(Hamlib, name)
        can_get = bool(caps.has_get_level & token)
        can_set = bool(caps.has_set_level & token)
        if can_get or can_set:
            result["levels"][short] = {
                "can_get": can_get,
                "can_set": can_set,
                "is_int": short in _INT_LEVELS,
                "tx_only": short in _TX_ONLY_LEVELS,
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
            }

    # ─── VFO Operations ──────────────────────────────────
    for name in dir(Hamlib):
        if not name.startswith("RIG_OP_"):
            continue
        short = name.replace("RIG_OP_", "")
        token = getattr(Hamlib, name)
        if caps.vfo_ops & token:
            result["vfo_ops"].append(short)

    return result


async def read_all_values(rig, caps_data: dict) -> dict:
    """
    Read all gettable values from the radio.
    Returns a dict {level_name: value, func_name: value}.

    Uses the caps_data to know what to read and how (int vs float).
    """
    values = {}

    # ─── Levels ──────────────────────────────────────────
    for short, info in caps_data["levels"].items():
        if not info["can_get"]:
            continue
        if info.get("tx_only"):
            # Skip TX-only levels during RX — they return garbage
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
                    values[short] = int(rig.get_level_i(Hamlib.RIG_VFO_CURR, token))
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

    return values
