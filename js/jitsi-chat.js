/* ============================================
   Audio Chat - WebRTC Mesh (up to 6 players)
   Server-coordinated start: all players signal ready after
   mic access, server waits for everyone, then signals go.
   ============================================ */

const AudioChat = {
    peers: new Map(),
    localStream: null,
    isActive: false,
    isMuted: false,
    _allPlayers: [],
    _myId: null,
    _retryTimer: null,
    _retryCount: 0,

    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],

    async start(isHost, players, myId) {
        if (this.isActive) return;
        this.isActive = true;
        this._allPlayers = players || Multiplayer.players;
        this._myId = myId || Multiplayer.playerId;
        this._retryCount = 0;

        console.log('[AudioChat] Starting, players:', this._allPlayers.length);
        this._showUI('connecting');

        // Register signaling callbacks
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
                video: false
            });
            console.log('[AudioChat] Microphone granted');
        } catch (err) {
            console.error('[AudioChat] Mic denied:', err.name);
            this._showUI('error', err.name === 'NotAllowedError'
                ? 'Autorise le micro pour parler !'
                : 'Micro non disponible');
            this.isActive = false;
            return;
        }

        // Create peer connections for all other players
        const otherPlayers = this._allPlayers.filter(p => p.id !== this._myId);
        for (const other of otherPlayers) {
            this._createPeer(other.id);
        }

        // Signal to server that we are ready
        Multiplayer.send({ type: 'rtc:ready' });
        console.log('[AudioChat] Sent rtc:ready, waiting for all players...');

        // Wait for server to confirm all players ready
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.log('[AudioChat] Timeout waiting for rtc:start, proceeding anyway');
                    resolve();
                }, 8000);

                Multiplayer.onRtcStart = () => {
                    clearTimeout(timeout);
                    Multiplayer.onRtcStart = null;
                    resolve();
                };
            });
        } catch (e) { /* proceed anyway */ }

        if (!this.isActive) return; // stopped while waiting

        console.log('[AudioChat] All ready, starting offers');

        // Higher ID creates offers (staggered for reliability)
        for (const other of otherPlayers) {
            if (this._myId > other.id) {
                await this._createOffer(other.id);
                // Small delay between offers to avoid overwhelming the browser
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // Retry failed peers after 8s
        this._retryTimer = setTimeout(() => this._retryFailedPeers(), 8000);
    },

    _createPeer(peerId) {
        if (this.peers.has(peerId)) return this.peers.get(peerId);

        const pc = new RTCPeerConnection({ iceServers: this.iceServers });

        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        const remoteAudio = document.createElement('audio');
        remoteAudio.autoplay = true;
        remoteAudio.id = `remote-audio-${peerId}`;
        document.body.appendChild(remoteAudio);

        pc.ontrack = (event) => {
            console.log('[AudioChat] Track from', peerId);
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
            console.log(`[AudioChat] ${peerId} conn:`, pc.connectionState);
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

        pc.oniceconnectionstatechange = () => {
            console.log(`[AudioChat] ${peerId} ice:`, pc.iceConnectionState);
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

    async _createOffer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        try {
            const offer = await peer.pc.createOffer();
            await peer.pc.setLocalDescription(offer);
            console.log('[AudioChat] Offer to', peerId);
            Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
        } catch (err) {
            console.error('[AudioChat] Offer failed for', peerId, err);
        }
    },

    async _handleOffer(fromId, data) {
        if (!this.isActive || !this.localStream) return;

        let peer = this.peers.get(fromId);
        if (!peer) {
            peer = this._createPeer(fromId);
        }

        try {
            console.log('[AudioChat] Offer from', fromId);
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            for (const candidate of peer.pendingIce) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            peer.pendingIce = [];

            const answer = await peer.pc.createAnswer();
            await peer.pc.setLocalDescription(answer);
            console.log('[AudioChat] Answer to', fromId);
            Multiplayer.sendRtc('rtc:answer', { sdp: answer }, fromId);
        } catch (err) {
            console.error('[AudioChat] Handle offer failed from', fromId, err);
        }
    },

    async _handleAnswer(fromId, data) {
        if (!this.isActive) return;
        const peer = this.peers.get(fromId);
        if (!peer) return;
        try {
            console.log('[AudioChat] Answer from', fromId);
            await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

            for (const candidate of peer.pendingIce) {
                await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
            peer.pendingIce = [];
        } catch (err) {
            console.error('[AudioChat] Handle answer failed from', fromId, err);
        }
    },

    async _handleIce(fromId, data) {
        const peer = this.peers.get(fromId);
        if (!peer) return;
        if (!peer.pc.remoteDescription) {
            peer.pendingIce.push(data.candidate);
            return;
        }
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
            console.error('[AudioChat] ICE failed from', fromId, err);
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
        if (this._myId < peerId) return; // only higher ID restarts
        console.log('[AudioChat] Restarting', peerId);
        try {
            const offer = await peer.pc.createOffer({ iceRestart: true });
            await peer.pc.setLocalDescription(offer);
            Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
        } catch (err) {
            console.error('[AudioChat] Restart failed for', peerId, err);
        }
    },

    _retryFailedPeers() {
        if (!this.isActive) return;
        let hasUnconnected = false;
        for (const [peerId, peer] of this.peers) {
            if (!this._isPeerConnected(peer)) {
                hasUnconnected = true;
                console.log('[AudioChat] Retry', peerId);
                this._restartPeer(peerId);
            }
        }
        if (hasUnconnected && ++this._retryCount < 3) {
            this._retryTimer = setTimeout(() => this._retryFailedPeers(), 10000);
        } else if (this._retryCount >= 3) {
            // Show connected if at least one peer works
            for (const [, peer] of this.peers) {
                if (this._isPeerConnected(peer)) {
                    this._showUI('connected');
                    return;
                }
            }
        }
    },

    _checkAllConnected() {
        for (const [, peer] of this.peers) {
            if (!this._isPeerConnected(peer)) return;
        }
        if (this.peers.size > 0) {
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

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        for (const [, peer] of this.peers) {
            if (peer.pc) peer.pc.close();
            if (peer.remoteAudio) {
                peer.remoteAudio.srcObject = null;
                peer.remoteAudio.remove();
            }
        }
        this.peers.clear();

        this.isActive = false;
        this.isMuted = false;
        this._allPlayers = [];
        this._myId = null;

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
                setTimeout(() => { if (this.isActive) statusEl.textContent = ''; }, 3000);
                break;
            case 'error':
                statusEl.textContent = errorMsg || 'Erreur audio';
                statusEl.className = 'ac-status ac-error';
                break;
        }
    },

    _hideUI() {
        const overlay = document.getElementById('audio-chat-overlay');
        if (overlay) overlay.classList.remove('ac-visible');
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
