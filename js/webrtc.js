/* ============================================
   WebRTC Video Chat Module
   Peer-to-peer audio/video communication
   ============================================ */

const VideoChat = {
    pc: null,
    localStream: null,
    remoteStream: null,
    isActive: false,
    isMuted: false,
    isCameraOff: false,
    pendingIceCandidates: [],  // Queue for ICE candidates that arrive early
    isNegotiating: false,

    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            // Metered TURN servers (free tier)
            {
                urls: 'turn:a.relay.metered.ca:80',
                username: 'e8dd65c92f2f3c9e5c1f7d8a',
                credential: 'uWdKOlwRZkYTpg7/',
            },
            {
                urls: 'turn:a.relay.metered.ca:80?transport=tcp',
                username: 'e8dd65c92f2f3c9e5c1f7d8a',
                credential: 'uWdKOlwRZkYTpg7/',
            },
            {
                urls: 'turn:a.relay.metered.ca:443',
                username: 'e8dd65c92f2f3c9e5c1f7d8a',
                credential: 'uWdKOlwRZkYTpg7/',
            },
            {
                urls: 'turns:a.relay.metered.ca:443?transport=tcp',
                username: 'e8dd65c92f2f3c9e5c1f7d8a',
                credential: 'uWdKOlwRZkYTpg7/',
            }
        ],
        iceCandidatePoolSize: 10
    },

    async startLocalMedia() {
        // Check if mediaDevices is available (requires HTTPS on mobile)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.error('[VideoChat] mediaDevices not available - HTTPS required on mobile');
            alert('La caméra nécessite une connexion sécurisée (HTTPS)');
            return false;
        }

        // Try video + audio first
        try {
            console.log('[VideoChat] Requesting camera + microphone...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: { facingMode: 'user' }  // Simple constraints for mobile compatibility
            });
            console.log('[VideoChat] Got video + audio stream, tracks:',
                this.localStream.getTracks().map(t => t.kind).join(', '));

            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
                localVideo.setAttribute('playsinline', 'true');  // Required for iOS
                localVideo.setAttribute('autoplay', 'true');
                localVideo.muted = true;
            }

            // Also set lobby preview
            const lobbyVideo = document.getElementById('lobby-local-video');
            if (lobbyVideo) {
                lobbyVideo.srcObject = this.localStream;
                lobbyVideo.setAttribute('playsinline', 'true');
                lobbyVideo.setAttribute('autoplay', 'true');
                lobbyVideo.muted = true;
            }

            return true;
        } catch (err) {
            console.warn('[VideoChat] Camera access failed:', err.name, err.message);

            // Try audio only
            try {
                console.log('[VideoChat] Trying audio only...');
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true },
                    video: false
                });
                console.log('[VideoChat] Got audio-only stream');
                return true;
            } catch (err2) {
                console.error('[VideoChat] Audio access also failed:', err2.name, err2.message);
                alert('Impossible d\'accéder au micro. Vérifie les permissions.');
                return false;
            }
        }
    },

    createPeerConnection() {
        console.log('[VideoChat] Creating peer connection with config:', this.config);
        this.pc = new RTCPeerConnection(this.config);

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                console.log('[VideoChat] Adding local track:', track.kind);
                this.pc.addTrack(track, this.localStream);
            });
        }

        // Handle remote stream
        this.remoteStream = new MediaStream();
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
            remoteVideo.srcObject = this.remoteStream;
        }

        this.pc.ontrack = (event) => {
            console.log('[VideoChat] Received remote track:', event.track.kind);
            event.streams[0].getTracks().forEach(track => {
                this.remoteStream.addTrack(track);
            });
            if (remoteVideo) {
                remoteVideo.srcObject = event.streams[0];
                // Hide avatar when video track arrives
                if (event.track.kind === 'video') {
                    this._onRemoteVideoStarted();
                }
            }
        };

        // ICE candidates
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[VideoChat] ICE candidate:', event.candidate.type, event.candidate.protocol);
                Multiplayer.sendRtc('rtc:ice', event.candidate);
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            console.log('[VideoChat] ICE connection state:', this.pc.iceConnectionState);
            if (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed') {
                this.isActive = true;
                this._showOverlay();
                console.log('[VideoChat] Video chat connected!');
            } else if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
                this.isActive = false;
                console.log('[VideoChat] Video chat disconnected/failed');
            }
        };

        this.pc.onconnectionstatechange = () => {
            console.log('[VideoChat] Connection state:', this.pc.connectionState);
        };

        this.pc.onicegatheringstatechange = () => {
            console.log('[VideoChat] ICE gathering state:', this.pc.iceGatheringState);
        };
    },

    async createOffer() {
        try {
            console.log('[VideoChat] Creating offer...');

            // Make sure local media is started first
            if (!this.localStream) {
                console.log('[VideoChat] Starting local media before offering...');
                await this.startLocalMedia();
            }

            // Close existing connection if any
            if (this.pc) {
                console.log('[VideoChat] Closing existing peer connection');
                this.pc.close();
                this.pc = null;
            }

            this.createPeerConnection();
            console.log('[VideoChat] Creating SDP offer...');
            const offer = await this.pc.createOffer();
            console.log('[VideoChat] Setting local description...');
            await this.pc.setLocalDescription(offer);
            console.log('[VideoChat] Sending offer...');
            Multiplayer.sendRtc('rtc:offer', offer);
            console.log('[VideoChat] Offer sent successfully');
        } catch (e) {
            console.error('[VideoChat] Error creating offer:', e);
        }
    },

    async handleOffer(offer) {
        try {
            console.log('[VideoChat] Received offer, creating answer...');

            // Make sure local media is started first
            if (!this.localStream) {
                console.log('[VideoChat] Starting local media before answering...');
                await this.startLocalMedia();
            }

            // Close existing connection if any
            if (this.pc) {
                console.log('[VideoChat] Closing existing peer connection');
                this.pc.close();
                this.pc = null;
            }

            this.createPeerConnection();
            console.log('[VideoChat] Setting remote description (offer)...');
            await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('[VideoChat] Remote description set');

            // Process any ICE candidates that arrived before we were ready
            await this._processQueuedCandidates();

            console.log('[VideoChat] Creating answer...');
            const answer = await this.pc.createAnswer();
            console.log('[VideoChat] Setting local description (answer)...');
            await this.pc.setLocalDescription(answer);
            console.log('[VideoChat] Answer created and sending...');
            Multiplayer.sendRtc('rtc:answer', answer);
            console.log('[VideoChat] Answer sent successfully');
        } catch (e) {
            console.error('[VideoChat] Error handling offer:', e);
        }
    },

    async handleAnswer(answer) {
        if (this.pc) {
            console.log('[VideoChat] Received answer, setting remote description...');
            await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('[VideoChat] Remote description set, processing queued ICE candidates...');
            // Process any queued ICE candidates
            await this._processQueuedCandidates();
        }
    },

    async handleIceCandidate(candidate) {
        if (!candidate) return;

        // If no peer connection or remote description not set, queue the candidate
        if (!this.pc || !this.pc.remoteDescription || !this.pc.remoteDescription.type) {
            console.log('[VideoChat] Queuing ICE candidate (connection not ready)');
            this.pendingIceCandidates.push(candidate);
            return;
        }

        try {
            console.log('[VideoChat] Adding ICE candidate');
            await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.warn('[VideoChat] Error adding ICE candidate:', e.message);
        }
    },

    async _processQueuedCandidates() {
        if (!this.pc || !this.pc.remoteDescription) return;

        console.log(`[VideoChat] Processing ${this.pendingIceCandidates.length} queued ICE candidates`);
        while (this.pendingIceCandidates.length > 0) {
            const candidate = this.pendingIceCandidates.shift();
            try {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.warn('[VideoChat] Error adding queued ICE candidate:', e.message);
            }
        }
    },

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }
        const muteBtn = document.getElementById('vc-mute-btn');
        if (muteBtn) {
            muteBtn.textContent = this.isMuted ? '🔇' : '🎤';
            muteBtn.classList.toggle('vc-btn-off', this.isMuted);
        }
    },

    toggleCamera() {
        this.isCameraOff = !this.isCameraOff;
        if (this.localStream) {
            this.localStream.getVideoTracks().forEach(track => {
                track.enabled = !this.isCameraOff;
            });
        }
        const camBtn = document.getElementById('vc-camera-btn');
        if (camBtn) {
            camBtn.textContent = this.isCameraOff ? '📷' : '🎥';
            camBtn.classList.toggle('vc-btn-off', this.isCameraOff);
        }
    },

    _showOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) overlay.classList.add('vc-visible');

        // Set avatars as fallback
        this._updateAvatars();
    },

    _updateAvatars() {
        const me = Multiplayer.players.find(p => p.id === Multiplayer.playerId);
        const partner = Multiplayer.getPartner();

        // Local avatar (show if no video track)
        const localAvatar = document.getElementById('local-avatar');
        const localVideo = document.getElementById('local-video');
        if (localAvatar && me) {
            localAvatar.src = `images/${me.avatar}.png`;
            const hasVideoTrack = this.localStream && this.localStream.getVideoTracks().length > 0;
            localAvatar.style.display = hasVideoTrack ? 'none' : 'block';
            if (localVideo) localVideo.style.display = hasVideoTrack ? 'block' : 'none';
        }

        // Remote avatar (show until remote video arrives)
        const remoteAvatar = document.getElementById('remote-avatar');
        const remoteVideo = document.getElementById('remote-video');
        if (remoteAvatar && partner) {
            remoteAvatar.src = `images/${partner.avatar}.png`;
            remoteAvatar.style.display = 'block';  // Show by default
        }
    },

    _onRemoteVideoStarted() {
        const remoteAvatar = document.getElementById('remote-avatar');
        const remoteVideo = document.getElementById('remote-video');
        if (remoteAvatar) remoteAvatar.style.display = 'none';
        if (remoteVideo) remoteVideo.style.display = 'block';
    },

    hideOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) overlay.classList.remove('vc-visible');
    },

    setupSignaling() {
        console.log('[VideoChat] Setting up signaling handlers');
        Multiplayer.onRtcOffer = (msg) => {
            console.log('[VideoChat] Received RTC offer from:', msg.from);
            this.handleOffer(msg.data);
        };
        Multiplayer.onRtcAnswer = (msg) => {
            console.log('[VideoChat] Received RTC answer from:', msg.from);
            this.handleAnswer(msg.data);
        };
        Multiplayer.onRtcIce = (msg) => {
            console.log('[VideoChat] Received ICE candidate from:', msg.from);
            this.handleIceCandidate(msg.data);
        };
    },

    stop() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        if (this.pc) {
            this.pc.close();
            this.pc = null;
        }
        this.isActive = false;
        this.remoteStream = null;
        this.pendingIceCandidates = [];
        this.isNegotiating = false;
        this.hideOverlay();
    }
};
