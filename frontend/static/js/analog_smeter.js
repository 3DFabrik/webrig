/**
 * WebRig – Analog S-Meter with dual scale
 * Adapted from Q-Remote V3.
 * RX: Signal strength (S-units, dB relative to S9)
 * TX: Mic modulation level (dBFS, 0 dB = clipping)
 */

class AnalogSMeter {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.canvas.width = 260;
        this.canvas.height = 80;

        this.currentAngle = 0;
        this.targetAngle = 0;
        this.decayTimer = null;
        this.isTX = false;
        this.hasRXSignal = false;
        this.rxGlow = 0;
        this.txGlow = 0;
        this.rxGlowTarget = 0;
        this.txGlowTarget = 0;

        this.bgColor = '#1a1a18';
        this.scaleColor = '#c8c0a0';
        this.needleColor = '#cc2200';
        this.accentColor = '#ffaa00';
        this.greenZone = '#00aa44';

        this.draw();
    }

    /** Update with dB relative to S9 (Hamlib STRENGTH level). */
    updateRX(db) {
        if (this.isTX) return;
        // Convert dB to sRaw: S9=0dB→9, each S-unit=6dB, range 0-15
        const sRaw = Math.max(0, Math.min(15, 9 + db / 6));
        this.hasRXSignal = db > -54;
        this.rxGlowTarget = db > -54 ? 1 : 0;
        const normalized = sRaw / 15;
        this.targetAngle = normalized;
        this.animate('rx');
    }

    /** Update with mic RMS level during TX. */
    updateTXLevel(rms) {
        if (!this.isTX) this.isTX = true;
        this.txGlowTarget = 1;
        this.rxGlowTarget = 0;
        const minDb = -40;
        let db = rms > 0 ? 20 * Math.log10(rms) : minDb;
        db = Math.max(minDb, Math.min(0, db));
        const normalized = (db - minDb) / (0 - minDb);
        this.targetAngle = normalized;
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
            const glowSpeed = 0.04;
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
            let speed;
            if (mode === 'rx') {
                speed = diff > 0 ? 0.2 : 0.08;
            } else {
                speed = diff > 0 ? 0.35 : 0.15;
            }
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

        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, w, h);

        const cx = w / 2;
        const cy = h + 35;
        const radius = h + 28;

        const sweepAngle = Math.PI * 0.72;
        const startAngle = Math.PI * 1.5 - sweepAngle / 2;
        const endAngle = Math.PI * 1.5 + sweepAngle / 2;

        // Outer arc
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle);
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.scaleColor;
        ctx.stroke();

        // Inner arc
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 20, startAngle, endAngle);
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = this.scaleColor + '40';
        ctx.stroke();

        if (this.isTX) {
            this._drawTXScale(ctx, cx, cy, radius, startAngle, endAngle);
        } else {
            this._drawRXScale(ctx, cx, cy, radius, startAngle, endAngle);
        }

        // Needle
        const needleAngle = startAngle + this.currentAngle * (endAngle - startAngle);
        const needleLen = radius - 4;
        const whiteTipLen = 15;
        const redLen = needleLen - whiteTipLen;

        const nx = cx + Math.cos(needleAngle) * needleLen;
        const ny = cy + Math.sin(needleAngle) * needleLen;
        const rx = cx + Math.cos(needleAngle) * redLen;
        const ry = cy + Math.sin(needleAngle) * redLen;

        // Shadow
        ctx.beginPath();
        ctx.moveTo(cx + 1, cy + 1);
        ctx.lineTo(nx + 1, ny + 1);
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.stroke();

        // Red part
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(rx, ry);
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.needleColor;
        ctx.stroke();

        // White tip
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(nx, ny);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#c8c0a0';
        ctx.stroke();

        // RX/TX LED indicators
        this._drawIndicators(ctx);
    }

    _drawIndicators(ctx) {
        const indicatorX = 14;
        const rxY = 18;
        const txY = 34;

        // RX LED
        const rxIntensity = this.rxGlow;
        const rxA = 0.09 + 0.91 * rxIntensity;
        ctx.shadowBlur = 12 * rxIntensity;
        ctx.shadowColor = 'rgba(0,255,68,' + rxA + ')';
        ctx.fillStyle = 'rgba(0,255,68,' + rxA + ')';
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('RX', indicatorX, rxY);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'rgba(0,0,0,0)';

        // TX LED
        const txIntensity = this.txGlow;
        const txA = 0.09 + 0.91 * txIntensity;
        ctx.shadowBlur = 16 * txIntensity;
        ctx.shadowColor = 'rgba(255,68,68,' + txA + ')';
        ctx.fillStyle = 'rgba(255,68,68,' + txA + ')';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('TX', indicatorX, txY);
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'rgba(0,0,0,0)';
    }

    _drawRXScale(ctx, cx, cy, radius, startAngle, endAngle) {
        const totalSweep = endAngle - startAngle;

        const tickDefs = [
            { s: 1, label: 'S1', color: this.scaleColor, major: false },
            { s: 2, label: 'S2', color: this.scaleColor, major: true },
            { s: 3, label: 'S3', color: this.scaleColor, major: false },
            { s: 4, label: 'S4', color: this.scaleColor, major: true },
            { s: 5, label: 'S5', color: this.scaleColor, major: false },
            { s: 6, label: 'S6', color: this.greenZone, major: true },
            { s: 7, label: 'S7', color: this.greenZone, major: false },
            { s: 8, label: 'S8', color: this.greenZone, major: true },
            { s: 9, label: 'S9', color: this.accentColor, major: true },
            { s: 10, label: '+10', color: this.accentColor, major: false },
            { s: 11, label: '+20', color: this.accentColor, major: true },
            { s: 12, label: '+30', color: this.accentColor, major: false },
            { s: 13, label: '+40', color: this.accentColor, major: true },
            { s: 14, label: '+50', color: this.accentColor, major: false },
            { s: 15, label: '+60', color: this.accentColor, major: true },
        ];

        // Green zone from S6 up
        const s6Angle = startAngle + (6 / 15) * totalSweep;
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, s6Angle, endAngle);
        ctx.lineWidth = 4;
        ctx.strokeStyle = this.greenZone + '30';
        ctx.stroke();

        for (const tick of tickDefs) {
            const frac = tick.s / 15;
            const angle = startAngle + frac * totalSweep;
            const tickLen = tick.major ? 12 : 7;
            const x1 = cx + Math.cos(angle) * (radius - tickLen);
            const y1 = cy + Math.sin(angle) * (radius - tickLen);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = tick.major ? 1.5 : 0.8;
            ctx.strokeStyle = tick.color;
            ctx.stroke();

            if (tick.major) {
                const labelR = radius - 22;
                const lx = cx + Math.cos(angle) * labelR;
                const ly = cy + Math.sin(angle) * labelR;
                ctx.fillStyle = tick.color;
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(tick.label, lx, ly);
            }
        }

        ctx.fillStyle = this.scaleColor + '80';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RX', cx, cy - radius + 42);
    }

    _drawTXScale(ctx, cx, cy, radius, startAngle, endAngle) {
        const totalSweep = endAngle - startAngle;

        const greenEnd = (-12 + 40) / 40;
        const yellowEnd = (-3 + 40) / 40;

        // Green zone
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle, startAngle + greenEnd * totalSweep);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#00aa4430';
        ctx.stroke();

        // Yellow zone
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle + greenEnd * totalSweep, startAngle + yellowEnd * totalSweep);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#ffaa0030';
        ctx.stroke();

        // Red zone
        ctx.beginPath();
        ctx.arc(cx, cy, radius - 1, startAngle + yellowEnd * totalSweep, endAngle);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#cc220040';
        ctx.stroke();

        const dbLabels = [
            { db: -40, label: '-40' },
            { db: -30, label: '-30' },
            { db: -20, label: '-20' },
            { db: -10, label: '-10' },
            { db: -6, label: '-6' },
            { db: -3, label: '-3' },
            { db: 0, label: '0' },
        ];

        for (const tick of dbLabels) {
            const frac = (tick.db + 40) / 40;
            const angle = startAngle + frac * totalSweep;
            const tickLen = tick.db === 0 ? 14 : 10;
            const x1 = cx + Math.cos(angle) * (radius - tickLen);
            const y1 = cy + Math.sin(angle) * (radius - tickLen);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;

            let color;
            if (tick.db >= -3) color = '#cc2200';
            else if (tick.db >= -12) color = '#ffaa00';
            else color = this.scaleColor;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = tick.db === 0 ? 2.5 : 1.5;
            ctx.strokeStyle = color;
            ctx.stroke();

            const labelR = radius - 22;
            const lx = cx + Math.cos(angle) * labelR;
            const ly = cy + Math.sin(angle) * labelR;
            ctx.fillStyle = color;
            ctx.font = tick.db === 0 ? 'bold 11px monospace' : 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tick.label, lx, ly);
        }

        // Minor ticks
        for (let db = -35; db <= -5; db += 10) {
            const frac = (db + 40) / 40;
            const angle = startAngle + frac * totalSweep;
            const x1 = cx + Math.cos(angle) * (radius - 5);
            const y1 = cy + Math.sin(angle) * (radius - 5);
            const x2 = cx + Math.cos(angle) * radius;
            const y2 = cy + Math.sin(angle) * radius;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.lineWidth = 0.5;
            ctx.strokeStyle = this.scaleColor + '40';
            ctx.stroke();
        }

        ctx.fillStyle = this.scaleColor + '60';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('dBFS', cx, cy - radius + 50);

        ctx.fillStyle = '#cc2200';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('MOD', cx, cy - radius + 42);
    }
}
