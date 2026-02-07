/* ============================================
   Audio/Video Chat - WebRTC P2P
   Uses existing WebSocket signaling (rtc:offer, rtc:answer, rtc:ice)
   ============================================ */

const AudioChat = {
    pc: null,           // RTCPeerConnection
    localStream: null,  // Local microphone + camera stream
    remoteAudio: null,  // Remote audio element
    isActive: false,
    isMuted: false,
    isConnected: false,
    isHost: false,
    _ready: null,       // Promise that resolves when pc is set up
    _resolveReady: null,
    _pendingIce: [],    // Buffer ICE candidates until pc is ready

    // STUN servers (free, reliable - audio only needs STUN, not TURN)
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ],

    async start(isHost) {
        if (this.isActive) return;
        this.isActive = true;
        this.isHost = isHost;
        this._pendingIce = [];

        // Create a promise that resolves when the peer connection is ready
        this._ready = new Promise(resolve => { this._resolveReady = resolve; });

        console.log('[AudioChat] Starting audio chat, isHost:', isHost);
        this._showUI('connecting');

        try {
            // Get microphone + camera access
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: {
                    facingMode: 'user',
                    width: { ideal: 160 },
                    height: { ideal: 120 }
                }
            });
            console.log('[AudioChat] Microphone + camera access granted');

            // Show local video preview
            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
            }
        } catch (err) {
            // Camera might not be available - try audio-only fallback
            // (but not if user explicitly denied permission)
            if (err.name === 'NotFoundError' || err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        },
                        video: false
                    });
                    console.log('[AudioChat] Camera unavailable, audio-only mode');
                } catch (err2) {
                    console.error('[AudioChat] Microphone access denied:', err2.name);
                    this._showUI('error', err2.name === 'NotAllowedError'
                        ? 'Autorise le micro pour parler !'
                        : 'Micro non disponible');
                    this.isActive = false;
                    return;
                }
            } else {
                console.error('[AudioChat] Media access denied:', err.name);
                this._showUI('error', err.name === 'NotAllowedError'
                    ? 'Autorise le micro et la cam\u00e9ra !'
                    : 'Micro non disponible');
                this.isActive = false;
                return;
            }
        }

        // Create peer connection
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        // Add local audio track to connection
        this.localStream.getTracks().forEach(track => {
            this.pc.addTrack(track, this.localStream);
        });

        // Handle remote audio + video streams
        this.pc.ontrack = (event) => {
            const track = event.track;
            console.log('[AudioChat] Received remote track:', track.kind);

            if (track.kind === 'audio') {
                if (!this.remoteAudio) {
                    this.remoteAudio = document.createElement('audio');
                    this.remoteAudio.autoplay = true;
                    this.remoteAudio.id = 'remote-audio';
                    document.body.appendChild(this.remoteAudio);
                }
                this.remoteAudio.srcObject = event.streams[0];
            } else if (track.kind === 'video') {
                const remoteVideo = document.getElementById('remote-video');
                if (remoteVideo) {
                    remoteVideo.srcObject = event.streams[0];
                    this._showVideoWidget(true);
                }
            }

            this.isConnected = true;
            this._showUI('connected');
        };

        // ICE candidate handling - send through WebSocket signaling
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[AudioChat] Sending ICE candidate');
                Multiplayer.sendRtc('rtc:ice', { candidate: event.candidate });
            }
        };

        // Connection state monitoring with auto-recovery
        this.pc.onconnectionstatechange = () => {
            if (!this.pc) return;
            console.log('[AudioChat] Connection state:', this.pc.connectionState);
            switch (this.pc.connectionState) {
                case 'connected':
                    this.isConnected = true;
                    this._showUI('connected');
                    break;
                case 'disconnected':
                    this.isConnected = false;
                    this._showUI('connecting');
                    // WebRTC often recovers from 'disconnected' on its own
                    // Wait 5s then try ICE restart if still disconnected
                    setTimeout(() => {
                        if (this.pc && this.pc.connectionState === 'disconnected') {
                            console.log('[AudioChat] Still disconnected, attempting ICE restart');
                            this._restartIce();
                        }
                    }, 5000);
                    break;
                case 'failed':
                    this.isConnected = false;
                    this._showUI('connecting');
                    console.log('[AudioChat] Connection failed, attempting ICE restart');
                    this._restartIce();
                    break;
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            if (!this.pc) return;
            console.log('[AudioChat] ICE state:', this.pc.iceConnectionState);
            // Also handle ICE-level failures
            if (this.pc.iceConnectionState === 'failed') {
                console.log('[AudioChat] ICE failed, attempting restart');
                this._restartIce();
            }
        };

        // Peer connection is ready - resolve the promise
        this._resolveReady();
        console.log('[AudioChat] Peer connection ready');

        // Flush any ICE candidates that arrived while we were setting up
        if (this._pendingIce.length > 0) {
            console.log('[AudioChat] Flushing', this._pendingIce.length, 'buffered ICE candidates');
            for (const candidate of this._pendingIce) {
                try {
                    await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (err) {
                    console.error('[AudioChat] Failed to add buffered ICE:', err);
                }
            }
            this._pendingIce = [];
        }

        // If host, create and send offer
        if (isHost) {
            await this.createOffer();
        }
    },

    async createOffer() {
        try {
            const offer = await this.pc.createOffer();
            await this.pc.setLocalDescription(offer);
            console.log('[AudioChat] Sending offer');
            Multiplayer.sendRtc('rtc:offer', { sdp: offer });
        } catch (err) {
            console.error('[AudioChat] Failed to create offer:', err);
        }
    },

    async handleOffer(data) {
        // Wait until peer connection is ready (handles the race condition
        // where PC host sends offer before mobile guest finishes getUserMedia)
        if (this._ready) {
            await this._ready;
        }
        if (!this.pc) {
            console.error('[AudioChat] handleOffer: no peer connection');
            return;
        }
        try {
            console.log('[AudioChat] Received offer, setting remote description');
            await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            const answer = await this.pc.createAnswer();
            await this.pc.setLocalDescription(answer);
            console.log('[AudioChat] Sending answer');
            Multiplayer.sendRtc('rtc:answer', { sdp: answer });
        } catch (err) {
            console.error('[AudioChat] Failed to handle offer:', err);
        }
    },

    async handleAnswer(data) {
        if (this._ready) {
            await this._ready;
        }
        if (!this.pc) return;
        try {
            console.log('[AudioChat] Received answer, setting remote description');
            await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (err) {
            console.error('[AudioChat] Failed to handle answer:', err);
        }
    },

    async handleIce(data) {
        // If peer connection isn't ready yet, buffer the candidate
        if (!this.pc) {
            console.log('[AudioChat] Buffering ICE candidate (pc not ready)');
            this._pendingIce.push(data.candidate);
            return;
        }
        try {
            await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('[AudioChat] Failed to add ICE candidate:', err);
        }
    },

    async _restartIce() {
        if (!this.pc || !this.isActive) return;
        try {
            // Only the host initiates the ICE restart
            if (this.isHost) {
                const offer = await this.pc.createOffer({ iceRestart: true });
                await this.pc.setLocalDescription(offer);
                console.log('[AudioChat] Sending ICE restart offer');
                Multiplayer.sendRtc('rtc:offer', { sdp: offer });
            }
        } catch (err) {
            console.error('[AudioChat] ICE restart failed:', err);
        }
    },

    toggleMute() {
        if (!this.localStream) return;
        this.isMuted = !this.isMuted;
        this.localStream.getAudioTracks().forEach(track => {
            track.enabled = !this.isMuted;
        });
        this._updateMuteButton();
    },

    stop() {
        console.log('[AudioChat] Stopping');

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }

        if (this.remoteAudio) {
            this.remoteAudio.srcObject = null;
            this.remoteAudio.remove();
            this.remoteAudio = null;
        }

        // Clean up video elements
        const localVideo = document.getElementById('local-video');
        if (localVideo) localVideo.srcObject = null;
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) remoteVideo.srcObject = null;
        this._showVideoWidget(false);

        this.isActive = false;
        this.isConnected = false;
        this.isMuted = false;
        this.isHost = false;
        this._ready = null;
        this._resolveReady = null;
        this._pendingIce = [];

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
                    if (this.isConnected) {
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
    },

    _showVideoWidget(show) {
        const widget = document.getElementById('video-chat-widget');
        if (!widget) return;
        if (show) {
            widget.classList.remove('hidden');
        } else {
            widget.classList.add('hidden');
        }
    }
};
