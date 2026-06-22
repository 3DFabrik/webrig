"""WebRig – Radio Profile Manager.

Manages multiple radio profiles (radios.yaml).
Each profile has its own radio, audio, and PTT settings.
One profile can be marked as active.
"""

import logging
import yaml
from pathlib import Path
from typing import Optional
from copy import deepcopy

log = logging.getLogger(__name__)

PROFILES_FILE = "radios.yaml"
BACKUP_SUFFIX = ".bak"


def _profiles_path() -> Path:
    return Path(__file__).parent.parent / PROFILES_FILE


def load_profiles() -> dict:
    """Load all profiles from radios.yaml.

    Returns:
        {"active": "profile_id", "radios": {"id": {profile_dict}, ...}}
    """
    path = _profiles_path()
    if not path.exists():
        return {"active": None, "radios": {}}
    try:
        data = yaml.safe_load(path.read_text()) or {}
        return {
            "active": data.get("active"),
            "radios": data.get("radios", {}),
        }
    except Exception as e:
        log.error(f"Failed to load profiles: {e}")
        return {"active": None, "radios": {}}


def save_profiles(data: dict):
    """Save profiles to radios.yaml atomically (write + rename)."""
    path = _profiles_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))
    tmp.rename(path)
    log.info(f"Profiles saved ({len(data.get('radios', {}))} profiles)")


def get_profile(profile_id: str) -> Optional[dict]:
    """Get a single profile by ID."""
    profiles = load_profiles()
    return profiles["radios"].get(profile_id)


def get_active_profile() -> Optional[dict]:
    """Get the currently active profile."""
    data = load_profiles()
    active = data.get("active")
    if active and active in data.get("radios", {}):
        return data["radios"][active]
    # Fallback: return first profile
    radios = data.get("radios", {})
    if radios:
        first_id = next(iter(radios))
        return radios[first_id]
    return None


def get_active_id() -> Optional[str]:
    """Get the ID of the active profile."""
    data = load_profiles()
    return data.get("active")


def create_profile(profile_id: str, profile: dict) -> dict:
    """Create a new profile. Raises ValueError if ID exists."""
    data = load_profiles()
    if profile_id in data.get("radios", {}):
        raise ValueError(f"Profile '{profile_id}' already exists")
    if not data.get("radios"):
        # First profile — make it active
        data["active"] = profile_id
    data.setdefault("radios", {})[profile_id] = profile
    save_profiles(data)
    return data


def update_profile(profile_id: str, profile: dict) -> dict:
    """Update an existing profile. Raises ValueError if not found."""
    data = load_profiles()
    if profile_id not in data.get("radios", {}):
        raise ValueError(f"Profile '{profile_id}' not found")
    data["radios"][profile_id] = profile
    save_profiles(data)
    return data


def delete_profile(profile_id: str) -> dict:
    """Delete a profile. Raises ValueError if it's the only one."""
    data = load_profiles()
    radios = data.get("radios", {})
    if profile_id not in radios:
        raise ValueError(f"Profile '{profile_id}' not found")
    if len(radios) <= 1:
        raise ValueError("Cannot delete the last profile")
    del radios[profile_id]
    if data.get("active") == profile_id:
        data["active"] = next(iter(radios))
    save_profiles(data)
    return data


def set_active(profile_id: str) -> dict:
    """Set the active profile."""
    data = load_profiles()
    if profile_id not in data.get("radios", {}):
        raise ValueError(f"Profile '{profile_id}' not found")
    data["active"] = profile_id
    save_profiles(data)
    return data


def migrate_from_flat_config(flat_config: dict) -> dict:
    """Migrate flat radio/audio/ptt config into a profile.

    Called once when radios.yaml doesn't exist but config.local.yaml
    has radio settings.

    Args:
        flat_config: The full config dict (radio, audio, ptt keys)

    Returns:
        Updated profiles data dict.
    """
    radio_cfg = flat_config.get("radio", {})
    audio_cfg = flat_config.get("audio", {})
    ptt_cfg = flat_config.get("ptt", {})

    if not radio_cfg.get("model_id"):
        return {"active": None, "radios": {}}

    # Try to get a readable name from the model
    model_id = radio_cfg.get("model_id", 0)
    name = _get_radio_name(model_id) or f"Radio {model_id}"

    # Derive a slug for the ID
    profile_id = f"radio_{model_id}"

    profile = {
        "name": name,
        "model_id": model_id,
        "serial_port": radio_cfg.get("serial_port", "/dev/ttyUSB0"),
        "serial_baud": radio_cfg.get("serial_baud", 19200),
        "data_bits": radio_cfg.get("data_bits", 8),
        "stop_bits": radio_cfg.get("stop_bits", 1),
        "parity": radio_cfg.get("parity", "None"),
        "flow_control": radio_cfg.get("flow_control", "None"),
        "audio": {
            "device_rx": audio_cfg.get("device_rx", "default"),
            "device_tx": audio_cfg.get("device_tx", "default"),
            "sample_rate": audio_cfg.get("sample_rate", 48000),
            "chunk_ms": audio_cfg.get("chunk_ms", 80),
        },
        "ptt": {
            "mode": ptt_cfg.get("mode", "hamlib"),
            "serial_port": ptt_cfg.get("serial_port", ""),
            "tx_timeout": ptt_cfg.get("tx_timeout", 180),
        },
    }

    data = {"active": profile_id, "radios": {profile_id: profile}}
    save_profiles(data)
    log.info(f"Migrated flat config to profile '{profile_id}'")
    return data


def _get_radio_name(model_id: int) -> str:
    """Try to get readable radio name from hamlib/rigctl."""
    try:
        import Hamlib
        caps = Hamlib.rig_get_caps(model_id)
        if caps:
            return f"{caps.mfg_name} {caps.model_name}"
    except Exception:
        pass
    try:
        import subprocess
        r = subprocess.run(["rigctl", "-l"], capture_output=True, text=True, timeout=5)
        for line in r.stdout.splitlines():
            parts = line.split(None, 4)
            if len(parts) >= 3 and parts[0] == str(model_id):
                return f"{parts[1]} {parts[2]}"
    except Exception:
        pass
    return None


def profile_to_flat(profile: dict) -> dict:
    """Convert a profile to the flat config format (for RadioManager compat)."""
    audio = profile.get("audio", {})
    ptt = profile.get("ptt", {})
    return {
        "radio": {
            "model_id": profile.get("model_id", 1),
            "serial_port": profile.get("serial_port", "/dev/ttyUSB0"),
            "serial_baud": profile.get("serial_baud", 19200),
            "data_bits": profile.get("data_bits", 8),
            "stop_bits": profile.get("stop_bits", 1),
            "parity": profile.get("parity", "None"),
            "flow_control": profile.get("flow_control", "None"),
            "poll_interval_ms": 200,
            "freq_poll_interval_ms": 1000,
            "reconnect_delay_s": 3,
        },
        "audio": {
            "device_rx": audio.get("device_rx", "default"),
            "device_tx": audio.get("device_tx", "default"),
            "sample_rate": audio.get("sample_rate", 48000),
            "chunk_ms": audio.get("chunk_ms", 80),
            "channels": 1,
            "squelch_enabled": True,
            "squelch_threshold": 300,
            "max_chunk_ms": 200,
        },
        "ptt": {
            "mode": ptt.get("mode", "hamlib"),
            "serial_port": ptt.get("serial_port", ""),
            "tx_timeout": ptt.get("tx_timeout", 180),
        },
    }
