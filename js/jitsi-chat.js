/* ============================================
   Jitsi Video Chat Module - Embedded iframe
   ============================================ */

const VideoChat = {
    roomName: null,
    isActive: false,

    start(roomCode, playerName) {
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

        // Build Jitsi URL with all config in hash
        const configParams = [
            'config.prejoinPageEnabled=false',
            'config.startWithAudioMuted=false',
            'config.startWithVideoMuted=false',
            'config.enableWelcomePage=false',
            'config.disableDeepLinking=true',
            'config.hideConferenceSubject=true',
            'config.hideConferenceTimer=true',
            'config.toolbarButtons=["microphone","camera"]',
            'interfaceConfig.TOOLBAR_ALWAYS_VISIBLE=false',
            'interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true',
            'interfaceConfig.MOBILE_APP_PROMO=false',
            'interfaceConfig.SHOW_JITSI_WATERMARK=false',
            'interfaceConfig.SHOW_WATERMARK_FOR_GUESTS=false',
            'interfaceConfig.SHOW_BRAND_WATERMARK=false',
            'interfaceConfig.FILM_STRIP_MAX_HEIGHT=120',
            'interfaceConfig.VERTICAL_FILMSTRIP=false'
        ].join('&');

        const displayName = encodeURIComponent(playerName || 'Joueur');
        const jitsiUrl = `https://meet.jit.si/${this.roomName}#userInfo.displayName="${displayName}"&${configParams}`;

        // Create iframe directly
        container.innerHTML = `<iframe
            src="${jitsiUrl}"
            allow="camera; microphone; display-capture; autoplay; clipboard-write"
            allowfullscreen="true"
            style="width:100%; height:100%; border:none;">
        </iframe>`;

        this.isActive = true;
        console.log('[VideoChat] Jitsi iframe created');
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
