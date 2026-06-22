/* ═══════════════════════════════════════════════════
   WebRig — Main Application
   ═══════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────
const state = {
    connected: false,
    ptt: false,
    frequency: 145000000,
    mode: 'FM',
    vfo: 'VFOA',
    split: false,
    selectedVFO: 'VFOA',
    vfoA: { freq: 0, mode: 'FM', passband: 0 },
    vfoB: { freq: 0, mode: 'FM', passband: 0 },
    smeterScale: 'S',
    attack: 'fast',
    recording: false,
    recordedData: [],
    graphWindow: 30, // minutes
    smeterHistory: [],
    peakHold: 0,
    peakHoldTime: 3,
    peakHoldTimer: null,
    alarmThreshold: null,
    alarmDelta: null,
    calibration: { offset: 0, scale: 1 },
    stations: [],
    macros: [],
    preamp: false,
    attenuator: false,
    txTimeout: 180, // seconds
    txTimer: null,
};

// ─── SocketIO ──────────────────────────────────
let socket = null;

function initSocket() {
    // Load socket.io client from CDN if not present
    if (typeof io === 'undefined') {
        const script = document.createElement('script');
        script.src = '/static/js/socket.io.min.js';
        script.onload = () => connectSocket();
        script.onerror = () => {
            // Fallback: load from CDN
            const cdn = document.createElement('script');
            cdn.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
            cdn.onload = () => connectSocket();
            cdn.onerror = () => console.error('Cannot load socket.io');
            document.head.appendChild(cdn);
        };
        document.head.appendChild(script);
    } else {
        connectSocket();
    }
}

function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
        console.log('SocketIO connected');
    });

    socket.on('disconnect', () => {
        console.log('SocketIO disconnected');
        setConnectionState(false);
    });

    socket.on('tuner', (status) => {
        state.tuner = status;
        const btn = document.getElementById('tuner-btn');
        if (!btn) return;
        btn.classList.remove('active', 'tuning');
        if (status === 'tuning') {
            btn.classList.add('tuning');
            btn.textContent = 'Tuning...';
        } else if (status === 'done') {
            btn.textContent = 'ATU';
            btn.classList.add('active');
            setTimeout(() => {
                btn.classList.remove('active');
                state.tuner = 'off';
            }, 3000);
        } else if (status === 'timeout') {
            btn.textContent = 'ATU Timeout';
            setTimeout(() => {
                btn.textContent = 'ATU';
                state.tuner = 'off';
            }, 3000);
        } else {
            btn.textContent = 'ATU';
        }
    });

    socket.on('connection', (connected) => {
        setConnectionState(connected);
    });

    socket.on('frequency', (freq) => {
        state.frequency = freq;
        updateFreqDisplay();
    });

    socket.on('mode', (data) => {
        if (typeof data === 'string') {
            state.mode = data;
        } else {
            state.mode = data.mode;
        }
        updateModeButtons();
    });

    socket.on('vfo', (vfo) => {
        // Ignore hamlib error responses (e.g. "RPRT -11")
        if (!vfo || vfo.startsWith('RPRT')) return;
        state.vfo = vfo;
        state.selectedVFO = vfo;
        document.getElementById('vfo-a-btn')?.classList.toggle('active', vfo === 'VFOA');
        document.getElementById('vfo-b-btn')?.classList.toggle('active', vfo === 'VFOB');
        updateVFOHighlight();
    });

    socket.on('vfo_a', (data) => {
        state.vfoA = data;
        document.getElementById('vfo-a-freq').textContent = formatFreq(data.freq);
        if (state.selectedVFO === 'VFOA') {
            state.frequency = data.freq;
            state.mode = data.mode;
            state.passband = data.passband;
        }
    });

    socket.on('vfo_b', (data) => {
        state.vfoB = data;
        document.getElementById('vfo-b-freq').textContent = formatFreq(data.freq);
        if (state.selectedVFO === 'VFOB') {
            state.frequency = data.freq;
            state.mode = data.mode;
            state.passband = data.passband;
        }
    });

    // ─── RF Power ───────────────────────────────────
window.setRFPower = function(val) {
    const pct = Math.round(val);
    document.getElementById('rfpower-val').textContent = pct + '%';
    if (socket) socket.emit('set_rfpower', parseFloat(val) / 100);
};

socket.on('rfpower', (val) => {
    const pct = Math.round(val * 100);
    const slider = document.getElementById('rfpower-slider');
    if (slider) slider.value = pct;
    const display = document.getElementById('rfpower-val');
    if (display) display.textContent = pct + '%';
});

// ─── SWR / ALC meters ────────────────────────────
socket.on('swr', (val) => {
    const meter = document.getElementById('swr-meter');
    const display = document.getElementById('swr-val');
    if (meter) {
        // SWR: 1.0 = good, 3.0+ = bad. Scale: 1.0-5.0 → 0-100%
        const pct = Math.min(100, Math.max(0, ((val - 1.0) / 4.0) * 100));
        meter.style.width = pct + '%';
    }
    if (display) display.textContent = val > 0 ? val.toFixed(1) + ':1' : '—';
});

socket.on('alc', (val) => {
    const meter = document.getElementById('alc-meter');
    const display = document.getElementById('alc-val');
    if (meter) {
        const pct = Math.min(100, Math.abs(val) * 100);
        meter.style.width = pct + '%';
    }
    if (display) display.textContent = val !== 0 ? val.toFixed(2) : '—';
});

socket.on('ptt', (on) => {
        state.ptt = on;
        const btn = document.getElementById('ptt-btn');
        const led = document.getElementById('tx-led');
        btn.classList.toggle('active', on);
        led.classList.toggle('tx-active', on);
        led.textContent = on ? 'TX' : 'RX';

        // Toggle S-Meter between RX and MIC mode
        const smeterLabel = document.querySelector('.smeter-scale-label');
        if (smeterLabel) smeterLabel.textContent = on ? 'MIC' : 'S-Meter';
        if (on) {
            txAudio.startTransmit();
            if (window.analogSMeter) window.analogSMeter.setTXMode();
        } else {
            txAudio.stopTransmit();
            if (window.analogSMeter) window.analogSMeter.setRX(0);
        }
    });

    socket.on('smeter', (db) => {
        if (window.analogSMeter) window.analogSMeter.updateRX(db);
        updateSmeterReadout(db);
    });

    socket.on('split', (on) => {
        state.split = on;
        const btn = document.getElementById('split-btn');
        btn.classList.toggle('active', on);
        btn.textContent = on ? 'ON' : 'OFF';
    });

    socket.on('agc', (value) => {
        updateAGCSelect(value);
    });

    socket.on('preamp', (on) => {
        state.preamp = on;
        const btn = document.getElementById('preamp-btn');
        btn.classList.toggle('active', on);
        const db = state.preampLevel || parseInt(btn.dataset.db) || 10;
        btn.textContent = on ? `${db}dB` : 'OFF';
    });

    socket.on('attenuator', (on) => {
        state.attenuator = on;
        const btn = document.getElementById('att-btn');
        btn.classList.toggle('active', on);
        const db = state.attLevel || parseInt(btn.dataset.db) || 12;
        btn.textContent = on ? `${db}dB` : 'OFF';
    });

    socket.on('rig_caps', (data) => {
        // Radio capability info (preamp/att levels)
        const preampBtn = document.getElementById('preamp-btn');
        const attBtn = document.getElementById('att-btn');
        if (data.preamp_levels && data.preamp_levels.length > 0 && preampBtn) {
            state.preampLevel = data.preamp_levels[data.preamp_levels.length - 1]; // highest available
            preampBtn.dataset.db = state.preampLevel;
            preampBtn.title = `Preamp (max ${state.preampLevel} dB)`;
        }
        if (data.att_levels && data.att_levels.length > 0 && attBtn) {
            state.attLevel = data.att_levels[data.att_levels.length - 1]; // highest available
            attBtn.dataset.db = state.attLevel;
            attBtn.title = `Attenuator (max ${state.attLevel} dB)`;
        }
        // Tuner support
        const tunerBtn = document.getElementById('tuner-btn');
        if (tunerBtn) {
            if (data.has_tuner) {
                tunerBtn.disabled = false;
                tunerBtn.classList.remove('disabled');
                tunerBtn.title = 'Antenna Tuner';
            } else {
                tunerBtn.disabled = true;
                tunerBtn.classList.add('disabled');
                tunerBtn.title = 'Antenna Tuner (not supported by this radio)';
            }
        }
    });

    socket.on('capability_error', (data) => {
        // Disable controls the radio doesn't support
        const el = document.getElementById(data.control);
        if (el) {
            el.disabled = true;
            el.style.opacity = '0.4';
            el.title = `Not supported by radio: ${data.feature}`;
        }
    });
}

// ─── Connection State ─────────────────────────────
function setConnectionState(connected) {
    state.connected = connected;
    const dot = document.getElementById('radio-status');
    const text = document.getElementById('radio-status-text');
    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
    }
    // Lock/unlock the operator view
    const opView = document.getElementById('view-operator');
    if (opView) opView.classList.toggle('radio-disconnected', !connected);
}

// ─── View Switching ──────────────────────────────
function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    if (name === 'setup') loadConfigIntoSetup();
}

// ─── VFO ─────────────────────────────────────────
function selectVFO(vfo) {
    state.selectedVFO = vfo;
    document.getElementById('vfo-a-btn')?.classList.toggle('active', vfo === 'VFOA');
    document.getElementById('vfo-b-btn')?.classList.toggle('active', vfo === 'VFOB');
    updateVFOHighlight();
    if (socket) socket.emit('set_vfo', vfo);
}

function vfoSwap() {
    if (socket) socket.emit('vfo_swap');
}

function vfoEqual() {
    if (socket) socket.emit('vfo_equal');
}

// ─── Frequency ───────────────────────────────────
function formatFreq(hz) {
    if (!hz || hz < 0) return '---.----';
    return (hz / 1e6).toFixed(4);
}

function updateFreqDisplay() {
    const aEl = document.getElementById('vfo-a-freq');
    const bEl = document.getElementById('vfo-b-freq');
    if (!aEl) return;

    if (state.selectedVFO === 'VFOA') {
        aEl.textContent = formatFreq(state.frequency);
    } else {
        bEl.textContent = formatFreq(state.frequency);
    }
    updateVFOHighlight();
    updateBandButtons(state.frequency);
}

function updateVFOHighlight() {
    document.getElementById('vfo-a-box')?.classList.toggle('active', state.selectedVFO === 'VFOA');
    document.getElementById('vfo-b-box')?.classList.toggle('active', state.selectedVFO === 'VFOB');
}

function editFreq(which) {
    const vfo = which || state.selectedVFO;
    const row = document.getElementById('freq-input-row');
    const input = document.getElementById('freq-input');
    row.style.display = 'flex';
    input.value = formatFreq(state.frequency);
    input.focus();
    input.select();
    input.dataset.targetVFO = vfo;
}

function commitFreq() {
    const input = document.getElementById('freq-input');
    const row = document.getElementById('freq-input-row');
    const raw = input.value.trim();
    row.style.display = 'none';

    if (!raw) return;

    // Accept both "7.074" (MHz) and "7074000" (Hz) formats
    let hz;
    if (raw.includes('.') || raw.includes(',')) {
        hz = Math.round(parseFloat(raw.replace(',', '.')) * 1e6);
    } else {
        hz = parseInt(raw, 10);
    }

    if (isNaN(hz) || hz < 0) return;

    state.frequency = hz;
    updateFreqDisplay();
    if (socket) socket.emit('set_freq', hz);
}

function cancelFreq() {
    document.getElementById('freq-input-row').style.display = 'none';
}

function tuneFreq(deltaHz) {
    state.frequency += deltaHz;
    if (state.frequency < 0) state.frequency = 0;
    updateFreqDisplay();
    if (socket) socket.emit('set_freq', state.frequency);
}

// ─── Step Tuning (dropdown + press-and-hold) ────
let _tuneStep = 1000; // default 1 kHz
let _tuneTimer = null;
let _tuneInterval = null;

function setStep(hz) {
    _tuneStep = parseInt(hz) || 1000;
}

function tuneHold(dir) {
    const delta = dir === 'up' ? _tuneStep : -_tuneStep;
    tuneFreq(delta);
    // Start repeat after 400ms hold
    _tuneTimer = setTimeout(() => {
        let speed = 200;
        _tuneInterval = setInterval(() => {
            tuneFreq(delta);
            // Accelerate: speed up after every 5 ticks
            speed = Math.max(50, speed - 10);
        }, speed);
    }, 400);
}

function tuneRelease() {
    if (_tuneTimer) { clearTimeout(_tuneTimer); _tuneTimer = null; }
    if (_tuneInterval) { clearInterval(_tuneInterval); _tuneInterval = null; }
}

// ─── Mode ────────────────────────────────────────
function setMode(mode) {
    state.mode = mode;
    updateModeButtons();
    // Remember mode for current band
    const band = currentBandName(state.frequency);
    if (band) rememberMode(band, mode);
    if (socket) socket.emit('set_mode', mode);
}

function updateModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });
}

// ─── Band switching ─────────────────────────────
const BAND_RANGES = [
    { name: '630m', min: 472000, max: 479000 },
    { name: '160m', min: 1800000, max: 2000000 },
    { name: '80m', min: 3500000, max: 3800000 },
    { name: '60m', min: 5250000, max: 5450000 },
    { name: '40m', min: 7000000, max: 7200000 },
    { name: '30m', min: 10100000, max: 10150000 },
    { name: '20m', min: 14000000, max: 14350000 },
    { name: '17m', min: 18068000, max: 18168000 },
    { name: '15m', min: 21000000, max: 21450000 },
    { name: '12m', min: 24890000, max: 24990000 },
    { name: '10m', min: 28000000, max: 29700000 },
    { name: '6m', min: 50000000, max: 54000000 },
    { name: '4m', min: 70000000, max: 70500000 },
    { name: '2m', min: 144000000, max: 146000000 },
    { name: '70cm', min: 430000000, max: 440000000 },
    { name: '23cm', min: 1240000000, max: 1300000000 },
];

// Default mode per band range (amateur radio convention)
function defaultModeForBand(bandName) {
    if (['2m', '70cm', '23cm', '6m', '4m'].includes(bandName)) return 'FM';
    if (['2200m', '630m', '160m', '80m', '60m', '40m'].includes(bandName)) return 'LSB';
    return 'USB'; // 30m and above (USB)
}

function rememberedMode(bandName) {
    try {
        const saved = localStorage.getItem('webrig_band_mode_' + bandName);
        return saved || defaultModeForBand(bandName);
    } catch { return defaultModeForBand(bandName); }
}

function rememberMode(bandName, mode) {
    try { localStorage.setItem('webrig_band_mode_' + bandName, mode); } catch {}
}

function currentBandName(freq) {
    const band = BAND_RANGES.find(b => freq >= b.min && freq <= b.max);
    return band ? band.name : null;
}

function switchBand(btn) {
    const freq = parseInt(btn.dataset.freq);
    const bandName = btn.dataset.band;
    // Optimistic UI update
    state.frequency = freq;
    updateFreqDisplay();
    // Tell backend — if radio rejects, next poll will correct
    if (socket) socket.emit('set_freq', freq);
    // Auto-switch mode to remembered/default for this band
    const mode = rememberedMode(bandName);
    if (mode !== state.mode) {
        setMode(mode);
    }
}

function updateBandButtons(freq) {
    const band = BAND_RANGES.find(b => freq >= b.min && freq <= b.max);
    document.querySelectorAll('.band-btn').forEach(btn => {
        const isActive = band != null && btn.dataset.band === band.name;
        btn.classList.toggle('active', isActive);
    });
}

// ─── Shift / Offset / Tones ──────────────────────
function setShift(shift) {
    if (socket) socket.emit('set_rptr_shift', shift);
}

function setOffset(mhz) {
    const hz = Math.round(parseFloat(mhz) * 1e6);
    if (socket) socket.emit('set_rptr_offset', hz);
}

function setCTCSS(tone) {
    if (socket) socket.emit('set_ctcss', parseFloat(tone));
}

function setDCS(code) {
    if (socket) socket.emit('set_dcs', parseInt(code));
}

// ─── S-Meter ─────────────────────────────────────
function setSmeterScale(scale) {
    state.smeterScale = scale;
    document.querySelectorAll('.smeter-scale-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}

function setAttack(mode) {
    state.attack = mode;
    document.querySelectorAll('.attack-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
}

function setPollRate(ms) {
    if (socket) socket.emit('set_poll_rate', parseInt(ms));
}

function updateSmeterReadout(dbValue) {
    // Analog needle handled by AnalogSMeter — keep graph/alarm only
    state.smeterHistory.push({ t: Date.now(), v: dbValue });
    pruneHistory();
    drawSmeterGraph();
    checkAlarms(dbValue);
}

function updateMicMeter(level) {
    // Analog needle handled by AnalogSMeter — keep graph only
    if (!state.ptt) return;
    const dbfs = level > 0 ? 20 * Math.log10(level) : -60;
    state.smeterHistory.push({ t: Date.now(), v: dbfs + 33 });
    pruneHistory();
    drawSmeterGraph();
}

// ─── RX / TX Audio Level Meters ─────────────────────────
function rmsToPercent(rms) {
    // Logarithmic scaling: -60dBFS (0.001) → 0%, 0dBFS (1.0) → 100%
    if (rms < 0.001) return 0;
    return Math.min(100, Math.max(0, (20 * Math.log10(rms) + 60) / 60 * 100));
}

function updateRxMeter(level) {
    const meter = document.getElementById('rx-meter');
    if (meter) meter.style.width = rmsToPercent(level) + '%';
}

function updateTxMeter(level) {
    const meter = document.getElementById('tx-meter');
    if (meter) meter.style.width = rmsToPercent(level) + '%';
}

function pruneHistory() {
    const maxAge = state.graphWindow * 60 * 1000;
    const cutoff = Date.now() - maxAge;
    state.smeterHistory = state.smeterHistory.filter(p => p.t > cutoff);
}

function drawSmeterGraph() {
    const canvas = document.getElementById('smeter-graph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#30363d';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    if (state.smeterHistory.length < 2) return;

    const now = Date.now();
    const maxAge = state.graphWindow * 60 * 1000;
    const minDb = -54;
    const maxDb = 60;

    // Draw line
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    state.smeterHistory.forEach((p, i) => {
        const x = ((p.t - (now - maxAge)) / maxAge) * w;
        const y = h - ((p.v - minDb) / (maxDb - minDb)) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill under line
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(63, 185, 80, 0.1)';
    ctx.fill();
}

// ─── Recording ───────────────────────────────────
function toggleRecording() {
    state.recording = !state.recording;
    const btn = document.getElementById('record-btn');
    if (state.recording) {
        state.recordedData = [];
        btn.textContent = '⏹ Stop';
        btn.style.color = '#da3633';
    } else {
        btn.textContent = '⏺ Record';
        btn.style.color = '';
    }
}

function exportRecording() {
    if (state.recordedData.length === 0 && state.smeterHistory.length === 0) return;
    const data = state.smeterHistory.map(p => ({
        timestamp: new Date(p.t).toISOString(),
        smeter_db: p.v.toFixed(1),
    }));
    const csv = 'timestamp,smeter_db\n' + data.map(d => `${d.timestamp},${d.smeter_db}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webrig-smeter-' + Date.now() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function setGraphWindow(minutes) {
    state.graphWindow = parseInt(minutes);
    pruneHistory();
    drawSmeterGraph();
}

// ─── Alarms ──────────────────────────────────────
function checkAlarms(dbValue) {
    // Threshold alarm
    const thrEnable = document.getElementById('alarm-threshold-enable');
    if (thrEnable && thrEnable.checked) {
        const threshold = parseInt(document.getElementById('alarm-threshold').value);
        const thresholdDb = (threshold - 9) * 6;
        if (dbValue >= thresholdDb) {
            playAlarmBeep();
        }
    }

    // Delta alarm (QSB detector)
    const deltaEnable = document.getElementById('alarm-delta-enable');
    if (deltaEnable && deltaEnable.checked && state.smeterHistory.length > 10) {
        const deltaThreshold = parseFloat(document.getElementById('alarm-delta').value);
        const deltaT = parseFloat(document.getElementById('alarm-delta-time').value) * 1000;
        const now = Date.now();
        const past = state.smeterHistory.filter(p => p.t < now - deltaT);
        if (past.length > 0) {
            const pastVal = past[past.length - 1].v;
            if (Math.abs(dbValue - pastVal) > deltaThreshold) {
                playAlarmBeep();
            }
        }
    }
}

let audioCtx = null;
function playAlarmBeep() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    setTimeout(() => osc.stop(), 150);
}

// ─── PTT ─────────────────────────────────────────
function pttDown() {
    if (state.ptt) return;
    state.ptt = true;
    document.getElementById('ptt-btn').classList.add('active');
    document.getElementById('tx-led').classList.add('tx-active');
    document.getElementById('tx-led').textContent = 'TX';
    if (socket) socket.emit('set_ptt', true);
    if (window.rxAudio) rxAudio.muted = true;
    if (window.txAudio) txAudio.startTransmit();
    startTxTimeout();
}

function pttUp() {
    if (!state.ptt) return;
    state.ptt = false;
    document.getElementById('ptt-btn').classList.remove('active');
    document.getElementById('tx-led').classList.remove('tx-active');
    document.getElementById('tx-led').textContent = 'RX';
    if (socket) socket.emit('set_ptt', false);
    if (window.txAudio) txAudio.stopTransmit();
    if (window.rxAudio) rxAudio.muted = false;
    stopTxTimeout();
}

function startTxTimeout() {
    let remaining = state.txTimeout;
    const display = document.getElementById('tx-timeout-display');
    state.txTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
            pttUp();
            display.textContent = 'TX timeout!';
            setTimeout(() => display.textContent = '', 3000);
        } else if (remaining <= 30) {
            display.textContent = '⏱ ' + remaining + 's';
        }
    }, 1000);
}

function stopTxTimeout() {
    if (state.txTimer) { clearInterval(state.txTimer); state.txTimer = null; }
    document.getElementById('tx-timeout-display').textContent = '';
}

// Spacebar PTT
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        pttDown();
    }
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && state.ptt) {
        e.preventDefault();
        pttUp();
    }
});

// ─── Audio Controls ──────────────────────────────
function setAF(val) {
    document.getElementById('af-val').textContent = val + '%';
    if (socket) socket.emit('set_af', val / 100);
}
function setRF(val) {
    document.getElementById('rf-val').textContent = val + '%';
    if (socket) socket.emit('set_rf', val / 100);
}
function setSQL(val) {
    document.getElementById('sql-val').textContent = val + '%';
    if (socket) socket.emit('set_sql', val / 100);
}
function setMicGain(val) {
    document.getElementById('mic-val').textContent = val + '%';
    if (socket) socket.emit('set_micgain', val / 100);
}

// ─── Signal Processing ───────────────────────────
function setAGC(mode) {
    // mode is a numeric string (1=SuperFast, 2=Fast, 3=Slow, 5=User)
    if (socket) socket.emit('set_agc', parseInt(mode));
}

// Mapping for display
const AGC_LABELS = {0: 'OFF', 1: 'Super Fast', 2: 'Fast', 3: 'Slow', 4: 'Medium', 5: 'User'};

function updateAGCSelect(value) {
    const sel = document.getElementById('agc-select');
    if (!sel) return;
    const v = String(value);
    // If the value isn't in our options, add it
    if (![...sel.options].some(o => o.value === v)) {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = AGC_LABELS[value] || `Mode ${value}`;
        sel.appendChild(opt);
    }
    sel.value = v;
}
function setNB(val) { if (socket) socket.emit('set_nb', val / 100); }

function togglePreamp() {
    state.preamp = !state.preamp;
    const btn = document.getElementById('preamp-btn');
    btn.classList.toggle('active', state.preamp);
    const db = state.preampLevel || parseInt(btn.dataset.db) || 10;
    btn.textContent = state.preamp ? `${db}dB` : 'OFF';
    if (socket) socket.emit('set_preamp', {on: state.preamp, level: state.preamp ? db : 0});
}

// ─── Tuner ──────────────────────────────────────
function toggleTuner() {
    if (state.tuner === 'tuning') return;
    const btn = document.getElementById('tuner-btn');
    if (btn && btn.disabled) return;
    if (state.tuner === 'off' || !state.tuner) {
        state.tuner = 'tuning';
        const btn = document.getElementById('tuner-btn');
        btn.classList.add('tuning');
        btn.classList.remove('active');
        btn.textContent = 'Tuning...';
        if (socket) socket.emit('set_tuner', true);
    }
}

function toggleAtt() {
    state.attenuator = !state.attenuator;
    const btn = document.getElementById('att-btn');
    btn.classList.toggle('active', state.attenuator);
    const db = state.attLevel || parseInt(btn.dataset.db) || 12;
    btn.textContent = state.attenuator ? `${db}dB` : 'OFF';
    if (socket) socket.emit('set_attenuator', {on: state.attenuator, level: state.attenuator ? db : 0});
}

function toggleSplit() {
    state.split = !state.split;
    const btn = document.getElementById('split-btn');
    btn.classList.toggle('active', state.split);
    btn.textContent = state.split ? 'ON' : 'OFF';
    if (socket) socket.emit('set_split', state.split);
}

// ─── Macros ──────────────────────────────────────
function renderMacros() {
    const list = document.getElementById('macro-list');
    list.innerHTML = '';
    state.macros.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'macro-item';
        item.innerHTML = `<span>${m.label}</span><span class="macro-del" onclick="deleteMacro(${i})">✕</span>`;
        item.onclick = () => applyMacro(i);
        list.appendChild(item);
    });
}

function addMacro() {
    const label = prompt('Macro name:');
    if (!label) return;
    const freq = prompt('Frequency (MHz):');
    const mode = prompt('Mode (FM/USB/LSB/AM):', 'FM');
    if (freq) {
        state.macros.push({ label, freq: parseFloat(freq) * 1e6, mode });
        renderMacros();
        saveMacros();
    }
}

function deleteMacro(i) {
    state.macros.splice(i, 1);
    renderMacros();
    saveMacros();
}

function applyMacro(i) {
    const m = state.macros[i];
    state.frequency = m.freq;
    state.mode = m.mode;
    updateFreqDisplay();
    updateModeButtons();
    if (socket) {
        socket.emit('set_freq', m.freq);
        socket.emit('set_mode', m.mode);
    }
}

function saveMacros() {
    localStorage.setItem('webrig-macros', JSON.stringify(state.macros));
}

function loadMacros() {
    const saved = localStorage.getItem('webrig-macros');
    if (saved) state.macros = JSON.parse(saved);
    renderMacros();
}

// ─── Stations ────────────────────────────────────
function renderStations(filter = '') {
    const tbody = document.getElementById('stations-tbody');
    const miniList = document.getElementById('station-list-mini');
    if (!tbody && !miniList) return;

    const filtered = state.stations.filter(s => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return s.call.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) ||
               s.location.toLowerCase().includes(q);
    });

    if (tbody) {
        tbody.innerHTML = filtered.map((s, i) => `
            <tr>
                <td><strong>${s.call}</strong></td>
                <td>${s.name || ''}</td>
                <td>${s.band || ''}</td>
                <td>${(s.freq / 1e6).toFixed(4)}</td>
                <td>${s.mode || 'FM'}</td>
                <td>${s.shift || 'NONE'}</td>
                <td>${s.offset ? (s.offset / 1e6).toFixed(3) : '—'}</td>
                <td>${s.ctcss ? s.ctcss + ' Hz' : '—'}</td>
                <td>${s.location || ''}</td>
                <td><button onclick='applyStation(${i})'>→ Tune</button></td>
            </tr>
        `).join('');
    }

    if (miniList) {
        miniList.innerHTML = filtered.slice(0, 20).map((s, i) => {
            const realIdx = state.stations.indexOf(s);
            return `<div class="station-item" onclick='applyStation(${realIdx})'>
                <span class="station-call">${s.call}</span>
                <span class="station-freq">${(s.freq / 1e6).toFixed(4)} ${s.mode || ''}</span>
            </div>`;
        }).join('');
    }
}

function filterStations(q) { renderStations(q); }

function applyStation(i) {
    const s = state.stations[i];
    state.frequency = s.freq;
    state.mode = s.mode || 'FM';
    updateFreqDisplay();
    updateModeButtons();
    if (socket) {
        socket.emit('set_freq', s.freq);
        socket.emit('set_mode', s.mode || 'FM');
    }
    showView('operator');
}

function addStation() {
    // TODO: modal form
    alert('Station form coming soon');
}

function importStations() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            // TODO: parse and merge
            console.log('Import:', ev.target.result);
        };
        reader.readAsText(file);
    };
    input.click();
}

function exportStations() {
    const data = JSON.stringify(state.stations, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'webrig-stations.json';
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Admin ───────────────────────────────────────
function adminTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('admin-' + name).classList.add('active');
}

async function scanSerialPorts() {
    try {
        const res = await fetch('/api/serial/ports');
        const data = await res.json();
        const sel = document.getElementById('cfg-serial-device');
        const ptt = document.getElementById('cfg-ptt-port');
        const prev = sel.value || '/dev/ttyUSB0';
        sel.innerHTML = '';
        ptt.innerHTML = '<option value="">(same as serial)</option>';
        for (const p of data.ports) {
            const opt = document.createElement('option');
            opt.value = p.device;
            opt.textContent = p.label;
            sel.appendChild(opt);
            const opt2 = opt.cloneNode(true);
            ptt.appendChild(opt2);
        }
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    } catch (e) { console.error('scanSerialPorts:', e); }
}

async function testRadio() {
    const model = document.getElementById('cfg-hamlib-model').value;
    const device = document.getElementById('cfg-serial-device').value;
    const baudrate = document.getElementById('cfg-baudrate').value;
    try {
        const res = await fetch('/api/radio/test', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({model, device, baudrate})
        });
        const data = await res.json();
        if (data.ok) alert('✅ Connection OK\n' + (data.info || ''));
        else alert('❌ Failed: ' + (data.error || 'unknown'));
    } catch (e) { alert('❌ Error: ' + e); }
}

async function saveInterfaces() {
    const cfg = {
        radio: {
            model_id: parseInt(document.getElementById('cfg-hamlib-model').value),
            serial_port: document.getElementById('cfg-serial-device').value,
            serial_baud: parseInt(document.getElementById('cfg-baudrate').value),
        },
        ptt: {
            mode: document.getElementById('cfg-ptt-mode').value,
            serial_port: document.getElementById('cfg-ptt-port').value,
        },
        audio: {
            device_rx: document.getElementById('cfg-rx-device').value,
            device_tx: document.getElementById('cfg-tx-device').value,
            sample_rate: parseInt(document.getElementById('cfg-sample-rate').value),
        },
        server: {host: '0.0.0.0', port: 8081},
        auth: {jwt_secret: 'webrig-dev', session_timeout_minutes: 120},
        logging: {level: 'INFO', format: 'text'},
    };
    try {
        const res = await fetch('/api/config/apply', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(cfg)
        });
        const data = await res.json();
        if (data.status === 'ok') alert('✅ Saved & applied. Radio: ' + (data.radio || 'connected'));
        else alert('⚠ Saved but: ' + (data.error || data.radio || 'check logs'));
    } catch (e) { alert('❌ Error: ' + e); }
}

async function scanAudioDevices() {
    try {
        const res = await fetch('/api/audio/devices');
        const data = await res.json();
        const rx = document.getElementById('cfg-rx-device');
        const tx = document.getElementById('cfg-tx-device');
        rx.innerHTML = '';
        tx.innerHTML = '';
        (data.capture || []).forEach(d => {
            const opt = document.createElement('option');
            opt.value = d; opt.textContent = d; rx.appendChild(opt);
        });
        (data.playback || []).forEach(d => {
            const opt = document.createElement('option');
            opt.value = d; opt.textContent = d; tx.appendChild(opt);
        });
    } catch (e) { console.error('scanAudioDevices:', e); }
}
function testAudio() { /* TODO */ }
function startCalWizard() { /* TODO */ }
function saveCalibration() { /* TODO */ }
function addUser() { /* TODO */ }

// ─── CTCSS Tone List ─────────────────────────────
const CTCSS_TONES = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9, 183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];

const DCS_CODES = [23, 25, 26, 31, 32, 36, 43, 47, 51, 53, 54, 65, 71, 72, 73, 74, 114, 115, 116, 122, 125, 131, 132, 134, 143, 145, 152, 155, 156, 162, 165, 172, 174, 205, 212, 223, 225, 226, 243, 244, 245, 246, 251, 252, 255, 261, 263, 265, 266, 271, 274, 306, 311, 315, 325, 331, 332, 343, 346, 351, 356, 364, 365, 371, 411, 412, 413, 423, 431, 432, 445, 446, 452, 454, 455, 462, 464, 465, 466, 503, 506, 516, 523, 526, 532, 546, 565, 606, 612, 624, 627, 631, 632, 654, 662, 664, 703, 712, 723, 731, 732, 734, 743, 754];

function populateTones() {
    const ctcss = document.getElementById('ctcss-select');
    CTCSS_TONES.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t.toFixed(1) + ' Hz';
        ctcss.appendChild(opt);
    });
    const dcs = document.getElementById('dcs-select');
    DCS_CODES.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = 'D' + c.toString().padStart(3, '0');
        dcs.appendChild(opt);
    });
}

// ─── Auth ────────────────────────────────────────
function logout() {
    fetch('/logout', { method: 'GET' }).then(() => window.location.reload());
}

// ─── Setup ──────────────────────────────────────
function setupTab(name, btn) {
    document.querySelectorAll('.setup-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.setup-tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('setup-' + name).classList.add('active');
}

function togglePttSerial() {
    const mode = document.getElementById('setup-ptt-mode').value;
    document.getElementById('setup-ptt-port').disabled = (mode === 'hamlib' || mode === 'vox');
}

function getSetupConfig() {
    return {
        radio: {
            model_id: parseInt(document.getElementById('setup-model').value) || 1,
            serial_port: document.getElementById('setup-device').value,
            serial_baud: parseInt(document.getElementById('setup-baudrate').value),
            data_bits: parseInt(document.getElementById('setup-databits').value),
            stop_bits: parseInt(document.getElementById('setup-stopbits').value),
            parity: document.getElementById('setup-parity').value,
            flow_control: document.getElementById('setup-flow').value,
        },
        audio: {
            device_rx: document.getElementById('setup-rx-device').value,
            device_tx: document.getElementById('setup-tx-device').value,
            sample_rate: 8000,
            chunk_ms: 20,
        },
        ptt: {
            mode: document.getElementById('setup-ptt-mode').value,
            serial_port: document.getElementById('setup-ptt-port').value,
            tx_timeout: parseInt(document.getElementById('setup-tx-timeout').value),
        },
    };
}

async function scanSerialPortsSetup() {
    try {
        const res = await fetch('/api/serial/ports');
        const data = await res.json();
        const sel = document.getElementById('setup-device');
        const prev = sel.value;
        sel.innerHTML = '';
        for (const p of data.ports) {
            const opt = document.createElement('option');
            opt.value = p.device;
            opt.textContent = p.label;
            sel.appendChild(opt);
        }
        if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
    } catch (e) { console.error('scanSerialPortsSetup:', e); }
}

async function testRadioConnection() {
    const r = document.getElementById('radio-test-result');
    r.textContent = '🔌 Testing connection...';
    r.className = 'setup-test-result';

    try {
        const cfg = getSetupConfig().radio;
        const resp = await fetch('/api/radio/test', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(cfg),
        });
        const data = await resp.json();
        if (data.ok) {
            r.textContent = '✅ Connected! Info: ' + (data.info || 'OK');
            r.className = 'setup-test-result ok';
        } else {
            r.textContent = '❌ ' + (data.error || 'Connection failed');
            r.className = 'setup-test-result fail';
        }
    } catch (e) {
        r.textContent = '❌ Error: ' + e.message;
        r.className = 'setup-test-result fail';
    }
}

async function saveSetup() {
    const cfg = getSetupConfig();
    const profileId = document.getElementById('setup-profile-select')?.value;
    if (profileId) cfg._profile_id = profileId;
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(cfg),
        });
        const r = document.getElementById('radio-test-result') || {};
        if (r.textContent !== undefined) { r.textContent = '💾 Configuration saved.'; r.className = 'setup-test-result ok'; }
        // Refresh profile data
        await loadProfiles();
    } catch (e) { alert('Save failed: ' + e.message); }
}

async function applySetup() {
    const cfg = getSetupConfig();
    const profileId = document.getElementById('setup-profile-select')?.value;
    const r = document.getElementById('radio-test-result');
    r.textContent = '⚡ Applying configuration...';

    try {
        let resp, data;
        if (profileId) {
            // Use profile-based connect endpoint
            // First save the profile, then connect
            cfg._profile_id = profileId;
            await fetch('/api/config', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(cfg),
            });
            resp = await fetch(`/api/radios/${profileId}/connect`, { method: 'POST' });
            data = await resp.json();
        } else {
            // Fallback: flat config apply
            resp = await fetch('/api/config/apply', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(cfg),
            });
            data = await resp.json();
        }
        if (data.status === 'ok') {
            r.textContent = '✅ Applied! Radio: ' + (data.radio || 'connected');
            r.className = 'setup-test-result ok';
            currentProfileId = profileId || data.active;
            await loadProfiles();
        } else {
            r.textContent = '⚠ ' + (data.error || data.radio || 'Failed');
            r.className = 'setup-test-result fail';
        }
    } catch (e) {
        r.textContent = '❌ Apply failed: ' + e.message;
        r.className = 'setup-test-result fail';
    }
}

async function scanAudio() {
    try {
        const resp = await fetch('/api/audio/devices');
        const data = await resp.json();
        const rxSel = document.getElementById('setup-rx-device');
        const txSel = document.getElementById('setup-tx-device');
        const prevRx = rxSel.value;
        const prevTx = txSel.value;
        rxSel.innerHTML = '';
        txSel.innerHTML = '';

        // New API returns structured devices with name/hw/label
        const capture = data.capture || [];
        const playback = data.playback || [];
        const allDevices = [...capture, ...playback];

        // "default" always first
        rxSel.add(new Option('default', 'default'));
        txSel.add(new Option('default', 'default'));

        if (allDevices.length === 0) return;

        // Deduplicate by hw string
        const seen = new Set();
        allDevices.forEach(d => {
            const hw = d.hw || d;
            if (seen.has(hw)) return;
            seen.add(hw);
            rxSel.add(new Option(d.label || hw, hw));
            txSel.add(new Option(d.label || hw, hw));
        });

        // Restore previous selections if still valid
        if ([...rxSel.options].some(o => o.value === prevRx)) rxSel.value = prevRx;
        if ([...txSel.options].some(o => o.value === prevTx)) txSel.value = prevTx;
    } catch (e) {
        console.error('Audio scan failed:', e);
    }
}

function testRxAudio() { alert('RX audio test — coming soon'); }
function testTxAudio() { alert('TX audio test — coming soon'); }

async function testPTT() {
    if (!socket || !state.connected) {
        alert('Radio not connected');
        return;
    }
    const r = document.getElementById('ptt-test-result');
    r.textContent = '🔴 Keying PTT for 2s...';
    r.className = 'setup-test-result';
    socket.emit('set_ptt', true);
    setTimeout(() => {
        socket.emit('set_ptt', false);
        r.textContent = '✅ PTT test complete';
        r.className = 'setup-test-result ok';
        setTimeout(() => r.textContent = '', 3000);
    }, 2000);
}

async function loadConfigIntoSetup() {
    // Load profile list and fill the active profile into the form
    await loadProfiles();
    if (currentProfileId) {
        document.getElementById('setup-profile-select').value = currentProfileId;
        loadProfileIntoSetup(currentProfileId);
    }
}

// ─── Radio Profiles ────────────────────────────────
let allProfiles = [];
let currentProfileId = null;

async function loadProfiles() {
    try {
        const resp = await fetch('/api/radios');
        const data = await resp.json();
        allProfiles = data.radios || [];
        currentProfileId = data.active;
        renderProfileSelector();
        renderRadioSwitcher();
    } catch (e) {
        console.error('Failed to load profiles:', e);
    }
}

function renderProfileSelector() {
    const sel = document.getElementById('setup-profile-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';
    allProfiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name + (p.active ? ' ●' : '');
        if (p.id === currentProfileId) opt.selected = true;
        sel.appendChild(opt);
    });
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderRadioSwitcher() {
    const sel = document.getElementById('radio-switcher');
    if (!sel || allProfiles.length <= 1) {
        if (sel) sel.style.display = 'none';
        return;
    }
    sel.style.display = '';
    sel.innerHTML = '';
    allProfiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.active) opt.selected = true;
        sel.appendChild(opt);
    });
}

function onProfileSelect() {
    const sel = document.getElementById('setup-profile-select');
    if (!sel) return;
    const pid = sel.value;
    if (pid) loadProfileIntoSetup(pid);
}

async function switchRadio() {
    const sel = document.getElementById('radio-switcher');
    if (!sel) return;
    const pid = sel.value;
    if (!pid || pid === currentProfileId) return;

    try {
        const resp = await fetch(`/api/radios/${pid}/connect`, { method: 'POST' });
        const data = await resp.json();
        if (data.status === 'ok') {
            currentProfileId = pid;
            await loadProfiles(); // refresh selector
        } else {
            alert('Switch failed: ' + (data.radio || data.error));
        }
    } catch (e) {
        alert('Switch failed: ' + e.message);
    }
}

async function loadProfileIntoSetup(profileId) {
    const profile = allProfiles.find(p => p.id === profileId);
    if (!profile) return;

    const r = profile;
    const a = profile.audio || {};
    const p = profile.ptt || {};

    // Profile name
    // (set only via profile selector, not from form)

    // Radio settings
    if (document.getElementById('setup-model')) {
        document.getElementById('setup-model').value = r.model_id || '';
        // Show readable radio name in search field
        const modelObj = allModels.find(m => m.id === r.model_id);
        document.getElementById('setup-model-search').value = modelObj ? modelObj.label : `Model #${r.model_id}`;
        document.getElementById('model-search-results')?.classList.remove('visible');
    }
    document.getElementById('setup-device').value = r.serial_port || '/dev/ttyUSB0';
    document.getElementById('setup-baudrate').value = r.serial_baud || 19200;
    if (document.getElementById('setup-databits')) document.getElementById('setup-databits').value = r.data_bits || 8;
    if (document.getElementById('setup-stopbits')) document.getElementById('setup-stopbits').value = r.stop_bits || 1;
    if (document.getElementById('setup-parity')) document.getElementById('setup-parity').value = r.parity || 'None';
    if (document.getElementById('setup-flow')) document.getElementById('setup-flow').value = r.flow_control || 'None';

    // Audio
    document.getElementById('setup-rx-device').value = a.device_rx || 'default';
    document.getElementById('setup-tx-device').value = a.device_tx || 'default';
    if (document.getElementById('setup-sample-rate')) document.getElementById('setup-sample-rate').value = a.sample_rate || 48000;
    if (document.getElementById('setup-chunk-ms')) document.getElementById('setup-chunk-ms').value = a.chunk_ms || 80;

    // PTT
    document.getElementById('setup-ptt-mode').value = p.mode || 'hamlib';
    if (document.getElementById('setup-ptt-port')) document.getElementById('setup-ptt-port').value = p.serial_port || '';
    if (document.getElementById('setup-tx-timeout')) document.getElementById('setup-tx-timeout').value = p.tx_timeout || 180;
    togglePttSerial();
}

async function addNewProfile() {
    const name = prompt('Name for new radio profile:');
    if (!name) return;
    const profileId = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!profileId) { alert('Invalid name'); return; }
    if (allProfiles.find(p => p.id === profileId)) { alert('Profile already exists'); return; }

    // Create with current form values as template
    const cfg = getSetupConfig();
    const profile = {
        name: name,
        model_id: cfg.radio.model_id,
        serial_port: cfg.radio.serial_port,
        serial_baud: cfg.radio.serial_baud,
        data_bits: cfg.radio.data_bits,
        stop_bits: cfg.radio.stop_bits,
        parity: cfg.radio.parity,
        flow_control: cfg.radio.flow_control,
        audio: cfg.audio,
        ptt: cfg.ptt,
    };

    try {
        const resp = await fetch('/api/radios', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: profileId, ...profile }),
        });
        const data = await resp.json();
        if (data.status === 'ok') {
            await loadProfiles();
            document.getElementById('setup-profile-select').value = profileId;
            loadProfileIntoSetup(profileId);
        } else {
            alert('Error: ' + (data.error || 'Unknown'));
        }
    } catch (e) { alert('Failed: ' + e.message); }
}

async function deleteProfile() {
    if (allProfiles.length <= 1) { alert('Cannot delete the last profile'); return; }
    const pid = document.getElementById('setup-profile-select').value;
    if (!pid) return;
    if (!confirm(`Delete profile "${pid}"?`)) return;

    try {
        const resp = await fetch(`/api/radios/${pid}`, { method: 'DELETE' });
        const data = await resp.json();
        if (data.status === 'ok') {
            await loadProfiles();
            // Load the now-active profile
            const newActive = data.data?.active;
            if (newActive) {
                document.getElementById('setup-profile-select').value = newActive;
                loadProfileIntoSetup(newActive);
            }
        } else {
            alert('Error: ' + (data.error || 'Unknown'));
        }
    } catch (e) { alert('Failed: ' + e.message); }
}

// ─── Hamlib Model Search ────────────────────────
let allModels = [];

async function loadModels() {
    try {
        const resp = await fetch('/api/rig/models');
        const data = await resp.json();
        allModels = data.models || [];
        // Populate datalist for native autocomplete
        const datalist = document.getElementById('model-list');
        datalist.innerHTML = '';
        allModels.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.label;
            opt.dataset.id = m.id;
            datalist.appendChild(opt);
        });
    } catch (e) {
        console.error('Failed to load models:', e);
    }
}

function filterModels(query) {
    const results = document.getElementById('model-search-results');
    const q = query.toLowerCase().trim();

    if (!q) {
        results.classList.remove('visible');
        return;
    }

    const matches = allModels
        .filter(m => m.label.toLowerCase().includes(q))
        .slice(0, 30);

    if (matches.length === 0) {
        results.innerHTML = '<div class="model-item">No match</div>';
        results.classList.add('visible');
        return;
    }

    results.innerHTML = matches.map(m =>
        `<div class="model-item" onclick="selectModel(${m.id}, '${m.label.replace(/'/g, "\\'")}')">
            <span><span class="model-name">${m.name}</span> <span class="model-mfg">${m.mfg}</span></span>
            <span class="model-id">#${m.id}</span>
        </div>`
    ).join('');
    results.classList.add('visible');

    // Also check if text matches a label exactly → set model ID
    const exact = allModels.find(m => m.label.toLowerCase() === q);
    if (exact) {
        document.getElementById('setup-model').value = exact.id;
    }
}

function selectModel(id, label) {
    document.getElementById('setup-model').value = id;
    document.getElementById('setup-model-search').value = label;
    document.getElementById('model-search-results').classList.remove('visible');
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.model-select-wrapper')) {
        document.getElementById('model-search-results')?.classList.remove('visible');
    }
});

// ─── Init ────────────────────────────────────────
// ─── Audio Toggle ────────────────────────────────
let audioActive = false;
const rxAudio = new RxAudio();
const txAudio = new TxAudio();
window.rxAudio = rxAudio;
window.txAudio = txAudio;

async function toggleAudio() {
    const btn = document.getElementById('btn-audio');
    const icon = btn.querySelector('.audio-icon');
    if (!audioActive) {
        btn.classList.add('active');
        icon.textContent = '🔊';
        audioActive = true;
        await rxAudio.start();
        await txAudio.start();
    } else {
        btn.classList.remove('active');
        icon.textContent = '🔇';
        audioActive = false;
        rxAudio.stop();
        txAudio.stop();
    }
}

function init() {
    populateTones();
    loadMacros();
    renderStations();
    updateFreqDisplay();

    // Frequency input handlers
    const freqInput = document.getElementById('freq-input');
    if (freqInput) {
        freqInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitFreq(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelFreq(); }
        });
        freqInput.addEventListener('blur', () => commitFreq());
    }

    // VFO box click = select VFO
    document.getElementById('vfo-a-box')?.addEventListener('click', () => selectVFO('VFOA'));
    document.getElementById('vfo-b-box')?.addEventListener('click', () => selectVFO('VFOB'));

    // Analog S-Meter init
    const smeterCanvas = document.getElementById('smeter-canvas');
    if (smeterCanvas) {
        window.analogSMeter = new AnalogSMeter(smeterCanvas);
    }

    // Mic level → Analog S-Meter during TX + TX bar
    txAudio.onMicLevel = (level) => {
        updateMicMeter(level);
        updateTxMeter(level);
        if (window.analogSMeter) window.analogSMeter.updateTXLevel(level);
    };

    // RX audio level meter
    rxAudio.onRxLevel = (level) => updateRxMeter(level);

    // Peak hold slider
    const peakSlider = document.getElementById('peak-hold-time');
    peakSlider.oninput = () => {
        state.peakHoldTime = parseInt(peakSlider.value);
        document.getElementById('peak-hold-val').textContent = state.peakHoldTime + 's';
    };

    // Check admin status
    if (window.CURRENT_USER && window.CURRENT_USER.admin) {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
    }
    if (window.CURRENT_USER) {
        document.getElementById('active-user').textContent = '👤 ' + window.CURRENT_USER.name;
    }

    initSocket();
    loadConfigIntoSetup();
    loadModels();
    scanSerialPortsSetup();
    scanAudio();
}

document.addEventListener('DOMContentLoaded', init);
