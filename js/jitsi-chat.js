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
    _retryTimer: null,
    _retryCount: 0,
    _iceServers: null,      // resolved ICE servers (fetched once per session)

    // Fetch ICE servers (STUN + TURN) from the server, fallback to STUN-only
    async _fetchIceServers() {
        const fallback = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ];
        try {
            const resp = await fetch('/api/turn-credentials');
            if (resp.ok) {
                const data = await resp.json();
                if (data.iceServers && data.iceServers.length > 0) {
                    console.log('[AudioChat] Got ICE servers from API');
                    return data.iceServers;
                }
            }
        } catch (e) {
            console.log('[AudioChat] No TURN config, using STUN only');
        }
        return fallback;
    },

    async start(isHost, players, myId) {
        if (this.isActive) return;
        this.isActive = true;
        this._allPlayers = players || Multiplayer.players;
        this._myId = myId || Multiplayer.playerId;
        this._pendingOffers = [];
        this._pendingAnswers = [];
        this._earlyIce = new Map();
        this._retryCount = 0;

        console.log('[AudioChat] Starting mesh audio, players:', this._allPlayers.length);
        this._showUI('connecting');

        // Register signaling callbacks BEFORE getUserMedia to avoid race conditions.
        Multiplayer.onRtcOffer = (msg) => this._handleOffer(msg.from, msg.data);
        Multiplayer.onRtcAnswer = (msg) => this._handleAnswer(msg.from, msg.data);
        Multiplayer.onRtcIce = (msg) => this._handleIce(msg.from, msg.data);

        // Fetch ICE servers (TURN + STUN) once before anything else
        this._iceServers = await this._fetchIceServers();

        try {
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
            this.isActive = false;
            return;
        }

        // Create peer connections to all other players (SYNCHRONOUS - no await)
        const otherPlayers = this._allPlayers.filter(p => p.id !== this._myId);
        for (const other of otherPlayers) {
            this._createPeer(other.id);
        }

        // Flush any early ICE candidates for now-created peers
        this._flushEarlyIce();

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

        // Auto-retry: if not all connected after 8s, retry failed peers
        this._retryTimer = setTimeout(() => this._retryFailedPeers(), 8000);
    },

    // SYNCHRONOUS - uses pre-fetched _iceServers
    _createPeer(peerId) {
        if (this.peers.has(peerId)) return this.peers.get(peerId);

        const pc = new RTCPeerConnection({ iceServers: this._iceServers });

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
            console.log(`[AudioChat] Peer ${peerId} connectionState:`, pc.connectionState);
            if (pc.connectionState === 'connected') {
                this._checkAllConnected();
            } else if (pc.connectionState === 'failed') {
                this._restartPeer(peerId);
            } else if (pc.connectionState === 'disconnected') {
                setTimeout(() => {
                    const p = this.peers.get(peerId);
                    if (p && p.pc.connectionState === 'disconnected') {
                        this._restartPeer(peerId);
                    }
                }, 5000);
            }
        };

        // Some mobile browsers report iceConnectionState more reliably
        pc.oniceconnectionstatechange = () => {
            console.log(`[AudioChat] Peer ${peerId} iceState:`, pc.iceConnectionState);
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
                this._checkAllConnected();
            } else if (pc.iceConnectionState === 'failed') {
                this._restartPeer(peerId);
            }
        };

        const peer = { pc, remoteAudio, pendingIce: [] };
        this.peers.set(peerId, peer);
        return peer;
    },

    _flushEarlyIce() {
        for (const [peerId, candidates] of this._earlyIce) {
            const peer = this.peers.get(peerId);
            if (peer) {
                for (const c of candidates) {
                    peer.pendingIce.push(c);
                }
            }
        }
        this._earlyIce.clear();
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
            peer = this._createPeer(fromId);  // synchronous
            this._flushEarlyIce();             // flush any ICE that arrived for this peer
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

    _isPeerConnected(peer) {
        const cs = peer.pc.connectionState;
        const ics = peer.pc.iceConnectionState;
        return cs === 'connected' || ics === 'connected' || ics === 'completed';
    },

    async _restartPeer(peerId) {
        if (!this.isActive) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;
        // Only higher ID initiates restart to avoid glare
        if (this._myId < peerId) return;
        console.log('[AudioChat] Restarting peer', peerId);
        try {
            const offer = await peer.pc.createOffer({ iceRestart: true });
            await peer.pc.setLocalDescription(offer);
            Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
        } catch (err) {
            console.error('[AudioChat] ICE restart failed for', peerId, err);
        }
    },

    _retryFailedPeers() {
        if (!this.isActive) return;
        let hasUnconnected = false;
        for (const [peerId, peer] of this.peers) {
            if (!this._isPeerConnected(peer)) {
                hasUnconnected = true;
                console.log('[AudioChat] Retrying peer', peerId,
                    'conn:', peer.pc.connectionState, 'ice:', peer.pc.iceConnectionState);
                this._restartPeer(peerId);
            }
        }
        if (hasUnconnected) {
            this._retryCount++;
            if (this._retryCount < 3) {
                this._retryTimer = setTimeout(() => this._retryFailedPeers(), 10000);
            } else {
                // After max retries, show connected if at least one peer works
                for (const [, peer] of this.peers) {
                    if (this._isPeerConnected(peer)) {
                        this._showUI('connected');
                        return;
                    }
                }
            }
        }
    },

    _checkAllConnected() {
        let allConnected = true;
        for (const [, peer] of this.peers) {
            if (!this._isPeerConnected(peer)) {
                allConnected = false;
                break;
            }
        }
        if (allConnected && this.peers.size > 0) {
            if (this._retryTimer) {
                clearTimeout(this._retryTimer);
                this._retryTimer = null;
            }
            this._retryCount = 0;
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

        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        this._retryCount = 0;

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
