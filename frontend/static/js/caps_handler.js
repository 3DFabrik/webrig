/**
 * WebRig – Universal Caps Handler
 *
 * Listens for the 'caps' socket event which contains all radio
 * capabilities + current values. Enables/disables controls
 * based on what the radio supports.
 *
 * Controls in HTML use data-level="AF" / data-func="NB" attributes.
 * This module auto-discovers and initializes them.
 */

// ─── Level → Control mapping helpers ───────────────────

const _levelControls = {};

function findLevelControl(levelName) {
    if (_levelControls[levelName]) return _levelControls[levelName];
    const el = document.querySelector(`[data-level="${levelName}"]`);
    if (el) _levelControls[levelName] = el;
    return el;
}

function setLevelControlValue(levelName, value, isInt) {
    const el = findLevelControl(levelName);
    if (!el || value === null || value === undefined) return;

    if (el.type === 'range' || el.type === 'slider') {
        // Float levels: 0.0-1.0 → percentage
        const pct = isInt ? value : Math.round(value * 100);
        el.value = pct;
        // Update label if sibling exists
        const label = document.getElementById(el.id + '-val');
        if (label) label.textContent = pct + '%';
    } else if (el.tagName === 'SELECT') {
        el.value = value;
    } else if (el.type === 'checkbox') {
        el.checked = !!value;
    }
}

// ─── Func → Control mapping ────────────────────────────

const _funcControls = {};

function findFuncControl(funcName) {
    if (_funcControls[funcName]) return _funcControls[funcName];
    const el = document.querySelector(`[data-func="${funcName}"]`);
    if (_funcControls[funcName]) return _funcControls[funcName];
    if (el) _funcControls[funcName] = el;
    return el;
}

function setFuncControlValue(funcName, value) {
    const el = findFuncControl(funcName);
    if (!el || value === null || value === undefined) return;
    if (el.type === 'checkbox') {
        el.checked = !!value;
    } else if (el.classList.contains('toggle-btn')) {
        el.classList.toggle('active', !!value);
    }
}

// ─── Disable unsupported controls ──────────────────────

function disableControl(el, reason) {
    if (!el) return;
    el.disabled = true;
    el.classList.add('unsupported');
    if (!el.title) el.title = reason || 'Not supported by this radio';
}

function enableControl(el) {
    if (!el) return;
    el.disabled = false;
    el.classList.remove('unsupported');
}

// ─── Main caps handler ─────────────────────────────────

function handleCaps(data) {
    // Levels
    if (data.levels) {
        for (const [name, info] of Object.entries(data.levels)) {
            const el = findLevelControl(name);
            if (!el) continue;

            if (info.can_set) {
                enableControl(el);
            } else {
                disableControl(el, `Radio does not support setting ${name}`);
            }

            if (info.value !== null && info.value !== undefined) {
                setLevelControlValue(name, info.value, info.is_int);
            }
        }
    }

    // Funcs
    if (data.funcs) {
        for (const [name, info] of Object.entries(data.funcs)) {
            const el = findFuncControl(name);
            if (!el) continue;

            if (info.can_set) {
                enableControl(el);
            } else {
                disableControl(el, `Radio does not support ${name}`);
            }

            if (info.value !== null && info.value !== undefined) {
                setFuncControlValue(name, info.value);
            }
        }
    }

    // VFO Ops — store for reference
    if (data.vfo_ops) {
        window.rigVfoOps = data.vfo_ops;
    }

    // Preamp/Att levels
    if (data.preamp_levels) {
        window.rigPreampLevels = data.preamp_levels;
        const btn = document.getElementById('preamp-btn');
        if (btn && data.preamp_levels.length > 0) {
            btn.dataset.db = data.preamp_levels[data.preamp_levels.length - 1];
            btn.title = `Preamp (${data.preamp_levels.join('/')} dB)`;
        }
    }
    if (data.att_levels) {
        window.rigAttLevels = data.att_levels;
        const btn = document.getElementById('att-btn');
        if (btn && data.att_levels.length > 0) {
            btn.dataset.db = data.att_levels[data.att_levels.length - 1];
            btn.title = `Attenuator (${data.att_levels.join('/')} dB)`;
        }
    }
}
