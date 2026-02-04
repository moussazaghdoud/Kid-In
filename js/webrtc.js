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

    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
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
        this.pc = new RTCPeerConnection(this.config);

        // Add local tracks
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
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
                Multiplayer.sendRtc('rtc:ice', event.candidate);
            }
        };

        this.pc.oniceconnectionstatechange = () => {
            if (this.pc.iceConnectionState === 'connected') {
                this.isActive = true;
                this._showOverlay();
            } else if (this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'failed') {
                this.isActive = false;
            }
        };
    },

    async createOffer() {
        this.createPeerConnection();
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        Multiplayer.sendRtc('rtc:offer', offer);
    },

    async handleOffer(offer) {
        this.createPeerConnection();
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        Multiplayer.sendRtc('rtc:answer', answer);
    },

    async handleAnswer(answer) {
        if (this.pc) {
            await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    },

    async handleIceCandidate(candidate) {
        if (this.pc) {
            try {
                await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                // Ignore ICE errors
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
        Multiplayer.onRtcOffer = (msg) => {
            this.handleOffer(msg.data);
        };
        Multiplayer.onRtcAnswer = (msg) => {
            this.handleAnswer(msg.data);
        };
        Multiplayer.onRtcIce = (msg) => {
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
        this.hideOverlay();
    }
};
