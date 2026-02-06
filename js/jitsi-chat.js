/* ============================================
   Audio Chat - WebRTC Audio Only
   Uses existing WebSocket signaling (rtc:offer, rtc:answer, rtc:ice)
   ============================================ */

const AudioChat = {
    pc: null,           // RTCPeerConnection
    localStream: null,  // Local microphone stream
    remoteAudio: null,  // Remote audio element
    isActive: false,
    isMuted: false,
    isConnected: false,
    isHost: false,

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

        console.log('[AudioChat] Starting audio chat, isHost:', isHost);
        this._showUI('connecting');

        try {
            // Get microphone access (audio only - no video!)
            this.localStream = await navigator.mediaDevices.getUserMedia({
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
            return;
        }

        // Create peer connection
        this.pc = new RTCPeerConnection({ iceServers: this.iceServers });

        // Add local audio track to connection
        this.localStream.getTracks().forEach(track => {
            this.pc.addTrack(track, this.localStream);
        });

        // Handle remote audio stream
        this.pc.ontrack = (event) => {
            console.log('[AudioChat] Received remote audio track');
            if (!this.remoteAudio) {
                this.remoteAudio = document.createElement('audio');
                this.remoteAudio.autoplay = true;
                this.remoteAudio.id = 'remote-audio';
                document.body.appendChild(this.remoteAudio);
            }
            this.remoteAudio.srcObject = event.streams[0];
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

        // Connection state monitoring
        this.pc.onconnectionstatechange = () => {
            console.log('[AudioChat] Connection state:', this.pc.connectionState);
            switch (this.pc.connectionState) {
                case 'connected':
                    this.isConnected = true;
                    this._showUI('connected');
                    break;
                case 'disconnected':
                case 'failed':
                    this._showUI('disconnected');
                    this.isConnected = false;
                    break;
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log('[AudioChat] ICE state:', this.pc.iceConnectionState);
        };

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
        if (!this.pc) {
            console.warn('[AudioChat] No peer connection - starting first');
            await this.start(false);
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
        try {
            console.log('[AudioChat] Received answer, setting remote description');
            await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } catch (err) {
            console.error('[AudioChat] Failed to handle answer:', err);
        }
    },

    async handleIce(data) {
        if (!this.pc) return;
        try {
            await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('[AudioChat] Failed to add ICE candidate:', err);
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

        this.isActive = false;
        this.isConnected = false;
        this.isMuted = false;
        this.isHost = false;

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
                // Auto-hide status after 3s, keep mute button
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
    }
};

// Keep backward compatibility alias
const VideoChat = {
    start(roomCode, playerName) {
        // Start is now called from app.js after wiring signaling
        AudioChat.start(Multiplayer.isHost);
    },
    stop() { AudioChat.stop(); },
    hideOverlay() { AudioChat._hideUI(); },
    toggle() { AudioChat.toggleMute(); },
    setupSignaling() {},
    async startLocalMedia() { return true; },
    async createOffer() {}
};
