"""WebRig – Configuration loader."""

import yaml
from pathlib import Path

_config = {}


def load_config():
    global _config
    base = Path(__file__).parent.parent
    # Load defaults
    with open(base / "config.yaml") as f:
        _config = yaml.safe_load(f) or {}
    # Override with local config
    local = base / "config.local.yaml"
    if local.exists():
        with open(local) as f:
            local_cfg = yaml.safe_load(f) or {}
        _deep_merge(_config, local_cfg)


def _deep_merge(base: dict, overlay: dict):
    for k, v in overlay.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def get(path: str, default=None):
    """Get nested config value via dot-notation, e.g. get('radio.rigctld_port')."""
    keys = path.split(".")
    val = _config
    for k in keys:
        if isinstance(val, dict) and k in val:
            val = val[k]
        else:
            return default
    return val
