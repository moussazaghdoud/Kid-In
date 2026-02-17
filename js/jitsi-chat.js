/* ============================================
   Audio Chat - WebSocket Audio Relay
   Captures mic audio, sends PCM chunks via WebSocket,
   server relays to other players in the room.
   No WebRTC peer connections needed.
   ============================================ */

const AudioChat = {
    isActive: false,
    isMuted: false,
    _audioCtx: null,
    _localStream: null,
    _processor: null,
    _sourceNode: null,
    _silentGain: null,
    _playbackSchedule: new Map(), // peerId -> { nextTime }
    _targetSampleRate: 8000,      // telephone quality, low bandwidth

    async start(isHost, players, myId) {
        if (this.isActive) return;
        this.isActive = true;
        this._playbackSchedule = new Map();

        this._showUI('connecting');

        try {
            this._localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            console.log('[AudioChat] Microphone access granted');
        } catch (err) {
            console.error('[AudioChat] Microphone access denied:', err.name);
            this._showUI('error', err.name === 'NotAllowedError'
                ? 'Autorise le micro pour parler !'
                : 'Micro non disponible');
            this.isActive = false;
            return;
        }

        // Create AudioContext
        try {
            this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error('[AudioChat] AudioContext not supported');
            this._showUI('error', 'Audio non supporté');
            this.isActive = false;
            return;
        }

        if (this._audioCtx.state === 'suspended') {
            await this._audioCtx.resume();
        }

        const nativeSR = this._audioCtx.sampleRate;
        console.log('[AudioChat] Native sample rate:', nativeSR);

        this._sourceNode = this._audioCtx.createMediaStreamSource(this._localStream);

        // ScriptProcessor captures audio chunks
        this._processor = this._audioCtx.createScriptProcessor(4096, 1, 1);
        const downsampleRatio = nativeSR / this._targetSampleRate;

        this._processor.onaudioprocess = (e) => {
            if (this.isMuted || !this.isActive) return;
            const input = e.inputBuffer.getChannelData(0);

            // Skip silence
            let maxVal = 0;
            for (let i = 0; i < input.length; i++) {
                const abs = Math.abs(input[i]);
                if (abs > maxVal) maxVal = abs;
            }
            if (maxVal < 0.005) return;

            // Downsample to target rate and convert to Int16
            const outputLen = Math.floor(input.length / downsampleRatio);
            const pcm = new Int16Array(outputLen);
            for (let i = 0; i < outputLen; i++) {
                const sample = input[Math.floor(i * downsampleRatio)];
                pcm[i] = Math.max(-32768, Math.min(32767, sample * 32767));
            }

            // Send binary via WebSocket
            Multiplayer.sendAudio(pcm.buffer);
        };

        this._sourceNode.connect(this._processor);

        // Processor must connect to destination to fire events,
        // but use a silent gain node to prevent local mic echo
        this._silentGain = this._audioCtx.createGain();
        this._silentGain.gain.value = 0;
        this._processor.connect(this._silentGain);
        this._silentGain.connect(this._audioCtx.destination);

        // Receive audio from other players
        Multiplayer.onAudioChunk = (fromId, pcmArrayBuffer) => {
            this._playAudio(fromId, pcmArrayBuffer);
        };

        console.log('[AudioChat] Audio relay started');
        this._showUI('connected');
    },

    _playAudio(fromId, pcmArrayBuffer) {
        if (!this._audioCtx || !this.isActive) return;

        const pcm16 = new Int16Array(pcmArrayBuffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
            float32[i] = pcm16[i] / 32768;
        }

        // Create buffer at the fixed target rate (browser upsamples automatically)
        const buffer = this._audioCtx.createBuffer(1, float32.length, this._targetSampleRate);
        buffer.getChannelData(0).set(float32);

        const source = this._audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this._audioCtx.destination);

        // Schedule for gapless playback
        let schedule = this._playbackSchedule.get(fromId);
        if (!schedule) {
            schedule = { nextTime: this._audioCtx.currentTime + 0.1 };
            this._playbackSchedule.set(fromId, schedule);
        }

        const now = this._audioCtx.currentTime;
        if (schedule.nextTime < now) {
            // Gap detected - reset with small buffer
            schedule.nextTime = now + 0.05;
        }

        source.start(schedule.nextTime);
        schedule.nextTime += buffer.duration;
    },

    toggleMute() {
        if (!this._localStream) return;
        this.isMuted = !this.isMuted;
        this._localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });
        this._updateMuteButton();
    },

    stop() {
        console.log('[AudioChat] Stopping');

        Multiplayer.onAudioChunk = null;

        if (this._processor) {
            this._processor.disconnect();
            this._processor = null;
        }
        if (this._sourceNode) {
            this._sourceNode.disconnect();
            this._sourceNode = null;
        }
        if (this._silentGain) {
            this._silentGain.disconnect();
            this._silentGain = null;
        }
        if (this._audioCtx) {
            this._audioCtx.close().catch(() => {});
            this._audioCtx = null;
        }
        if (this._localStream) {
            this._localStream.getTracks().forEach(track => track.stop());
            this._localStream = null;
        }

        this._playbackSchedule.clear();

        // Clean up legacy elements
        const localVideo = document.getElementById('local-video');
        if (localVideo) localVideo.srcObject = null;
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) remoteVideo.srcObject = null;
        const widget = document.getElementById('video-chat-widget');
        if (widget) widget.classList.add('hidden');

        this.isActive = false;
        this.isMuted = false;

        this._hideUI();
    },

    _showUI(state, errorMsg) {
        const overlay = document.getElementById('audio-chat-overlay');
        if (!overlay) return;

        overlay.classList.add('ac-visible');

        const statusEl = document.getElementById('ac-status');
        const muteBtn = document.getElementById('ac-mute-btn');

        switch (state) {
            case 'connecting':
                statusEl.textContent = 'Connexion audio...';
                statusEl.className = 'ac-status ac-connecting';
                muteBtn.classList.add('hidden');
                break;
            case 'connected':
                statusEl.textContent = 'Audio connect\u00e9 !';
                statusEl.className = 'ac-status ac-connected';
                muteBtn.classList.remove('hidden');
                this._updateMuteButton();
                setTimeout(() => {
                    if (this.isActive) {
                        statusEl.textContent = '';
                    }
                }, 3000);
                break;
            case 'disconnected':
                statusEl.textContent = 'Audio d\u00e9connect\u00e9';
                statusEl.className = 'ac-status ac-disconnected';
                break;
            case 'error':
                statusEl.textContent = errorMsg || 'Erreur audio';
                statusEl.className = 'ac-status ac-error';
                break;
        }
    },

    _hideUI() {
        const overlay = document.getElementById('audio-chat-overlay');
        if (overlay) {
            overlay.classList.remove('ac-visible');
        }
    },

    _updateMuteButton() {
        const muteBtn = document.getElementById('ac-mute-btn');
        if (!muteBtn) return;
        if (this.isMuted) {
            muteBtn.innerHTML = '&#x1F507;';
            muteBtn.classList.add('ac-btn-off');
            muteBtn.title = 'Activer le micro';
        } else {
            muteBtn.innerHTML = '&#x1F3A4;';
            muteBtn.classList.remove('ac-btn-off');
            muteBtn.title = 'Couper le micro';
        }
    }
};
