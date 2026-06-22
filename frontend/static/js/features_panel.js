/**
 * WebRig – Universal Features Panel
 *
 * Dynamically generates controls for ALL Hamlib capabilities
 * that don't have a dedicated control in the main UI.
 *
 * Uses the 'caps' socket event data.
 * Controls are grouped by category (Audio RX, Audio TX, DSP, etc.)
 * and styled uniformly.
 */

// ─── Categories for levels ─────────────────────────────
const LEVEL_CATEGORIES = {
    // RX Audio
    'NR':       { cat: 'rx_audio', label: 'Noise Reduction' },
    'NB':       { cat: 'rx_audio', label: 'Noise Blanker' },
    'APF':      { cat: 'rx_audio', label: 'Audio Peak Filter' },
    'NOTCHF':   { cat: 'rx_audio', label: 'Notch Frequenz' },
    'NOTCHF_RAW': { cat: 'rx_audio', label: 'Notch (Raw)' },
    'PBT_IN':   { cat: 'rx_audio', label: 'PBT Inner' },
    'PBT_OUT':  { cat: 'rx_audio', label: 'PBT Outer' },
    'IF':       { cat: 'rx_audio', label: 'IF Shift' },
    'BALANCE':  { cat: 'rx_audio', label: 'Balance' },
    'SLOPE_HIGH': { cat: 'rx_audio', label: 'Filter High' },
    'SLOPE_LOW':  { cat: 'rx_audio', label: 'Filter Low' },
    'CWPITCH':  { cat: 'rx_audio', label: 'CW Tonhöhe' },
    'AGC_TIME': { cat: 'rx_audio', label: 'AGC Zeit' },
    // TX Audio
    'COMP':     { cat: 'tx_audio', label: 'Kompressor' },
    'VOXGAIN':  { cat: 'tx_audio', label: 'VOX Gain' },
    'ANTIVOX':  { cat: 'tx_audio', label: 'Anti-VOX' },
    'MONITOR_GAIN': { cat: 'tx_audio', label: 'Monitor Gain' },
    'BKINDL':   { cat: 'tx_audio', label: 'Break-in Delay' },
    'BKIN_DLYMS': { cat: 'tx_audio', label: 'Break-in Delay (ms)' },
    'KEYSPD':   { cat: 'tx_audio', label: 'CW Tempo (WPM)' },
    'VOXDELAY': { cat: 'tx_audio', label: 'VOX Delay' },
    // Meters (read-only display)
    'COMP_METER':   { cat: 'meters', label: 'Kompression' },
    'RFPOWER_METER': { cat: 'meters', label: 'Leistung (dB)' },
    'RFPOWER_METER_WATTS': { cat: 'meters', label: 'Leistung (W)' },
    'TEMP_METER':   { cat: 'meters', label: 'Temperatur' },
    'VD_METER':     { cat: 'meters', label: 'Spannung' },
    'ID_METER':     { cat: 'meters', label: 'Strom' },
    // Spectrum
    'SPECTRUM_ATT':  { cat: 'spectrum', label: 'Dämpfung' },
    'SPECTRUM_AVG':  { cat: 'spectrum', label: 'Avg' },
    'SPECTRUM_EDGE_HIGH': { cat: 'spectrum', label: 'Edge High' },
    'SPECTRUM_EDGE_LOW':  { cat: 'spectrum', label: 'Edge Low' },
    'SPECTRUM_MODE': { cat: 'spectrum', label: 'Mode' },
    'SPECTRUM_REF':  { cat: 'spectrum', label: 'Ref' },
    'SPECTRUM_SPAN': { cat: 'spectrum', label: 'Span' },
    'SPECTRUM_SPEED': { cat: 'spectrum', label: 'Speed' },
    // Other
    'USB_AF':       { cat: 'other_level', label: 'USB Audio' },
    'USB_AF_INPUT': { cat: 'other_level', label: 'USB Audio Input' },
    'METER':        { cat: 'other_level', label: 'Messwahl' },
    'BAND_SELECT':  { cat: 'other_level', label: 'Band-Auswahl' },
};

// ─── Categories for funcs ──────────────────────────────
const FUNC_CATEGORIES = {
    // RX DSP
    'NB':      { cat: 'rx_dsp', label: 'Noise Blanker' },
    'NB2':     { cat: 'rx_dsp', label: 'Noise Blanker 2' },
    'NR':      { cat: 'rx_dsp', label: 'Noise Reduction' },
    'ANF':     { cat: 'rx_dsp', label: 'Auto Notch' },
    'APF':     { cat: 'rx_dsp', label: 'Audio Peak Filter' },
    'AFLT':    { cat: 'rx_dsp', label: 'Audio Low Filter' },
    'AIP':     { cat: 'rx_dsp', label: 'RF Preamp' },
    'FAGC':    { cat: 'rx_dsp', label: 'Fast AGC' },
    'DUAL_WATCH': { cat: 'rx_dsp', label: 'Dual Watch' },
    'DIVERSITY':  { cat: 'rx_dsp', label: 'Diversity' },
    'ANL':     { cat: 'rx_dsp', label: 'ANL' },
    // TX
    'COMP':    { cat: 'tx', label: 'Kompressor' },
    'VOX':     { cat: 'tx', label: 'VOX' },
    'MON':     { cat: 'tx', label: 'Monitor' },
    'FBKIN':   { cat: 'tx', label: 'Full Break-in' },
    'SBKIN':   { cat: 'tx', label: 'Half Break-in' },
    'TUNER':   { cat: 'tx', label: 'Antennentuner' },
    // Radio
    'LOCK':    { cat: 'radio', label: 'Sperre' },
    'RIT':     { cat: 'radio', label: 'RIT' },
    'XIT':     { cat: 'radio', label: 'XIT' },
    'SATMODE': { cat: 'radio', label: 'Satellitenmodus' },
    'SYNC':    { cat: 'radio', label: 'Sync' },
    'SLICE':   { cat: 'radio', label: 'Slice' },
    'BC':      { cat: 'radio', label: 'Beat Cancel' },
    'BC2':     { cat: 'radio', label: 'Beat Cancel 2' },
    'REV':     { cat: 'radio', label: 'Reverse' },
    // Tones
    'TONE':    { cat: 'tones', label: 'Tone' },
    'TSQL':    { cat: 'tones', label: 'Tone SQL' },
    'CSQL':    { cat: 'tones', label: 'CTCSS SQL' },
    'DSQL':    { cat: 'tones', label: 'DCS SQL' },
    'TBURST':  { cat: 'tones', label: 'Tone Burst' },
    'VSC':     { cat: 'tones', label: 'Voice Storage' },
    'AFC':     { cat: 'tones', label: 'AFC' },
    'ARO':     { cat: 'tones', label: 'Auto Rptr Offset' },
    // Spectrum
    'SCOPE':        { cat: 'spectrum_func', label: 'Scope' },
    'SPECTRUM':     { cat: 'spectrum_func', label: 'Spektrum' },
    'SPECTRUM_HOLD': { cat: 'spectrum_func', label: 'Hold' },
    'SCEN':         { cat: 'spectrum_func', label: 'Scene' },
    'ABM':          { cat: 'spectrum_func', label: 'Auto Band Memory' },
    // Other
    'TRANSCEIVE':   { cat: 'other_func', label: 'Transceive' },
    'SEND_MORSE':   { cat: 'other_func', label: 'Morse senden' },
    'SEND_VOICE_MEM': { cat: 'other_func', label: 'Voice Memo' },
    'OVF_STATUS':   { cat: 'other_func', label: 'Overflow' },
    'RESUME':       { cat: 'other_func', label: 'Resume' },
    'MBC':          { cat: 'other_func', label: 'MBC' },
    'MUTE':         { cat: 'other_func', label: 'Stumm' },
    'RF':           { cat: 'other_func', label: 'RF' },
};

// ─── Main panel: levels that have dedicated controls ──
const DEDICATED_LEVELS = new Set([
    'AF', 'RF', 'SQL', 'RFPOWER', 'MICGAIN', 'AGC', 'PREAMP', 'ATT',
    'STRENGTH', 'RAWSTR', 'SWR', 'ALC',
]);

// ─── Category labels ───────────────────────────────────
const CAT_LABELS = {
    'rx_audio': 'RX Audio',
    'tx_audio': 'TX Audio',
    'rx_dsp': 'RX DSP / Filter',
    'tx': 'TX Funktionen',
    'radio': 'Radio',
    'tones': 'Töne / CTCSS',
    'meters': 'Meter (nur Anzeige)',
    'spectrum': 'Spektrum',
    'spectrum_func': 'Spektrum',
    'other_level': 'Sonstige',
    'other_func': 'Sonstige',
};

// ─── State ─────────────────────────────────────────────
let _capsData = null;
let _generatedControls = new Set(); // track what we built

// ─── Main entry: called from socket.on('caps') ─────────
function handleCaps(data) {
    _capsData = data;
    buildFeaturesPanel(data);
    updateDedicatedControls(data);
}

// ─── Update dedicated (main panel) controls ────────────
function updateDedicatedControls(data) {
    // Update existing data-level controls
    if (data.levels) {
        for (const [name, info] of Object.entries(data.levels)) {
            if (!DEDICATED_LEVELS.has(name)) continue;
            const el = document.querySelector(`[data-level="${name}"]`);
            if (!el) continue;
            if (info.can_set) {
                el.disabled = false;
                el.classList.remove('unsupported');
            } else {
                el.disabled = true;
                el.classList.add('unsupported');
            }
            if (info.value !== null && info.value !== undefined) {
                setControlValue(el, info.value, info.is_int);
            }
        }
    }
}

// ─── Build the dynamic features panel ──────────────────
function buildFeaturesPanel(data) {
    const container = document.getElementById('features-panel');
    if (!container) return;

    // Clear previous content
    container.innerHTML = '';

    const levels = data.levels || {};
    const funcs = data.funcs || {};
    const vfoOps = data.vfo_ops || [];
    const parms = data.parms || {};

    // Collect features by category
    const cats = {};

    // ─── Levels (skip dedicated ones) ─────────────
    for (const [name, info] of Object.entries(levels)) {
        if (DEDICATED_LEVELS.has(name)) continue;
        if (name === 'NONE') continue;

        const catInfo = LEVEL_CATEGORIES[name] || { cat: 'other_level', label: name };
        const cat = catInfo.cat;

        if (!cats[cat]) cats[cat] = { levels: [], funcs: [] };
        cats[cat].levels.push({ name, info, label: catInfo.label });
    }

    // ─── Funcs ────────────────────────────────────
    for (const [name, info] of Object.entries(funcs)) {
        if (name === 'NONE' || name.match(/^\d+$/)) continue;

        const catInfo = FUNC_CATEGORIES[name] || { cat: 'other_func', label: name };
        const cat = catInfo.cat;

        if (!cats[cat]) cats[cat] = { levels: [], funcs: [] };
        cats[cat].funcs.push({ name, info, label: catInfo.label });
    }

    // ─── Render categories ────────────────────────
    const catOrder = [
        'rx_audio', 'tx_audio', 'rx_dsp', 'tx', 'radio',
        'tones', 'meters', 'spectrum', 'spectrum_func',
        'other_level', 'other_func',
    ];

    let hasContent = false;
    for (const cat of catOrder) {
        if (!cats[cat]) continue;
        const items = cats[cat];
        if (items.levels.length === 0 && items.funcs.length === 0) continue;

        hasContent = true;
        const section = document.createElement('div');
        section.className = 'features-section';

        const title = document.createElement('div');
        title.className = 'features-section-title';
        title.textContent = CAT_LABELS[cat] || cat;
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'features-grid';

        // Levels
        for (const { name, info, label } of items.levels) {
            const ctrl = createLevelControl(name, info, label);
            if (ctrl) grid.appendChild(ctrl);
        }

        // Funcs
        for (const { name, info, label } of items.funcs) {
            const ctrl = createFuncControl(name, info, label);
            if (ctrl) grid.appendChild(ctrl);
        }

        section.appendChild(grid);
        container.appendChild(section);
    }

    // ─── VFO Ops as action buttons ────────────────
    const vfoOpsFiltered = vfoOps.filter(op => {
        const n = typeof op === 'string' ? op : op.name;
        return n !== 'NONE' && !['UP', 'DOWN', 'TOGGLE', 'CPY', 'XCHG', 'TUNE'].includes(n);
    });

    if (vfoOpsFiltered.length > 0) {
        hasContent = true;
        const section = document.createElement('div');
        section.className = 'features-section';
        const title = document.createElement('div');
        title.className = 'features-section-title';
        title.textContent = 'VFO Operationen';
        section.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'features-grid features-buttons';

        for (const op of vfoOpsFiltered) {
            const name = typeof op === 'string' ? op : op.name;
            const label = typeof op === 'object' && op.label ? op.label : (name);
            const btn = document.createElement('button');
            btn.className = 'feature-btn';
            btn.textContent = label;
            btn.dataset.vfoOp = name;
            btn.onclick = () => {
                if (socket) socket.emit('vfo_op', { name: name });
            };
            grid.appendChild(btn);
        }

        section.appendChild(grid);
        container.appendChild(section);
    }

    if (!hasContent) {
        container.innerHTML = '<div class="features-empty">Keine zusätzlichen Funktionen verfügbar.</div>';
    }
}

// ─── Create a level control ────────────────────────────
function createLevelControl(name, info, label) {
    const uiType = info.ui_type || 'slider';
    const wrap = document.createElement('div');
    wrap.className = 'feature-control';

    if (uiType === 'display') {
        // Read-only meter display
        wrap.innerHTML = `
            <label class="feature-label">${label}</label>
            <span class="feature-display" id="feat-${name}" data-level="${name}">—</span>
        `;
        if (info.value !== null && info.value !== undefined) {
            const el = wrap.querySelector(`#feat-${name}`);
            el.textContent = formatValue(info.value, name);
        }
    } else if (uiType === 'select') {
        // Dropdown
        const options = getSelectOptions(name);
        let html = `<label class="feature-label">${label}</label><select data-level="${name}" id="feat-${name}" onchange="onFeatureLevelChange('${name}', this.value)">`;
        for (const [val, text] of Object.entries(options)) {
            const selected = info.value !== null && parseInt(info.value) === parseInt(val) ? 'selected' : '';
            html += `<option value="${val}" ${selected}>${text}</option>`;
        }
        html += '</select>';
        wrap.innerHTML = html;

        if (!info.can_set) {
            wrap.querySelector('select').disabled = true;
        }
    } else {
        // Slider
        const pct = info.value !== null && info.value !== undefined ? Math.round(info.value * 100) : 0;
        wrap.innerHTML = `
            <label class="feature-label">${label}</label>
            <input type="range" min="0" max="100" value="${pct}"
                   data-level="${name}" id="feat-${name}"
                   oninput="onFeatureLevelChange('${name}', this.value / 100)">
            <span class="feature-val" id="feat-${name}-val">${pct}%</span>
        `;
        if (!info.can_set) {
            wrap.querySelector('input').disabled = true;
        }
    }

    return wrap;
}

// ─── Create a func toggle control ──────────────────────
function createFuncControl(name, info, label) {
    const wrap = document.createElement('div');
    wrap.className = 'feature-control feature-toggle';

    const active = info.value ? ' active' : '';
    const stateText = info.value ? 'ON' : 'OFF';

    wrap.innerHTML = `
        <label class="feature-label">${label}</label>
        <button class="feature-toggle-btn${active}"
                data-func="${name}" id="feat-func-${name}"
                onclick="onFeatureFuncChange('${name}', this)">${stateText}</button>
    `;

    if (!info.can_set) {
        wrap.querySelector('button').disabled = true;
    }

    return wrap;
}

// ─── Event handlers for generated controls ─────────────
function onFeatureLevelChange(name, value) {
    const val = parseFloat(value);
    const el = document.getElementById(`feat-${name}-val`);
    if (el) el.textContent = Math.round(val * 100) + '%';
    if (socket) socket.emit('set_level', { name, value: val });
}

function onFeatureFuncChange(name, btn) {
    const newState = !btn.classList.contains('active');
    btn.classList.toggle('active', newState);
    btn.textContent = newState ? 'ON' : 'OFF';
    if (socket) socket.emit('set_func', { name, value: newState });
}

// ─── Helpers ───────────────────────────────────────────
function getSelectOptions(name) {
    const opts = {
        'AGC': { 0: 'OFF', 1: 'Super Fast', 2: 'Fast', 3: 'Slow', 4: 'Medium', 5: 'User' },
        'METER': { 0: 'A', 1: 'B', 2: 'C', 3: 'Center' },
        'SPECTRUM_MODE': { 0: 'Center', 1: 'Fixed', 2: 'Scroll', 3: 'Waterfall' },
        'USB_AF_INPUT': { 0: 'Off', 1: 'Mic', 2: 'Data', 3: 'Mixed' },
    };
    return opts[name] || {};
}

function formatValue(val, name) {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
        if (name.endsWith('_METER') || name === 'STRENGTH') {
            return val.toFixed(1);
        }
        return val.toFixed(2);
    }
    return String(val);
}

function setControlValue(el, value, isInt) {
    if (!el || value === null || value === undefined) return;
    if (el.type === 'range') {
        el.value = isInt ? value : Math.round(value * 100);
    } else if (el.tagName === 'SELECT') {
        el.value = String(value);
    } else if (el.classList.contains('feature-display')) {
        el.textContent = formatValue(value, el.dataset.level);
    }
}

// ─── Live update listeners (for level/func changes) ────
// These complement the existing per-control socket handlers.
// Called from app.js socket.on('level') / socket.on('func')
function onLevelUpdate(name, value) {
    // Update dedicated control
    const el = document.querySelector(`[data-level="${name}"]`);
    if (el) {
        if (el.type === 'range') {
            el.value = Math.round(value * 100);
        } else if (el.tagName === 'SELECT') {
            el.value = String(value);
        }
    }
    // Update value label
    const valEl = document.getElementById(`feat-${name}-val`);
    if (valEl) valEl.textContent = Math.round(value * 100) + '%';
}

function onFuncUpdate(name, value) {
    const btn = document.querySelector(`[data-func="${name}"]`);
    if (btn) {
        btn.classList.toggle('active', !!value);
        btn.textContent = value ? 'ON' : 'OFF';
    }
}
