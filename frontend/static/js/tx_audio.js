/**
 * WebRig – TX Audio Module
 * Captures browser mic audio, encodes to μ-law, sends via WebSocket.
 * Adapted from Q-Remote V3.
 */

class TxAudio {
    constructor() {
        this.ws = null;
        this.audioCtx = null;
        this.processor = null;
        this.stream = null;
        this.connected = false;
        this.transmitting = false;
        this.onMicLevel = null;

        // μ-law encode table
        this._ulawEncode = new Uint8Array(65536);
        this._buildEncodeTable();
    }

    _buildEncodeTable() {
        const BIAS = 0x84;
        const CLIP = 32635;
        for (let i = 0; i < 65536; i++) {
            let sample = i - 32768;
            if (sample > CLIP) sample = CLIP;
            else if (sample < -CLIP) sample = -CLIP;
            const sign = sample < 0 ? 0x80 : 0x00;
            if (sign) sample = -sample;
            sample += BIAS;
            let exp;
            if (sample >= 0x4000) exp = 7;
            else if (sample >= 0x2000) exp = 6;
            else if (sample >= 0x1000) exp = 5;
            else if (sample >= 0x0800) exp = 4;
            else if (sample >= 0x0400) exp = 3;
            else if (sample >= 0x0200) exp = 2;
            else if (sample >= 0x0100) exp = 1;
            else exp = 0;
            const mantissa = (sample >> (exp + 3)) & 0x0F;
            this._ulawEncode[i] = (~(sign | (exp << 4) | mantissa)) & 0xFF;
        }
    }

    async start() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 8000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });
        } catch (e) {
            console.warn('[TxAudio] Mic access denied or unavailable:', e);
            return;
        }

        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 8000,
            });

            const source = this.audioCtx.createMediaStreamSource(this.stream);
            this.processor = this.audioCtx.createScriptProcessor(1024, 1, 1);

            this.processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);

                if (this.transmitting && this.onMicLevel) {
                    let sum = 0;
                    for (let i = 0; i < input.length; i++) {
                        sum += input[i] * input[i];
                    }
                    const rms = Math.sqrt(sum / input.length);
                    this.onMicLevel(Math.min(1.0, rms));
                }

                if (!this.transmitting || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
                    return;
                }

                const ulaw = new Uint8Array(input.length);
                for (let i = 0; i < input.length; i++) {
                    let s = Math.max(-1, Math.min(1, input[i]));
                    let s16 = s < 0 ? s * 32768 : s * 32767;
                    s16 = Math.round(s16);
                    const idx = (s16 + 32768) & 0xFFFF;
                    ulaw[i] = this._ulawEncode[idx];
                }
                this.ws.send(ulaw.buffer);
            };

            source.connect(this.processor);
            this.processor.connect(this.audioCtx.destination);

            this._connectWS();
        } catch (e) {
            console.error('[TxAudio] Failed to start:', e);
        }
    }

    _connectWS() {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${location.host}/audio/tx`;
        console.log('[TxAudio] Connecting to', wsUrl);

        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            this.connected = true;
            console.log('[TxAudio] WebSocket connected');
        };

        this.ws.onclose = () => {
            this.connected = false;
            console.log('[TxAudio] WebSocket closed');
        };

        this.ws.onerror = (e) => {
            console.error('[TxAudio] WebSocket error:', e);
        };
    }

    startTransmit() {
        this.transmitting = true;
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        console.log('[TxAudio] TX started');
    }

    stopTransmit() {
        this.transmitting = false;
        console.log('[TxAudio] TX stopped');
    }

    stop() {
        this.transmitting = false;
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        if (this.processor) {
            this.processor.disconnect();
            this.processor = null;
        }
        if (this.audioCtx) {
            this.audioCtx.close();
            this.audioCtx = null;
        }
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this.connected = false;
    }
}
