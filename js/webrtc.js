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
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            // Free TURN servers from OpenRelay (metered.ca)
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ],
        iceCandidatePoolSize: 10
    },

    async startLocalMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
                video: { width: 160, height: 120, frameRate: 15 }
            });

            const localVideo = document.getElementById('local-video');
            if (localVideo) {
                localVideo.srcObject = this.localStream;
            }

            return true;
        } catch (err) {
            console.warn('Camera/mic access denied:', err.message);
            // Try audio only
            try {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true },
                    video: false
                });
                return true;
            } catch (err2) {
                console.warn('Audio access also denied:', err2.message);
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
        console.log('[VideoChat] Creating offer...');

        // Make sure local media is started first
        if (!this.localStream) {
            console.log('[VideoChat] Starting local media before offering...');
            await this.startLocalMedia();
        }

        this.createPeerConnection();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        console.log('[VideoChat] Offer created and sent');
        Multiplayer.sendRtc('rtc:offer', offer);
    },

    async handleOffer(offer) {
        console.log('[VideoChat] Received offer, creating answer...');

        // Make sure local media is started first
        if (!this.localStream) {
            console.log('[VideoChat] Starting local media before answering...');
            await this.startLocalMedia();
        }

        this.createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Process any ICE candidates that arrived before we were ready
        await this._processQueuedCandidates();

        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        console.log('[VideoChat] Answer created and sent');
        Multiplayer.sendRtc('rtc:answer', answer);
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
