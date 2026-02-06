/* ============================================
   Jitsi Video Chat Module - Using External API
   ============================================ */

const VideoChat = {
    api: null,
    roomName: null,
    isActive: false,

    start(roomCode, playerName) {
        if (this.api) {
            this.stop();
        }

        this.roomName = `KidInGame${roomCode}`;
        console.log('[VideoChat] Starting Jitsi room:', this.roomName);

        const overlay = document.getElementById('video-chat-overlay');
        const container = document.getElementById('jitsi-container');

        if (!overlay || !container) {
            console.error('[VideoChat] Container not found');
            return;
        }

        // Show overlay immediately
        overlay.classList.add('vc-visible');
        container.innerHTML = '<div style="color:white;text-align:center;padding:20px;">Chargement vidéo...</div>';

        // Load Jitsi External API
        if (typeof JitsiMeetExternalAPI === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://meet.jit.si/external_api.js';
            script.onload = () => {
                console.log('[VideoChat] Jitsi API loaded');
                this._createMeeting(container, playerName);
            };
            script.onerror = (e) => {
                console.error('[VideoChat] Failed to load Jitsi API', e);
                container.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:20px;">Erreur chargement vidéo</div>';
            };
            document.head.appendChild(script);
        } else {
            this._createMeeting(container, playerName);
        }
    },

    _createMeeting(container, playerName) {
        container.innerHTML = '';

        try {
            this.api = new JitsiMeetExternalAPI('meet.jit.si', {
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
                    hideConferenceSubject: true,
                    hideConferenceTimer: true,
                    disableInviteFunctions: true,
                    toolbarButtons: ['microphone', 'camera', 'tileview'],
                    disableThirdPartyRequests: true,
                    enableNoisyMicDetection: false,
                    enableNoAudioDetection: false,
                    startAudioOnly: false,
                    filmStrip: {
                        disableStageFilmstrip: true
                    }
                },
                interfaceConfigOverwrite: {
                    TOOLBAR_ALWAYS_VISIBLE: true,
                    TOOLBAR_TIMEOUT: 10000,
                    DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
                    HIDE_INVITE_MORE_HEADER: true,
                    MOBILE_APP_PROMO: false,
                    SHOW_JITSI_WATERMARK: false,
                    SHOW_WATERMARK_FOR_GUESTS: false,
                    SHOW_BRAND_WATERMARK: false,
                    SHOW_CHROME_EXTENSION_BANNER: false,
                    DEFAULT_BACKGROUND: '#1a1a2e',
                    DISABLE_PRESENCE_STATUS: true,
                    FILM_STRIP_MAX_HEIGHT: 100,
                    TILE_VIEW_MAX_COLUMNS: 2,
                    VIDEO_QUALITY_LABEL_DISABLED: true
                }
            });

            this.api.addListener('videoConferenceJoined', () => {
                console.log('[VideoChat] Joined conference');
                this.isActive = true;
            });

            this.api.addListener('readyToClose', () => {
                console.log('[VideoChat] Ready to close');
            });

            console.log('[VideoChat] Jitsi meeting created');
        } catch (e) {
            console.error('[VideoChat] Error creating Jitsi meeting:', e);
            container.innerHTML = '<div style="color:#ff6b6b;text-align:center;padding:20px;">Erreur vidéo: ' + e.message + '</div>';
        }
    },

    hideOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.remove('vc-visible');
        }
    },

    toggle() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.toggle('vc-collapsed');
        }
    },

    stop() {
        if (this.api) {
            this.api.dispose();
            this.api = null;
        }
        const container = document.getElementById('jitsi-container');
        if (container) {
            container.innerHTML = '';
        }
        this.isActive = false;
        this.roomName = null;
        this.hideOverlay();
    },

    // Compatibility methods
    setupSignaling() {},
    async startLocalMedia() { return true; },
    async createOffer() {}
};
