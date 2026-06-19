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

// ─── SocketIO (placeholder — will connect when backend is ready)
let socket = null;

function initSocket() {
    // TODO: socket = io({ auth: { token: '...' } });
    // For now, simulate connection state
    setConnectionState(false);
}

// ─── Connection State ─────────────────────────────
function setConnectionState(connected) {
    state.connected = connected;
    const dot = document.getElementById('rigctld-status');
    const text = document.getElementById('rigctld-status-text');
    if (connected) {
        dot.className = 'status-dot connected';
        text.textContent = 'Connected';
    } else {
        dot.className = 'status-dot disconnected';
        text.textContent = 'Disconnected';
    }
}

// ─── View Switching ──────────────────────────────
function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
}

// ─── VFO ─────────────────────────────────────────
function selectVFO(vfo) {
    state.selectedVFO = vfo;
    document.getElementById('vfo-a-btn').classList.toggle('active', vfo === 'VFOA');
    document.getElementById('vfo-b-btn').classList.toggle('active', vfo === 'VFOB');
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
    return (hz / 1e6).toFixed(6);
}

function updateFreqDisplay() {
    const mhz = formatFreq(state.frequency);
    const parts = mhz.split('.');
    const intPart = parts[0].padStart(3, '0');
    const decPart = (parts[1] || '').padEnd(6, '0');
    const allDigits = (intPart + decPart).split('');
    const digits = document.querySelectorAll('.freq-digit');
    digits.forEach((d, i) => {
        if (allDigits[i] !== undefined) d.textContent = allDigits[i];
    });
}

function tuneFreq(deltaHz) {
    state.frequency += deltaHz;
    if (state.frequency < 0) state.frequency = 0;
    updateFreqDisplay();
    if (socket) socket.emit('set_freq', state.frequency);
}

// ─── Mode ────────────────────────────────────────
function setMode(mode) {
    state.mode = mode;
    if (socket) socket.emit('set_mode', mode);
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

function updateSmeter(dbValue) {
    // dbValue is dB relative to S9 (Hamlib STRENGTH convention)
    // S0 = -127 dBm, S9 = -73 dBm, each S-unit = 6 dB
    const smeterPercent = dbToPercent(dbValue);
    const fill = document.getElementById('smeter-fill');
    const peak = document.getElementById('smeter-peak');

    fill.style.width = smeterPercent + '%';

    // Peak hold
    if (dbValue > state.peakHold) {
        state.peakHold = dbValue;
        peak.style.left = smeterPercent + '%';
        peak.style.opacity = '1';
        if (state.peakHoldTimer) clearTimeout(state.peakHoldTimer);
        state.peakHoldTimer = setTimeout(() => {
            state.peakHold = dbValue;
            peak.style.opacity = '0';
        }, state.peakHoldTime * 1000);
    }

    // Digital readout
    const sUnits = dbToSUnits(dbValue);
    const dbm = dbValue - 73; // relative to S9 → absolute dBm
    const uv = Math.pow(10, (dbm + 120) / 20);

    document.getElementById('smeter-s-units').textContent = formatSUnits(sUnits);
    document.getElementById('smeter-dbm').textContent = dbm.toFixed(0) + ' dBm';
    document.getElementById('smeter-uv').textContent = uv.toFixed(1) + ' μV';
    document.getElementById('smeter-raw').textContent = 'raw: ' + dbValue.toFixed(0);

    // Graph data
    state.smeterHistory.push({ t: Date.now(), v: dbValue });
    pruneHistory();
    drawSmeterGraph();

    // Check alarms
    checkAlarms(dbValue);
}

function dbToPercent(db) {
    // Map -127 dB (S0) to +60 dB over S9 to 0-100%
    // S0 = -127+73 = -54 from S9, S9+60 = +60
    const minDb = -54;
    const maxDb = 60;
    const clamped = Math.max(minDb, Math.min(maxDb, db));
    return ((clamped - minDb) / (maxDb - minDb)) * 100;
}

function dbToSUnits(db) {
    // db is relative to S9
    if (db >= 0) return 9 + db / 6;
    return Math.max(0, 9 + db / 6);
}

function formatSUnits(s) {
    if (s >= 9) {
        const over = Math.round((s - 9) * 6);
        return 'S9+' + over + 'dB';
    }
    return 'S' + Math.max(1, Math.round(s));
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
    startTxTimeout();
}

function pttUp() {
    if (!state.ptt) return;
    state.ptt = false;
    document.getElementById('ptt-btn').classList.remove('active');
    document.getElementById('tx-led').classList.remove('tx-active');
    document.getElementById('tx-led').textContent = 'RX';
    if (socket) socket.emit('set_ptt', false);
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
}

// ─── Signal Processing ───────────────────────────
function setAGC(mode) { if (socket) socket.emit('set_agc', mode); }
function setNB(val) { if (socket) socket.emit('set_nb', val / 100); }

function togglePreamp() {
    state.preamp = !state.preamp;
    const btn = document.getElementById('preamp-btn');
    btn.classList.toggle('active', state.preamp);
    btn.textContent = state.preamp ? 'ON' : 'OFF';
    if (socket) socket.emit('set_preamp', state.preamp);
}

function toggleAtt() {
    state.attenuator = !state.attenuator;
    const btn = document.getElementById('att-btn');
    btn.classList.toggle('active', state.attenuator);
    btn.textContent = state.attenuator ? 'ON' : 'OFF';
    if (socket) socket.emit('set_attenuator', state.attenuator);
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
    document.getElementById('mode-select').value = m.mode;
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
    document.getElementById('mode-select').value = s.mode || 'FM';
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

function testRigctld() { /* TODO */ }
function saveInterfaces() { /* TODO */ }
function scanAudioDevices() { /* TODO */ }
function testAudio() { /* TODO */ }
function restartRigctld() { /* TODO */ }
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

function testRadioConnection() {
    const r = document.getElementById('radio-test-result');
    r.textContent = 'Testing...';
    r.className = 'setup-test-result';
    // TODO: real API call
    setTimeout(() => {
        r.textContent = '⚠ Backend not connected yet';
        r.className = 'setup-test-result fail';
    }, 1000);
}

function startRigctld() {}
function stopRigctld() {}
function scanAudio() {}
function testRxAudio() {}
function testTxAudio() {}
function testPTT() {}
function saveSetup() {}
function applySetup() {}

// ─── Init ────────────────────────────────────────
function init() {
    populateTones();
    loadMacros();
    renderStations();
    updateFreqDisplay();

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

    // Simulated S-Meter for testing
    if (!socket) {
        simulateSmeter();
    }
}

function simulateSmeter() {
    // Demo: random S-Meter values for frontend testing
    setInterval(() => {
        const baseDb = -30 + Math.random() * 40; // S4-S7 range
        updateSmeter(baseDb);
    }, 200);
}

document.addEventListener('DOMContentLoaded', init);
