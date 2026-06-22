/**
 * WebRig – Analog S-Meter (Modern Style)
 * RX: Signal strength (S-units)
 * TX: Mic modulation level (dBFS)
 */

class AnalogSMeter {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.canvas.width = 360;
        this.canvas.height = 120;

        this.currentAngle = 0;
        this.targetAngle = 0;
        this.decayTimer = null;
        this.isTX = false;
        this.rxGlow = 0;
        this.txGlow = 0;
        this.rxGlowTarget = 0;
        this.txGlowTarget = 0;

        // Modern color palette
        this.bgColor = '#000000';
        this.scaleColor = '#ffffff';
        this.scaleDim = '#666666';
        this.needleColor = '#ff3333';
        this.accentColor = '#ffffff';
        this.greenZone = '#33dd55';
        this.yellowZone = '#ffaa00';
        this.redZone = '#ff3333';

        this.draw();
    }

    updateRX(db) {
        if (this.isTX) return;
        const sRaw = Math.max(0, Math.min(15, 9 + db / 6));
        this.rxGlowTarget = db > -54 ? 1 : 0;
        this.targetAngle = sRaw / 15;
        this.animate('rx');
    }

    updateTXLevel(rms) {
        if (!this.isTX) this.isTX = true;
        this.txGlowTarget = 1;
        this.rxGlowTarget = 0;
        const minDb = -40;
        let db = rms > 0 ? 20 * Math.log10(rms) : minDb;
        db = Math.max(minDb, Math.min(0, db));
        this.targetAngle = (db - minDb) / (0 - minDb);
        this.animate('tx');
    }

    setRX(db) {
        this.isTX = false;
        this.txGlowTarget = 0;
        this.updateRX(db);
    }

    setTXMode() {
        this.isTX = true;
        this.txGlowTarget = 1;
        this.rxGlowTarget = 0;
        this.targetAngle = 0;
        this.animate('tx');
    }

    animate(mode) {
        if (this.decayTimer) return;
        const step = () => {
            const diff = this.targetAngle - this.currentAngle;
            const glowSpeed = 0.06;
            this.rxGlow += (this.rxGlowTarget - this.rxGlow) * glowSpeed;
            this.txGlow += (this.txGlowTarget - this.txGlow) * glowSpeed;
            const glowDone = Math.abs(this.rxGlowTarget - this.rxGlow) < 0.003 &&
                             Math.abs(this.txGlowTarget - this.txGlow) < 0.003;
            if (Math.abs(diff) < 0.003 && glowDone) {
                this.currentAngle = this.targetAngle;
                this.rxGlow = this.rxGlowTarget;
                this.txGlow = this.txGlowTarget;
                this.draw();
                this.decayTimer = null;
                return;
            }
            let speed = mode === 'rx' ? (diff > 0 ? 0.2 : 0.08) : (diff > 0 ? 0.35 : 0.15);
            this.currentAngle += diff * speed;
            this.draw();
            this.decayTimer = requestAnimationFrame(step);
        };
        this.decayTimer = requestAnimationFrame(step);
    }

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h + 50;
        const radius = h + 42;

        const sweepAngle = Math.PI * 0.72;
        const startAngle = Math.PI * 1.5 - sweepAngle / 2;
        const endAngle = Math.PI * 1.5 + sweepAngle / 2;

        // Outer arc
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.scaleColor;
        ctx.stroke();

        if (this.isTX) {
            this._drawTXScale(ctx, cx, cy, radius, startAngle, endAngle);
        } else {
            this._drawRXScale(ctx, cx, cy, radius, startAngle, endAngle);
        }

        // Needle
        const needleAngle = startAngle + this.currentAngle * (endAngle - startAngle);
        const needleLen = radius - 4;
        const tipLen = 18;

        const nx = cx + Math.cos(needleAngle) * needleLen;
        const ny = cy + Math.sin(needleAngle) * needleLen;
        const tx = cx + Math.cos(needleAngle) * (needleLen - tipLen);
        const ty = cy + Math.sin(needleAngle) * (needleLen - tipLen);

        // Needle shaft (red)
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = this.needleColor;
        ctx.stroke();

        // Needle tip (white)
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(nx, ny);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = this.scaleColor;
        ctx.stroke();

        // Center pivot
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = this.scaleColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = this.needleColor;
        ctx.fill();

        // Indicators
        this._drawIndicators(ctx);
    }

    _drawIndicators(ctx) {
        const x = 18;
        const rxY = 22;
        const txY = 44;

        // RX
        const rxI = this.rxGlow;
        const rxA = 0.15 + 0.85 * rxI;
        ctx.fillStyle = `rgba(51,221,85,${rxA})`;
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('RX', x, rxY);

        // TX
        const txI = this.txGlow;
        const txA = 0.15 + 0.85 * txI;
        ctx.fillStyle = `rgba(255,51,51,${txA})`;
        ctx.font = 'bold 16px monospace';
        ctx.fillText('TX', x, txY);
    }

    _drawRXScale(ctx, cx, cy, radius, startAngle, endAngle) {
        const totalSweep = endAngle - startAngle;

        const tickDefs = [
            { s: 1, label: '', major: false },
            { s: 2, label: 'S2', major: true },
            { s: 3, label: '', major: false },
            { s: 4, label: 'S4', major: true },
            { s: 5, label: '', major: false },
            { s: 6, label: 'S6', major: true },
            { s: 7, label: '', major: false },
            { s: 8, label: 'S8', major: true },
            { s: 9, label: 'S9', major: true, red: true },
            { s: 10, label: '', major: false, red: true },
            { s: 11, label: '+20', major: true, red: true },
            { s: 12, label: '', major: false, red: true },
            { s: 13, label: '+40', major: true, red: true },
            { s: 14, label: '', major: false, red: true },
            { s: 15, label: '+60', major: true, red: true },
        ];



        for (const tick of tickDefs) {
            const frac = tick.s / 15;
            const angle = startAngle + frac * totalSweep;
            const tickLen = tick.major ? 14 : 7;
            const x1 = cx + Math.cos(angle) * (radius - tickLen);
            const y1 = cy + Math.sin(angle) * (radius - tickLen);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;
            const tickColor = tick.red ? this.redZone : this.scaleColor;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = tick.major ? 2 : 1;
            ctx.strokeStyle = tickColor;
            ctx.stroke();

            if (tick.major) {
                const labelR = radius - 28;
                const lx = cx + Math.cos(angle) * labelR;
                const ly = cy + Math.sin(angle) * labelR;
                ctx.fillStyle = tickColor;
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tick.label, lx, ly);
            }
        }

        ctx.fillStyle = this.scaleDim;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RX', cx, cy - radius + 52);
    }

    _drawTXScale(ctx, cx, cy, radius, startAngle, endAngle) {
        const totalSweep = endAngle - startAngle;

        const greenEnd = (-12 + 40) / 40;
        const yellowEnd = (-3 + 40) / 40;

        // Zone arcs
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle, startAngle + greenEnd * totalSweep);
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(51,221,85,0.2)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle + greenEnd * totalSweep, startAngle + yellowEnd * totalSweep);
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(255,170,0,0.2)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle + yellowEnd * totalSweep, endAngle);
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(255,51,51,0.2)';
        ctx.stroke();

        const dbLabels = [
            { db: -40, label: '-40' },
            { db: -30, label: '-30' },
            { db: -20, label: '-20' },
            { db: -12, label: '-12' },
            { db: -6, label: '-6' },
            { db: -3, label: '-3' },
            { db: 0, label: '0' },
        ];

        for (const tick of dbLabels) {
            const frac = (tick.db + 40) / 40;
            const angle = startAngle + frac * totalSweep;
            const tickLen = tick.db === 0 ? 16 : 12;
            const x1 = cx + Math.cos(angle) * (radius - tickLen);
            const y1 = cy + Math.sin(angle) * (radius - tickLen);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;

            let color;
            if (tick.db >= -3) color = this.redZone;
            else if (tick.db >= -12) color = this.yellowZone;
            else color = this.scaleColor;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = tick.db === 0 ? 3 : 2;
            ctx.strokeStyle = color;
            ctx.stroke();

            const labelR = radius - 28;
            const lx = cx + Math.cos(angle) * labelR;
            const ly = cy + Math.sin(angle) * labelR;
            ctx.fillStyle = color;
            ctx.font = tick.db === 0 ? 'bold 13px monospace' : 'bold 11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tick.label, lx, ly);
        }

        // Minor ticks
        for (let db = -35; db <= -5; db += 10) {
            const frac = (db + 40) / 40;
            const angle = startAngle + frac * totalSweep;
            const x1 = cx + Math.cos(angle) * (radius - 6);
            const y1 = cy + Math.sin(angle) * (radius - 6);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 1;
            ctx.strokeStyle = this.scaleDim;
            ctx.stroke();
        }

        ctx.fillStyle = this.scaleDim;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('dBFS', cx, cy - radius + 62);

        ctx.fillStyle = this.redZone;
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('MOD', cx, cy - radius + 52);
    }
}
