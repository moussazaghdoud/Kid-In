/* ============================================
   Audio Chat - WebRTC Mesh (up to 6 players)
   Uses existing WebSocket signaling (rtc:offer, rtc:answer, rtc:ice)
   One peer connection per other player in the room.
   ============================================ */

const AudioChat = {
    peers: new Map(),       // peerId -> { pc, remoteAudio, pendingIce }
    localStream: null,
    isActive: false,
    isMuted: false,
    _allPlayers: [],
    _myId: null,
    _pendingOffers: [],     // offers received before localStream ready
    _pendingAnswers: [],    // answers received before localStream ready
    _earlyIce: new Map(),   // peerId -> [candidates] for peers not yet created

    // STUN servers
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],

    async start(isHost, players, myId) {
        if (this.isActive) return;
        this.isActive = true;
        this._allPlayers = players || Multiplayer.players;
        this._myId = myId || Multiplayer.playerId;
        this._pendingOffers = [];
        this._pendingAnswers = [];
        this._earlyIce = new Map();

        console.log('[AudioChat] Starting mesh audio, players:', this._allPlayers.length);
        this._showUI('connecting');

        // Register signaling callbacks BEFORE getUserMedia to avoid race conditions.
        // Offers/answers that arrive while we wait for mic access are buffered.
        Multiplayer.onRtcOffer = (msg) => this._handleOffer(msg.from, msg.data);
        Multiplayer.onRtcAnswer = (msg) => this._handleAnswer(msg.from, msg.data);
        Multiplayer.onRtcIce = (msg) => this._handleIce(msg.from, msg.data);

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false  // Audio only for mesh
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

        // Create peer connections to all other players
        const otherPlayers = this._allPlayers.filter(p => p.id !== this._myId);

        for (const other of otherPlayers) {
            this._createPeer(other.id);
        }

        // Flush any early ICE candidates for now-created peers
        for (const [peerId, candidates] of this._earlyIce) {
            const peer = this.peers.get(peerId);
            if (peer) {
                for (const c of candidates) {
                    peer.pendingIce.push(c);
                }
            }
        }
        this._earlyIce.clear();

        // Flush offers that arrived while waiting for mic
        for (const { fromId, data } of this._pendingOffers) {
            console.log('[AudioChat] Processing buffered offer from', fromId);
            await this._handleOffer(fromId, data);
        }
        this._pendingOffers = [];

        // Flush answers that arrived while waiting for mic
        for (const { fromId, data } of this._pendingAnswers) {
            console.log('[AudioChat] Processing buffered answer from', fromId);
            await this._handleAnswer(fromId, data);
        }
        this._pendingAnswers = [];

        // Higher ID initiates the offer (to avoid both sides offering at once)
        for (const other of otherPlayers) {
            if (this._myId > other.id) {
                await this._createOffer(other.id);
            }
        }
    },

    _createPeer(peerId) {
        if (this.peers.has(peerId)) return this.peers.get(peerId);

        const pc = new RTCPeerConnection({ iceServers: this.iceServers });

        // Add local audio tracks
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        // Create audio element for this peer's remote stream
        const remoteAudio = document.createElement('audio');
        remoteAudio.autoplay = true;
        remoteAudio.id = `remote-audio-${peerId}`;
        document.body.appendChild(remoteAudio);

        pc.ontrack = (event) => {
            console.log('[AudioChat] Received remote track from', peerId, event.track.kind);
            if (event.track.kind === 'audio') {
                remoteAudio.srcObject = event.streams[0];
            }
            this._checkAllConnected();
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                Multiplayer.sendRtc('rtc:ice', { candidate: event.candidate }, peerId);
            }
        };

        pc.onconnectionstatechange = () => {
            if (!pc) return;
            console.log(`[AudioChat] Peer ${peerId} state:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                this._checkAllConnected();
            } else if (pc.connectionState === 'failed') {
                this._restartPeer(peerId);
            } else if (pc.connectionState === 'disconnected') {
                setTimeout(() => {
                    const peer = this.peers.get(peerId);
                    if (peer && peer.pc.connectionState === 'disconnected') {
                        this._restartPeer(peerId);
                    }
                }, 5000);
            }
        };

        const peer = { pc, remoteAudio, pendingIce: [] };
        this.peers.set(peerId, peer);
        return peer;
    },

    async _createOffer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            console.log('[AudioChat] Sending offer to', peerId);
            Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
        } catch (err) {
            console.error('[AudioChat] Failed to create offer for', peerId, err);
        }
    },

    async _handleOffer(fromId, data) {
        if (!this.isActive) return;

        // Buffer if local stream not ready yet (still waiting for getUserMedia)
        if (!this.localStream) {
            console.log('[AudioChat] Buffering offer from', fromId, '(mic not ready)');
            this._pendingOffers.push({ fromId, data });
            return;
        }

        let peer = this.peers.get(fromId);
        if (!peer) {
            this._createPeer(fromId);
            peer = this.peers.get(fromId);
        }

        try {
            console.log('[AudioChat] Received offer from', fromId);
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            // Flush pending ICE
            for (const candidate of peer.pendingIce) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            peer.pendingIce = [];

            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            console.log('[AudioChat] Sending answer to', fromId);
            Multiplayer.sendRtc('rtc:answer', { sdp: answer }, fromId);
        } catch (err) {
            console.error('[AudioChat] Failed to handle offer from', fromId, err);
        }
    },

    async _handleAnswer(fromId, data) {
        // Buffer if local stream not ready yet
        if (!this.localStream) {
            console.log('[AudioChat] Buffering answer from', fromId, '(mic not ready)');
            this._pendingAnswers.push({ fromId, data });
            return;
        }

        const peer = this.peers.get(fromId);
        if (!peer) return;
        try {
            console.log('[AudioChat] Received answer from', fromId);
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            // Flush pending ICE
            for (const candidate of peer.pendingIce) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            peer.pendingIce = [];
        } catch (err) {
            console.error('[AudioChat] Failed to handle answer from', fromId, err);
        }
    },

    async _handleIce(fromId, data) {
        const peer = this.peers.get(fromId);
        if (!peer) {
            // Peer not created yet - buffer in early ICE map
            if (!this._earlyIce.has(fromId)) {
                this._earlyIce.set(fromId, []);
            }
            this._earlyIce.get(fromId).push(data.candidate);
            console.log('[AudioChat] Buffering early ICE from', fromId);
            return;
        }
        if (!peer.pc.remoteDescription) {
            peer.pendingIce.push(data.candidate);
            return;
        }
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('[AudioChat] Failed to add ICE from', fromId, err);
        }
    },

    async _restartPeer(peerId) {
        if (!this.isActive) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;
        try {
            if (this._myId > peerId) {
                const offer = await peer.pc.createOffer({ iceRestart: true });
                await peer.pc.setLocalDescription(offer);
                Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
            }
        } catch (err) {
            console.error('[AudioChat] ICE restart failed for', peerId, err);
        }
    },

    _checkAllConnected() {
        let allConnected = true;
        for (const [, peer] of this.peers) {
            if (peer.pc.connectionState !== 'connected') {
                allConnected = false;
                break;
            }
        }
        if (allConnected && this.peers.size > 0) {
            this._showUI('connected');
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

        for (const [peerId, peer] of this.peers) {
            if (peer.pc) peer.pc.close();
            if (peer.remoteAudio) {
                peer.remoteAudio.srcObject = null;
                peer.remoteAudio.remove();
            }
        }
        this.peers.clear();

        // Clean up video elements (legacy)
        const localVideo = document.getElementById('local-video');
        if (localVideo) localVideo.srcObject = null;
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) remoteVideo.srcObject = null;
        const widget = document.getElementById('video-chat-widget');
        if (widget) widget.classList.add('hidden');

        this.isActive = false;
        this.isMuted = false;
        this._allPlayers = [];
        this._myId = null;
        this._pendingOffers = [];
        this._pendingAnswers = [];
        this._earlyIce = new Map();

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
