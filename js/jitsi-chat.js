/* ============================================
   Jitsi Video Chat Module
   Shows a button to join video call via Jitsi Meet
   ============================================ */

const VideoChat = {
    roomName: null,
    jitsiUrl: null,
    isActive: false,
    popupWindow: null,

    start(roomCode, playerName) {
        this.roomName = `KidIn-${roomCode}`;

        // Build Jitsi URL with config
        const config = [
            'config.prejoinPageEnabled=false',
            'config.startWithAudioMuted=false',
            'config.startWithVideoMuted=false',
            'config.disableDeepLinking=true',
            `userInfo.displayName=${encodeURIComponent(playerName || 'Joueur')}`,
            'interfaceConfig.TOOLBAR_BUTTONS=["microphone","camera","hangup"]',
            'interfaceConfig.DISABLE_JOIN_LEAVE_NOTIFICATIONS=true',
            'interfaceConfig.MOBILE_APP_PROMO=false',
            'interfaceConfig.SHOW_JITSI_WATERMARK=false'
        ].join('&');

        this.jitsiUrl = `https://meet.jit.si/${this.roomName}#${config}`;

        console.log('[VideoChat] Jitsi room ready:', this.roomName);
        console.log('[VideoChat] URL:', this.jitsiUrl);

        this._showOverlay();
        this.isActive = true;
    },

    _showOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        const container = document.getElementById('jitsi-container');

        if (overlay && container) {
            container.innerHTML = `
                <div class="vc-button-container">
                    <button class="vc-join-btn" onclick="VideoChat.openJitsi()">
                        📹 Appel Vidéo
                    </button>
                    <p class="vc-hint">Cliquez pour voir et parler</p>
                </div>
            `;
            overlay.classList.add('vc-visible');
        }
    },

    openJitsi() {
        if (!this.jitsiUrl) {
            console.error('[VideoChat] No Jitsi URL');
            return;
        }

        // Open in popup window (better for gameplay)
        const width = 400;
        const height = 500;
        const left = window.screen.width - width - 20;
        const top = 100;

        this.popupWindow = window.open(
            this.jitsiUrl,
            'JitsiCall',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes`
        );

        // If popup blocked, open in new tab
        if (!this.popupWindow) {
            window.open(this.jitsiUrl, '_blank');
        }

        // Update button to show call is active
        const container = document.getElementById('jitsi-container');
        if (container) {
            container.innerHTML = `
                <div class="vc-button-container">
                    <button class="vc-join-btn vc-active" onclick="VideoChat.openJitsi()">
                        📹 En appel
                    </button>
                    <p class="vc-hint">Fenêtre ouverte</p>
                </div>
            `;
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
            overlay.classList.toggle('vc-minimized');
        }
    },

    stop() {
        if (this.popupWindow && !this.popupWindow.closed) {
            this.popupWindow.close();
        }
        this.popupWindow = null;
        this.isActive = false;
        this.roomName = null;
        this.jitsiUrl = null;
        this.hideOverlay();
    },

    // Compatibility methods (called by app.js)
    setupSignaling() {
        console.log('[VideoChat] Jitsi mode - signaling handled by Jitsi');
    },

    async startLocalMedia() {
        console.log('[VideoChat] Jitsi mode - media handled by Jitsi');
        return true;
    },

    async createOffer() {
        console.log('[VideoChat] Jitsi mode - no offer needed');
    }
};
