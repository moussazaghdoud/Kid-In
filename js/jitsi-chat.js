/* ============================================
   Jitsi Video Chat Module
   Simple, reliable video/audio using Jitsi Meet
   ============================================ */

const VideoChat = {
    api: null,
    roomName: null,
    isActive: false,
    isCollapsed: false,

    start(roomCode, playerName) {
        if (this.api) {
            this.stop();
        }

        this.roomName = `KidIn-${roomCode}`;
        console.log('[VideoChat] Starting Jitsi room:', this.roomName);

        const container = document.getElementById('jitsi-container');
        if (!container) {
            console.error('[VideoChat] Container not found');
            return;
        }

        // Load Jitsi API if not loaded
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            console.log('[VideoChat] Loading Jitsi API...');
            const script = document.createElement('script');
            script.src = 'https://meet.jit.si/external_api.js';
            script.onload = () => {
                console.log('[VideoChat] Jitsi API loaded');
                this._initJitsi(container, playerName);
            };
            script.onerror = () => {
                console.error('[VideoChat] Failed to load Jitsi API');
            };
            document.head.appendChild(script);
        } else {
            this._initJitsi(container, playerName);
        }
    },

    _initJitsi(container, playerName) {
        const options = {
            roomName: this.roomName,
            parentNode: container,
            width: '100%',
            height: '100%',
            userInfo: {
                displayName: playerName || 'Joueur'
            },
            configOverwrite: {
                prejoinPageEnabled: false,
                startWithAudioMuted: false,
                startWithVideoMuted: false,
                disableDeepLinking: true,
                enableWelcomePage: false,
                enableClosePage: false,
                disableInviteFunctions: true,
                hideConferenceSubject: true,
                hideConferenceTimer: true,
                toolbarButtons: ['microphone', 'camera'],
                notifications: [],
                disableThirdPartyRequests: true,
                enableNoisyMicDetection: false,
                enableNoAudioDetection: false
            },
            interfaceConfigOverwrite: {
                TOOLBAR_ALWAYS_VISIBLE: false,
                TOOLBAR_TIMEOUT: 2000,
                FILM_STRIP_MAX_HEIGHT: 80,
                DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
                HIDE_INVITE_MORE_HEADER: true,
                MOBILE_APP_PROMO: false,
                SHOW_JITSI_WATERMARK: false,
                SHOW_WATERMARK_FOR_GUESTS: false,
                SHOW_BRAND_WATERMARK: false,
                SHOW_CHROME_EXTENSION_BANNER: false,
                DEFAULT_BACKGROUND: '#1a1a2e',
                DISABLE_PRESENCE_STATUS: true,
                DISABLE_TRANSCRIPTION_SUBTITLES: true,
                DISABLE_RINGING: true,
                FILM_STRIP_MAX_HEIGHT: 100,
                VERTICAL_FILMSTRIP: false,
                TILE_VIEW_MAX_COLUMNS: 2
            }
        };

        try {
            this.api = new JitsiMeetExternalAPI('meet.jit.si', options);

            this.api.addListener('videoConferenceJoined', () => {
                console.log('[VideoChat] Joined Jitsi room');
                this.isActive = true;
                this._showOverlay();
            });

            this.api.addListener('videoConferenceLeft', () => {
                console.log('[VideoChat] Left Jitsi room');
                this.isActive = false;
            });

            this.api.addListener('participantJoined', (participant) => {
                console.log('[VideoChat] Participant joined:', participant.displayName);
            });

            this.api.addListener('participantLeft', (participant) => {
                console.log('[VideoChat] Participant left:', participant.id);
            });

            this.api.addListener('readyToClose', () => {
                console.log('[VideoChat] Ready to close');
                this.stop();
            });

        } catch (e) {
            console.error('[VideoChat] Error initializing Jitsi:', e);
        }
    },

    _showOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.add('vc-visible');
        }
    },

    hideOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.remove('vc-visible');
        }
    },

    toggle() {
        this.isCollapsed = !this.isCollapsed;
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.toggle('vc-collapsed', this.isCollapsed);
        }
        const btn = document.getElementById('vc-collapse-btn');
        if (btn) {
            btn.textContent = this.isCollapsed ? '🗗' : '🗕';
        }
    },

    stop() {
        if (this.api) {
            this.api.dispose();
            this.api = null;
        }
        this.isActive = false;
        this.roomName = null;
        this.hideOverlay();
    },

    // Compatibility methods (called by app.js)
    setupSignaling() {
        // Not needed for Jitsi
        console.log('[VideoChat] Jitsi mode - signaling handled by Jitsi');
    },

    async startLocalMedia() {
        // Not needed for Jitsi - it handles media itself
        console.log('[VideoChat] Jitsi mode - media handled by Jitsi');
        return true;
    },

    async createOffer() {
        // Not needed for Jitsi
        console.log('[VideoChat] Jitsi mode - no offer needed');
    }
};
