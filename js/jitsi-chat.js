/* ============================================
   Audio Chat - WebRTC Mesh (up to 6 players)
   Server-coordinated start: all players signal ready after
   mic access, server waits for everyone, then signals go.
   Fetches TURN credentials for mobile NAT traversal.
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
    _connectedCount: 0,
    _totalPeers: 0,

    // Fetched from server (includes TURN)
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ],

    async _fetchIceServers() {
        try {
            const resp = await fetch('/api/turn-credentials');
            const data = await resp.json();
            if (data.iceServers && data.iceServers.length > 0) {
                this.iceServers = data.iceServers;
                console.log('[AudioChat] ICE servers fetched:', this.iceServers.length, 'servers');
            }
        } catch (err) {
            console.warn('[AudioChat] Failed to fetch TURN, using STUN only:', err.message);
        }
    },

    async start(isHost, players, myId) {
        if (this.isActive) return;
        this.isActive = true;
        this._allPlayers = players || Multiplayer.players;
        this._myId = myId || Multiplayer.playerId;
        this._retryCount = 0;
        this._connectedCount = 0;

        const otherPlayers = this._allPlayers.filter(p => p.id !== this._myId);
        this._totalPeers = otherPlayers.length;

        console.log('[AudioChat] Starting, players:', this._allPlayers.length);
        this._showUI('connecting');

        // Register signaling callbacks FIRST (before any async work)
        Multiplayer.onRtcOffer = (msg) => this._handleOffer(msg.from, msg.data);
        Multiplayer.onRtcAnswer = (msg) => this._handleAnswer(msg.from, msg.data);
        Multiplayer.onRtcIce = (msg) => this._handleIce(msg.from, msg.data);

        // Fetch TURN credentials (critical for mobile)
        await this._fetchIceServers();

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
        for (const other of otherPlayers) {
            this._createPeer(other.id);
        }

        // Signal to server that we are ready
        Multiplayer.send({ type: 'rtc:ready' });
        console.log('[AudioChat] Sent rtc:ready, waiting for all players...');

        // Wait for server to confirm all players ready (timeout 10s)
        try {
            await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log('[AudioChat] Timeout waiting for rtc:start, proceeding anyway');
                    resolve();
                }, 10000);

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
                await new Promise(r => setTimeout(r, 300));
            }
        }

        // Retry failed peers after 6s, then 12s, then 18s
        this._retryTimer = setTimeout(() => this._retryFailedPeers(), 6000);
    },

    _createPeer(peerId) {
        if (this.peers.has(peerId)) return this.peers.get(peerId);

        const pc = new RTCPeerConnection({
            iceServers: this.iceServers,
            iceCandidatePoolSize: 2
        });

        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }

        const remoteAudio = document.createElement('audio');
        remoteAudio.autoplay = true;
        remoteAudio.playsInline = true;
        remoteAudio.id = `remote-audio-${peerId}`;
        document.body.appendChild(remoteAudio);

        pc.ontrack = (event) => {
            console.log('[AudioChat] Track from', peerId);
            if (event.track.kind === 'audio') {
                remoteAudio.srcObject = event.streams[0];
                // Force play on mobile (autoplay policy)
                remoteAudio.play().catch(() => {});
            }
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                Multiplayer.sendRtc('rtc:ice', { candidate: event.candidate }, peerId);
            }
        };

        let wasConnected = false;

        pc.oniceconnectionstatechange = () => {
            const ics = pc.iceConnectionState;
            console.log(`[AudioChat] ${peerId} ice: ${ics}`);

            if ((ics === 'connected' || ics === 'completed') && !wasConnected) {
                wasConnected = true;
                this._onPeerConnected(peerId);
            } else if (ics === 'failed') {
                if (wasConnected) {
                    wasConnected = false;
                    this._onPeerDisconnected(peerId);
                }
                this._restartPeer(peerId);
            } else if (ics === 'disconnected') {
                // Wait 5s then check if still disconnected
                setTimeout(() => {
                    const p = this.peers.get(peerId);
                    if (p && p.pc.iceConnectionState === 'disconnected') {
                        if (wasConnected) {
                            wasConnected = false;
                            this._onPeerDisconnected(peerId);
                        }
                        this._restartPeer(peerId);
                    }
                }, 5000);
            }
        };

        const peer = { pc, remoteAudio, pendingIce: [], connected: false };
        this.peers.set(peerId, peer);
        return peer;
    },

    _onPeerConnected(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer || peer.connected) return;
        peer.connected = true;
        this._connectedCount++;
        console.log(`[AudioChat] Peer ${peerId} connected (${this._connectedCount}/${this._totalPeers})`);

        // Show connected as soon as ANY peer connects
        if (this._connectedCount >= 1) {
            this._showUI('connected');
        }

        // Cancel retries if all connected
        if (this._connectedCount >= this._totalPeers && this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
            this._retryCount = 0;
        }
    },

    _onPeerDisconnected(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer || !peer.connected) return;
        peer.connected = false;
        this._connectedCount = Math.max(0, this._connectedCount - 1);
        console.log(`[AudioChat] Peer ${peerId} disconnected (${this._connectedCount}/${this._totalPeers})`);
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

            // If we already have a local offer (glare), the lower ID rolls back
            if (peer.pc.signalingState === 'have-local-offer') {
                if (this._myId < fromId) {
                    console.log('[AudioChat] Glare: rolling back local offer');
                    await peer.pc.setLocalDescription({ type: 'rollback' });
                } else {
                    console.log('[AudioChat] Glare: ignoring remote offer (we have priority)');
                    return;
                }
            }

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

    async _restartPeer(peerId) {
        if (!this.isActive) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;
        // Only higher ID initiates restart to avoid conflicts
        if (this._myId < peerId) return;
        console.log('[AudioChat] ICE restart for', peerId);
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
            if (!peer.connected) {
                hasUnconnected = true;
                console.log('[AudioChat] Retry', peerId, 'ice:', peer.pc.iceConnectionState);
                // Both sides try restart on retries (not just higher ID)
                this._forceRestart(peerId);
            }
        }
        if (hasUnconnected && ++this._retryCount < 5) {
            this._retryTimer = setTimeout(() => this._retryFailedPeers(), 8000);
        }
    },

    async _forceRestart(peerId) {
        if (!this.isActive) return;
        const peer = this.peers.get(peerId);
        if (!peer) return;
        console.log('[AudioChat] Force restart for', peerId);
        try {
            const offer = await peer.pc.createOffer({ iceRestart: true });
            await peer.pc.setLocalDescription(offer);
            Multiplayer.sendRtc('rtc:offer', { sdp: offer }, peerId);
        } catch (err) {
            console.error('[AudioChat] Force restart failed for', peerId, err);
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
        this._connectedCount = 0;
        this._totalPeers = 0;

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
                statusEl.textContent = this._connectedCount >= this._totalPeers
                    ? 'Audio connecté !'
                    : `Audio ${this._connectedCount}/${this._totalPeers}`;
                statusEl.className = 'ac-status ac-connected';
                muteBtn.classList.remove('hidden');
                this._updateMuteButton();
                if (this._connectedCount >= this._totalPeers) {
                    setTimeout(() => { if (this.isActive) statusEl.textContent = ''; }, 3000);
                }
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
