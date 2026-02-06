/* ============================================
   Video Chat - Simple Jitsi Link
   ============================================ */

const VideoChat = {
    roomName: null,
    jitsiUrl: null,
    isActive: false,

    start(roomCode, playerName) {
        this.roomName = `KidInGame${roomCode}`;

        // Simple Jitsi URL
        const name = encodeURIComponent(playerName || 'Joueur');
        this.jitsiUrl = `https://meet.jit.si/${this.roomName}#userInfo.displayName="${name}"&config.prejoinPageEnabled=false`;

        console.log('[VideoChat] Room ready:', this.roomName);

        const overlay = document.getElementById('video-chat-overlay');
        const container = document.getElementById('jitsi-container');

        if (overlay && container) {
            overlay.classList.add('vc-visible');
            container.innerHTML = `
                <a href="${this.jitsiUrl}" target="_blank" class="vc-link">
                    📹 Lancer l'appel vidéo
                </a>
            `;
        }

        this.isActive = true;
    },

    hideOverlay() {
        const overlay = document.getElementById('video-chat-overlay');
        if (overlay) {
            overlay.classList.remove('vc-visible');
        }
    },

    stop() {
        const container = document.getElementById('jitsi-container');
        if (container) {
            container.innerHTML = '';
        }
        this.isActive = false;
        this.roomName = null;
        this.jitsiUrl = null;
        this.hideOverlay();
    },

    // Compatibility methods
    setupSignaling() {},
    async startLocalMedia() { return true; },
    async createOffer() {}
};
