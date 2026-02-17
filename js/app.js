/* ============================================
   KID-IN - Jeux Éducatifs pour Enfants
   JavaScript Principal
   ============================================ */

// ==================== ÉTAT DE L'APPLICATION ====================
const App = {
    age: 7,
    currentScreen: 'welcome-screen',
    currentGame: null,
    totalStars: 0,
    gameStars: {},
    dontShowInstructions: {},
    playerId: null,
    playerName: null,
    playerAvatar: null,
    isMultiplayer: false,
    _mpScores: null,

    init() {
        this.loadProgress();
        this.bindEvents();
        this.bindMultiplayerEvents();
        this.showScreen('welcome-screen');

        // If a saved profile exists, auto-connect on start button click
        if (this.playerName && this.playerAvatar) {
            this._hasSavedProfile = true;
        }
    },

    loadProgress() {
        try {
            const saved = localStorage.getItem('kidin-progress');
            if (saved) {
                const data = JSON.parse(saved);
                this.totalStars = data.totalStars || 0;
                this.gameStars = data.gameStars || {};
                this.dontShowInstructions = data.dontShowInstructions || {};
            }
        } catch (e) { /* ignorer */ }
        // Restore player profile
        try {
            const profile = localStorage.getItem('kidin-profile');
            if (profile) {
                const p = JSON.parse(profile);
                this.playerName = p.name || null;
                this.playerAvatar = p.avatar || null;
            }
        } catch (e) { /* ignorer */ }
    },

    saveProgress() {
        try {
            localStorage.setItem('kidin-progress', JSON.stringify({
                totalStars: this.totalStars,
                gameStars: this.gameStars,
                dontShowInstructions: this.dontShowInstructions
            }));
        } catch (e) { /* ignorer */ }
    },

    saveProfile() {
        try {
            localStorage.setItem('kidin-profile', JSON.stringify({
                name: this.playerName,
                avatar: this.playerAvatar
            }));
        } catch (e) { /* ignorer */ }
    },

    addStars(game, stars) {
        const prev = this.gameStars[game] || 0;
        if (stars > prev) {
            this.totalStars += (stars - prev);
            this.gameStars[game] = stars;
            this.saveProgress();
        }
        this.updateStarsDisplay();
    },

    updateStarsDisplay() {
        const el = document.getElementById('total-stars-count');
        if (el) el.textContent = this.totalStars;

        ['math', 'words', 'memory', 'pattern', 'draw', 'quiz', 'intrus', 'vf', 'colorseq', 'countobj', 'timer'].forEach(game => {
            const starEl = document.getElementById(`stars-${game}`);
            if (starEl) {
                const count = this.gameStars[game] || 0;
                starEl.textContent = '\u2605'.repeat(count) + '\u2606'.repeat(Math.max(0, 3 - count));
            }
        });
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(screenId);
        if (screen) {
            screen.classList.add('active');
            this.currentScreen = screenId;
        }

        // Homepage music - needs user gesture to start (browser autoplay policy)
        if (screenId === 'welcome-screen') {
            HomepageMusic.init();
            if (!this._musicListenerBound) {
                this._musicListenerBound = true;
                const tryStartMusic = () => {
                    if (this.currentScreen === 'welcome-screen' && !HomepageMusic.playing) {
                        HomepageMusic.start();
                    }
                };
                document.addEventListener('click', tryStartMusic);
                document.addEventListener('touchstart', tryStartMusic);
                document.addEventListener('touchend', tryStartMusic);
            }
        } else {
            HomepageMusic.stop();
        }

        // In multiplayer, all players can now select age/game (no callee restrictions)
        const ageBanner = document.getElementById('age-waiting-banner');
        const menuBanner = document.getElementById('menu-waiting-banner');
        if (ageBanner) ageBanner.classList.add('hidden');
        if (menuBanner) menuBanner.classList.add('hidden');
        const ageScreen = document.getElementById('age-screen');
        const menuScreen = document.getElementById('menu-screen');
        if (ageScreen) ageScreen.classList.remove('mp-callee-dim');
        if (menuScreen) menuScreen.classList.remove('mp-callee-dim');
    },

    bindEvents() {
        // Accueil -> Player Select
        document.getElementById('start-btn').addEventListener('click', async () => {
            Sound.play('click');
            // Skip player select if we already have a saved profile
            if (this._hasSavedProfile) {
                this.showScreen('play-mode-screen');
                this._updateConnectionIndicator(false);
                try {
                    await Multiplayer.connect();
                    this._updateConnectionIndicator(true);
                    Multiplayer.registerOnline(this.playerAvatar, this.playerName);
                } catch (e) {
                    this._updateConnectionIndicator(false);
                }
                return;
            }
            this.showScreen('player-select-screen');
        });

        // Retour depuis l'écran d'âge
        document.getElementById('back-to-welcome').addEventListener('click', () => {
            Sound.play('click');
            if (this.isMultiplayer) {
                // In multiplayer: leave room, disconnect, go back to play-mode-screen
                if (Multiplayer.roomCode) Multiplayer.leaveRoom();
                Multiplayer.disconnect();
                AudioChat.stop();
                this.isMultiplayer = false;
                this._updateMpUI();
                this.showScreen('player-select-screen');
            } else {
                this.showScreen('player-select-screen');
            }
        });

        // Sélection de l'âge
        document.querySelectorAll('.age-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                Sound.play('click');
                this.age = parseInt(btn.dataset.age);
                document.getElementById('selected-age-display').textContent = this.age;
                this.updateStarsDisplay();
                if (this.isMultiplayer) {
                    Multiplayer.selectAge(this.age);
                } else {
                    this.showScreen('menu-screen');
                }
            });
        });

        // Changer d'âge
        document.getElementById('change-age-btn').addEventListener('click', () => {
            Sound.play('click');
            this.showScreen('age-screen');
        });

        // Cartes de jeux
        document.querySelectorAll('.game-card').forEach(card => {
            card.addEventListener('click', () => {
                Sound.play('click');
                const game = card.dataset.game;
                if (this.isMultiplayer) {
                    const totalQ = game === 'pattern' ? 8 : 10;
                    Multiplayer.selectGame(game, this.age, totalQ);
                } else {
                    this.launchGame(game);
                }
            });
        });

        // Retour au menu
        document.getElementById('back-to-menu').addEventListener('click', () => {
            Sound.play('click');
            Voice.stop();
            if (this.currentGame && this.currentGame.cleanup) {
                this.currentGame.cleanup();
            }
            this.currentGame = null;
            this.hideMultiplayerHeader();
            if (this.isMultiplayer) {
                // In multiplayer: go back to game selection, keep connection + audio alive
                this.showScreen('menu-screen');
            } else {
                this.showScreen('menu-screen');
            }
        });

        // Bouton rejouer du modal résultat
        document.getElementById('play-again-btn').addEventListener('click', () => {
            Sound.play('click');
            this.hideModal();
            if (this.currentGame) {
                const gameName = this.currentGame.name;
                if (this.isMultiplayer && Multiplayer.isHost) {
                    const totalQ = gameName === 'pattern' ? 8 : 10;
                    Multiplayer.selectGame(gameName, this.age, totalQ);
                } else if (!this.isMultiplayer) {
                    this.launchGame(gameName);
                }
            }
        });

        // Boutons du popup d'instructions
        document.getElementById('instruction-play-btn').addEventListener('click', () => {
            Sound.play('click');
            Voice.stop();
            this.hideInstructionModal();
            this.startGameNow(this._pendingGame);
        });

        document.getElementById('stop-voice-btn').addEventListener('click', () => {
            Voice.stop();
        });
    },

    launchGame(gameName) {
        if (this.dontShowInstructions[gameName]) {
            this.startGameNow(gameName);
        } else {
            this._pendingGame = gameName;
            this.showInstructionModal(gameName);
        }
    },

    showInstructionModal(gameName) {
        const info = Instructions.get(gameName, this.age);
        document.getElementById('instruction-icon').textContent = info.icon;
        document.getElementById('instruction-title').textContent = info.title;
        document.getElementById('instruction-text').textContent = info.text;
        document.getElementById('dont-show-check').checked = false;

        const modal = document.getElementById('instruction-modal');
        modal.classList.remove('hidden');

        // Lancer la voix
        Voice.speak(info.voiceText || info.text);
    },

    hideInstructionModal() {
        const modal = document.getElementById('instruction-modal');
        modal.classList.add('hidden');

        // Sauvegarder la préférence "Ne plus afficher"
        const dontShow = document.getElementById('dont-show-check').checked;
        if (dontShow && this._pendingGame) {
            this.dontShowInstructions[this._pendingGame] = true;
            this.saveProgress();
        }
    },

    startGameNow(gameName, seed) {
        this.hideModal();
        this.showScreen('game-screen');
        const container = document.getElementById('game-container');
        container.innerHTML = '';
        document.getElementById('game-score-value').textContent = '0';
        document.getElementById('progress-fill').style.width = '0%';

        const titles = {
            math: 'Magicien des Maths',
            words: 'Explorateur de Mots',
            memory: 'Jeu de M\u00E9moire',
            pattern: 'D\u00E9tective de Motifs',
            draw: 'Dessine & Colorie',
            quiz: 'Quiz',
            intrus: 'Trouve l\'Intrus',
            vf: 'Vrai ou Faux',
            colorseq: 'Suite de Couleurs',
            countobj: 'Compte les Objets',
            timer: 'Chrono D\u00E9fi'
        };

        document.getElementById('game-title').textContent = titles[gameName] || 'Jeu';

        const gameProgressEl = document.querySelector('.game-progress');

        if (gameName === 'draw' || gameName === 'timer') {
            gameProgressEl.style.display = 'none';
            document.querySelector('.game-progress-bar').style.display = 'none';
        } else if (gameName === 'colorseq') {
            gameProgressEl.style.display = '';
            document.querySelector('.game-progress-bar').style.display = '';
        } else {
            gameProgressEl.style.display = '';
            document.querySelector('.game-progress-bar').style.display = '';
        }

        // Create seeded RNG if seed provided (multiplayer)
        const rng = seed != null ? new SeededRandom(seed) : null;

        switch (gameName) {
            case 'math':
                this.currentGame = new MathWizard(this.age, container, rng);
                break;
            case 'words':
                this.currentGame = new WordExplorer(this.age, container, rng);
                break;
            case 'memory':
                this.currentGame = new MemoryMatch(this.age, container, rng);
                break;
            case 'pattern':
                this.currentGame = new PatternDetective(this.age, container, rng);
                break;
            case 'draw':
                this.currentGame = new ColorDraw(this.age, container, rng);
                break;
            case 'quiz':
                this.currentGame = new QuizTime(this.age, container, rng);
                break;
            case 'intrus':
                this.currentGame = new OddOneOut(this.age, container, rng);
                break;
            case 'vf':
                this.currentGame = new TrueOrFalse(this.age, container, rng);
                break;
            case 'colorseq':
                this.currentGame = new ColorSequence(this.age, container, rng);
                break;
            case 'countobj':
                this.currentGame = new CountObjects(this.age, container, rng);
                break;
            case 'timer':
                this.currentGame = new TimerChallenge(this.age, container, rng);
                break;
        }

        // Apply multiplayer wrapper if in multiplayer mode
        if (this.isMultiplayer && this.currentGame) {
            MultiplayerGameWrapper.wrap(this.currentGame);
        }

        // Show multiplayer score header
        if (this.isMultiplayer) {
            this.showMultiplayerHeader();
        }
    },

    // Définition de tous les jeux disponibles
    allGames: [
        { id: 'math',    icon: '\u{1F9EE}', label: 'Maths' },
        { id: 'words',   icon: '\u{1F4DD}', label: 'Mots' },
        { id: 'memory',  icon: '\u{1F0CF}', label: 'M\u00E9moire' },
        { id: 'pattern', icon: '\u{1F50D}', label: 'Motifs' },
        { id: 'draw',    icon: '\u{1F3A8}', label: 'Dessin' },
        { id: 'quiz',    icon: '\u2753',    label: 'Quiz' },
        { id: 'intrus',   icon: '\u{1F50E}', label: 'Intrus' },
        { id: 'vf',       icon: '\u2705',    label: 'Vrai/Faux' },
        { id: 'colorseq', icon: '\u{1F7E2}', label: 'Couleurs' },
        { id: 'countobj', icon: '\u{1F522}', label: 'Compter' },
        { id: 'timer',    icon: '\u23F1',    label: 'Chrono' }
    ],

    showModal(title, message, detail, starsEarned) {
        if (this.isMultiplayer) {
            this.showMultiplayerResult(title, message, detail, starsEarned);
            return;
        }

        const modal = document.getElementById('result-modal');
        document.getElementById('result-title').textContent = title;
        document.getElementById('result-message').textContent = message;
        document.getElementById('result-detail').textContent = detail || '';

        const starsDisplay = document.getElementById('result-stars-display');
        starsDisplay.textContent = '';
        for (let i = 0; i < 3; i++) {
            const star = document.createElement('span');
            star.textContent = i < starsEarned ? '\u2605' : '\u2606';
            star.style.color = i < starsEarned ? '#FFE66D' : '#ccc';
            star.style.fontSize = '3rem';
            star.style.margin = '0 3px';
            star.style.textShadow = i < starsEarned ? '0 0 10px rgba(255,230,109,0.5)' : 'none';
            starsDisplay.appendChild(star);
        }

        // Construire la grille de suggestion de jeux
        const currentGameName = this.currentGame ? this.currentGame.name : null;
        const grid = document.getElementById('switch-game-grid');
        grid.innerHTML = '';

        this.allGames.forEach(game => {
            const btn = document.createElement('button');
            btn.className = 'switch-game-btn' + (game.id === currentGameName ? ' sg-current' : '');
            btn.innerHTML = `<span class="sg-icon">${game.icon}</span><span class="sg-label">${game.label}</span>`;
            btn.addEventListener('click', () => {
                Sound.play('click');
                this.hideModal();
                if (this.currentGame && this.currentGame.cleanup) {
                    this.currentGame.cleanup();
                }
                this.currentGame = null;
                this.launchGame(game.id);
            });
            grid.appendChild(btn);
        });

        modal.classList.remove('hidden');

        if (starsEarned >= 2) this.spawnConfetti();
        if (starsEarned === 3) Sound.play('excellent');
        else if (starsEarned >= 1) Sound.play('good');
        else Sound.play('tryAgain');
    },

    hideModal() {
        document.getElementById('result-modal').classList.add('hidden');
        document.getElementById('confetti-container').innerHTML = '';
    },

    spawnConfetti() {
        const container = document.getElementById('confetti-container');
        container.innerHTML = '';
        const colors = ['#FF6B6B', '#FFE66D', '#4ECDC4', '#FF8A5C', '#9775FA', '#51CF66', '#339AF0', '#FF6B9D'];
        for (let i = 0; i < 50; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDelay = Math.random() * 2 + 's';
            piece.style.animationDuration = (2 + Math.random() * 2) + 's';
            piece.style.width = (5 + Math.random() * 10) + 'px';
            piece.style.height = (5 + Math.random() * 10) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            container.appendChild(piece);
        }
    },

    showFeedback(isCorrect) {
        const fb = document.createElement('div');
        fb.className = `feedback ${isCorrect ? 'correct-feedback' : 'wrong-feedback'}`;
        const correct = ['Bravo !', 'Super !', 'G\u00E9nial !', 'Oui !', 'Excellent !', 'Bien jou\u00E9 !', 'Top !'];
        const wrong = ['Essaie encore !', 'Oups !', 'Pas tout \u00E0 fait !', 'Presque !'];
        fb.textContent = isCorrect
            ? correct[Math.floor(Math.random() * correct.length)]
            : wrong[Math.floor(Math.random() * wrong.length)];
        document.body.appendChild(fb);
        setTimeout(() => fb.remove(), 1100);
    },

    updateGameProgress(current, total) {
        document.getElementById('game-question-num').textContent = current;
        document.getElementById('game-question-total').textContent = total;
        document.getElementById('progress-fill').style.width = ((current - 1) / total * 100) + '%';
    },

    updateGameScore(score) {
        document.getElementById('game-score-value').textContent = score;
    },

    // ==================== AVATAR HELPER ====================
    getAvatarSrc(avatar) {
        if (!avatar) return 'images/isaac.png';
        if (avatar.startsWith('data:')) return avatar; // base64 selfie
        return `images/${avatar}.png`; // preset: 'isaac' or 'aissa'
    },

    // ==================== MULTIPLAYER METHODS ====================

    bindMultiplayerEvents() {
        // Player select screen
        document.getElementById('back-to-welcome-from-player').addEventListener('click', () => {
            Sound.play('click');
            this._stopProfileCamera();
            this.showScreen('welcome-screen');
        });

        // Preset player cards (Isaac & Aissa)
        document.querySelectorAll('.player-card[data-player]').forEach(card => {
            card.addEventListener('click', async () => {
                Sound.play('click');
                document.querySelectorAll('.player-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.playerAvatar = card.dataset.player;
                this.playerName = card.dataset.name;
                this.saveProfile();

                document.getElementById('profile-creation-panel').classList.add('hidden');

                this.showScreen('play-mode-screen');

                this._updateConnectionIndicator(false);
                try {
                    await Multiplayer.connect();
                    this._updateConnectionIndicator(true);
                    Multiplayer.registerOnline(this.playerAvatar, this.playerName);
                } catch (e) {
                    this._updateConnectionIndicator(false);
                }
            });
        });

        // New player card - show profile creation panel
        document.getElementById('new-player-card').addEventListener('click', () => {
            Sound.play('click');
            document.querySelectorAll('.player-card').forEach(c => c.classList.remove('selected'));
            document.getElementById('new-player-card').classList.add('selected');
            const panel = document.getElementById('profile-creation-panel');
            panel.classList.remove('hidden');
            this._startProfileCamera();
        });

        // Capture selfie
        document.getElementById('btn-capture-selfie').addEventListener('click', () => {
            Sound.play('click');
            this._captureSelfie();
        });

        // Retake selfie
        document.getElementById('btn-retake-selfie').addEventListener('click', () => {
            Sound.play('click');
            this._retakeSelfie();
        });

        // Confirm profile
        document.getElementById('btn-confirm-profile').addEventListener('click', async () => {
            Sound.play('click');
            const nameInput = document.getElementById('profile-name-input');
            const name = nameInput.value.trim();
            if (!name) { nameInput.focus(); return; }
            if (!this._selfieBase64) return;

            this.playerName = name;
            this.playerAvatar = this._selfieBase64;
            this.saveProfile();
            this._stopProfileCamera();
            document.getElementById('profile-creation-panel').classList.add('hidden');

            this.showScreen('play-mode-screen');

            this._updateConnectionIndicator(false);
            try {
                await Multiplayer.connect();
                this._updateConnectionIndicator(true);
                Multiplayer.registerOnline(this.playerAvatar, this.playerName);
            } catch (e) {
                this._updateConnectionIndicator(false);
            }
        });

        // Cancel profile creation
        document.getElementById('btn-cancel-profile').addEventListener('click', () => {
            Sound.play('click');
            this._stopProfileCamera();
            document.getElementById('profile-creation-panel').classList.add('hidden');
            document.getElementById('new-player-card').classList.remove('selected');
        });

        // Name input - show confirm button when both name and selfie are ready
        document.getElementById('profile-name-input').addEventListener('input', () => {
            this._updateProfileConfirmBtn();
        });

        // Play solo
        document.getElementById('btn-solo').addEventListener('click', () => {
            Sound.play('click');
            this.isMultiplayer = false;
            Multiplayer.disconnect();
            this.showScreen('age-screen');
        });

        // Invite selected players
        document.getElementById('btn-invite').addEventListener('click', () => {
            Sound.play('click');
            const selected = [...Multiplayer._selectedInviteIds];
            if (selected.length === 0) return;
            Multiplayer.invitePlayers(selected);
            // Show invite overlay
            document.getElementById('invite-overlay').classList.remove('hidden');
            document.getElementById('invite-overlay-status').textContent = 'Invitation envoy\u00E9e...';
            document.getElementById('invite-accepted-count').textContent = '';
            document.getElementById('btn-invite-start').classList.add('hidden');
        });

        // Cancel invite
        document.getElementById('btn-invite-cancel').addEventListener('click', () => {
            Sound.play('click');
            Multiplayer.cancelInvite();
            document.getElementById('invite-overlay').classList.add('hidden');
        });

        // Start game with accepted players
        document.getElementById('btn-invite-start').addEventListener('click', () => {
            Sound.play('click');
            Multiplayer.startInvite();
        });

        // Accept incoming invite
        document.getElementById('btn-accept-call').addEventListener('click', () => {
            Sound.play('click');
            if (this._pendingInviteHostId) {
                Multiplayer.acceptInvite(this._pendingInviteHostId);
            }
            document.getElementById('incoming-call-overlay').classList.add('hidden');
        });

        // Decline incoming invite
        document.getElementById('btn-decline-call').addEventListener('click', () => {
            Sound.play('click');
            if (this._pendingInviteHostId) {
                Multiplayer.declineInvite(this._pendingInviteHostId);
            }
            document.getElementById('incoming-call-overlay').classList.add('hidden');
        });

        // Back from play-mode-screen
        document.getElementById('back-to-player-from-playmode').addEventListener('click', () => {
            Sound.play('click');
            Multiplayer.cancelInvite();
            Multiplayer.disconnect();
            document.getElementById('invite-overlay').classList.add('hidden');
            document.getElementById('incoming-call-overlay').classList.add('hidden');
            this._hasSavedProfile = false; // Allow re-picking profile
            this.showScreen('player-select-screen');
        });

        // Leave multiplayer from menu screen
        document.getElementById('leave-mp-btn').addEventListener('click', () => {
            Sound.play('click');
            if (Multiplayer.roomCode) Multiplayer.leaveRoom();
            Multiplayer.disconnect();
            AudioChat.stop();
            this.isMultiplayer = false;
            this._updateMpUI();
            this.showScreen('player-select-screen');
        });

        // Leave multiplayer from age screen (callee)
        document.getElementById('leave-mp-age-btn').addEventListener('click', () => {
            Sound.play('click');
            if (Multiplayer.roomCode) Multiplayer.leaveRoom();
            Multiplayer.disconnect();
            AudioChat.stop();
            this.isMultiplayer = false;
            this._updateMpUI();
            this.showScreen('player-select-screen');
        });

        // Leave multiplayer from game screen (callee)
        document.getElementById('leave-mp-game-btn').addEventListener('click', () => {
            Sound.play('click');
            Voice.stop();
            if (this.currentGame && this.currentGame.cleanup) {
                this.currentGame.cleanup();
            }
            this.currentGame = null;
            this.hideMultiplayerHeader();
            if (Multiplayer.roomCode) Multiplayer.leaveRoom();
            Multiplayer.disconnect();
            AudioChat.stop();
            this.isMultiplayer = false;
            this._updateMpUI();
            this.showScreen('player-select-screen');
        });

        // Back to menu from mp-score-header (host)
        document.getElementById('mp-back-to-menu').addEventListener('click', () => {
            Sound.play('click');
            Voice.stop();
            if (this.currentGame && this.currentGame.cleanup) {
                this.currentGame.cleanup();
            }
            this.currentGame = null;
            this.hideMultiplayerHeader();
            this.showScreen('menu-screen');
        });

        // Disconnect overlay
        document.getElementById('disconnect-back-btn').addEventListener('click', () => {
            Sound.play('click');
            document.getElementById('disconnect-overlay').classList.add('hidden');
            this.isMultiplayer = false;
            this._updateMpUI();
            this.hideMultiplayerHeader();
            AudioChat.stop();
            this.showScreen('menu-screen');
        });

        // Audio chat mute button
        document.getElementById('ac-mute-btn').addEventListener('click', () => {
            AudioChat.toggleMute();
        });

        // Setup multiplayer callbacks
        Multiplayer.onRoomError = (message) => {
            console.log('[App] Room error:', message);
        };

        Multiplayer.onConnectionChange = (connected) => {
            this._updateConnectionIndicator(connected);
        };

        Multiplayer.onPlayerLeft = (msg) => {
            AudioChat.stop();
            if (msg.disconnected || this.currentScreen === 'game-screen') {
                document.getElementById('disconnect-overlay').classList.remove('hidden');
            }
        };

        // Online players list
        Multiplayer.onOnlineList = (players) => {
            this._renderOnlinePlayers(players);
        };

        // Invite system callbacks
        Multiplayer.onInviteIncoming = (msg) => {
            this._pendingInviteHostId = msg.hostId;
            const photo = document.getElementById('incoming-caller-photo');
            photo.src = this.getAvatarSrc(msg.hostAvatar);
            document.getElementById('incoming-call-text').textContent = `${msg.hostName} veut jouer avec toi !`;
            document.getElementById('incoming-call-overlay').classList.remove('hidden');
        };

        Multiplayer.onInviteAccepted = (msg) => {
            document.getElementById('invite-overlay-status').textContent = 'Invitation accept\u00E9e !';
            document.getElementById('invite-accepted-count').textContent = `${msg.acceptedCount}/${msg.totalInvited} joueur(s) accept\u00E9(s)`;
            document.getElementById('btn-invite-start').classList.remove('hidden');
        };

        Multiplayer.onInviteMatched = (msg) => {
            document.getElementById('invite-overlay').classList.add('hidden');
            document.getElementById('incoming-call-overlay').classList.add('hidden');

            this.isMultiplayer = true;
            this._updateMpUI();
            this._inviteMatchedRoom = msg.roomCode;
        };

        Multiplayer.onRoomJoined = (players) => {
            console.log('[App] Room joined with players:', players.map(p => p.name).join(', '));

            if (this._inviteMatchedRoom) {
                this._inviteMatchedRoom = null;

                Multiplayer.isHost = players.length > 0 && players[0].id === Multiplayer.playerId;

                if (!Multiplayer.isHost) {
                    const host = players.find(p => p.id !== Multiplayer.playerId);
                    const hostName = host ? host.name : "L'h\u00F4te";
                    document.getElementById('age-waiting-text').textContent = `${hostName} choisit l'\u00E2ge...`;
                    document.getElementById('menu-waiting-text').textContent = `${hostName} choisit le jeu...`;
                }

                console.log('[App] Invite matched, starting audio...');
                AudioChat.start(Multiplayer.isHost, Multiplayer.players, Multiplayer.playerId);

                this.showScreen('age-screen');
            }
        };

        Multiplayer.onInviteDeclined = (msg) => {
            // A player declined - could show a notification but keep overlay open
        };

        Multiplayer.onInviteCancelled = (msg) => {
            document.getElementById('incoming-call-overlay').classList.add('hidden');
        };

        Multiplayer.onInviteTimeout = (msg) => {
            document.getElementById('invite-overlay').classList.add('hidden');
        };

        // WebRTC signaling callbacks
        Multiplayer.onRtcOffer = (msg) => {
            console.log('[App] Received RTC offer');
            AudioChat.handleOffer(msg.data);
        };
        Multiplayer.onRtcAnswer = (msg) => {
            console.log('[App] Received RTC answer');
            AudioChat.handleAnswer(msg.data);
        };
        Multiplayer.onRtcIce = (msg) => {
            AudioChat.handleIce(msg.data);
        };

        // Age selection broadcast (both host and callee receive this)
        Multiplayer.onAgeSelected = (msg) => {
            this.age = msg.age;
            document.getElementById('selected-age-display').textContent = this.age;
            this.updateStarsDisplay();
            this.showScreen('menu-screen');
        };

        Multiplayer.onGameStart = (msg) => {
            this.age = msg.age;
            document.getElementById('selected-age-display').textContent = this.age;
            this.startGameNow(msg.game, msg.seed);
        };
    },

    _updateMpUI() {
        const backToWelcome = document.getElementById('back-to-welcome');
        const leaveMpAge = document.getElementById('leave-mp-age-btn');
        const changeAgeBtn = document.getElementById('change-age-btn');
        const leaveBtn = document.getElementById('leave-mp-btn');
        const backToMenu = document.getElementById('back-to-menu');
        const leaveMpGame = document.getElementById('leave-mp-game-btn');
        // Back button inside mp-score-header (above video vignette)
        const mpBackToMenu = document.getElementById('mp-back-to-menu');

        if (this.isMultiplayer) {
            if (Multiplayer.isHost) {
                // Host: back buttons on age/menu, score-header back on game
                backToWelcome.classList.remove('hidden');
                leaveMpAge.classList.add('hidden');
                changeAgeBtn.classList.remove('hidden');
                leaveBtn.classList.remove('hidden');
                backToMenu.classList.add('hidden');
                leaveMpGame.classList.add('hidden');
                mpBackToMenu.classList.remove('hidden');
            } else {
                // Callee: quit buttons on age/menu, score-header back on game
                backToWelcome.classList.add('hidden');
                leaveMpAge.classList.remove('hidden');
                changeAgeBtn.classList.add('hidden');
                leaveBtn.classList.remove('hidden');
                backToMenu.classList.add('hidden');
                leaveMpGame.classList.add('hidden');
                mpBackToMenu.classList.remove('hidden');
            }
        } else {
            // Solo: back buttons visible, quit buttons hidden
            backToWelcome.classList.remove('hidden');
            leaveMpAge.classList.add('hidden');
            changeAgeBtn.classList.remove('hidden');
            leaveBtn.classList.add('hidden');
            backToMenu.classList.remove('hidden');
            leaveMpGame.classList.add('hidden');
            mpBackToMenu.classList.add('hidden');
        }
    },

    _updateConnectionIndicator(connected) {
        const indicator = document.getElementById('connection-indicator');
        if (indicator) {
            indicator.className = 'connection-indicator ' + (connected ? 'connected' : 'disconnected');
            indicator.title = connected ? 'Connecté au serveur' : 'Déconnecté';
        }
    },

    showMultiplayerHeader() {
        const header = document.getElementById('mp-score-header');
        header.classList.remove('hidden');
        document.body.classList.add('mp-header-visible');

        const row = document.getElementById('mp-players-row');
        row.innerHTML = '';

        // Me first, then others
        const me = Multiplayer.players.find(p => p.id === Multiplayer.playerId);
        const others = Multiplayer.getOtherPlayers();
        const allOrdered = me ? [me, ...others] : others;

        allOrdered.forEach((p, i) => {
            const isMe = p.id === Multiplayer.playerId;
            const div = document.createElement('div');
            div.className = 'mp-player' + (isMe ? ' mp-player-me' : '');
            div.innerHTML = `
                <div class="mp-avatar"><img src="${this.getAvatarSrc(p.avatar)}" alt="${p.name}"></div>
                <span class="mp-player-name">${p.name}</span>
                <span class="mp-player-score" id="mp-score-${p.id}">0</span>
            `;
            row.appendChild(div);
        });
    },

    hideMultiplayerHeader() {
        document.getElementById('mp-score-header').classList.add('hidden');
        document.body.classList.remove('mp-header-visible');
    },

    updateMultiplayerScores(scores) {
        if (!scores) return;
        for (const [playerId, score] of Object.entries(scores)) {
            const el = document.getElementById(`mp-score-${playerId}`);
            if (el) el.textContent = score;
        }
    },

    showMultiplayerResult(title, message, detail, starsEarned) {
        const modal = document.getElementById('result-modal');
        document.getElementById('result-title').textContent = title;
        document.getElementById('result-message').textContent = message;

        const detailEl = document.getElementById('result-detail');
        detailEl.innerHTML = '';

        if (this._mpScores && Multiplayer.players.length >= 2) {
            // Build ranked list of all players
            const ranked = Multiplayer.players.map(p => ({
                ...p,
                score: this._mpScores[p.id] || 0
            })).sort((a, b) => b.score - a.score);

            const scoresDiv = document.createElement('div');
            scoresDiv.className = 'mp-result-rankings';

            ranked.forEach((p, i) => {
                const isWinner = i === 0 && (ranked.length === 1 || p.score > (ranked[1]?.score || 0));
                const isTied = i > 0 && p.score === ranked[0].score;
                const rank = i + 1;
                const rankLabel = rank === 1 ? '\u{1F451}' : `#${rank}`;

                const entry = document.createElement('div');
                entry.className = 'mp-result-player' + (isWinner || isTied ? ' mp-winner' : '');
                entry.innerHTML = `
                    <span class="mp-result-rank">${rankLabel}</span>
                    <div class="mp-result-avatar"><img src="${this.getAvatarSrc(p.avatar)}" alt="${p.name}"></div>
                    <span class="mp-result-name">${p.name}</span>
                    <span class="mp-result-score">${p.score}</span>
                `;
                scoresDiv.appendChild(entry);
            });

            detailEl.appendChild(scoresDiv);

            // Check for tie at top
            if (ranked.length >= 2 && ranked[0].score === ranked[1].score) {
                detailEl.insertAdjacentHTML('beforeend', '<p style="color:var(--color-text-light);margin-top:5px;">\u00C9galit\u00E9 !</p>');
            }
        } else {
            detailEl.textContent = detail || '';
        }

        const starsDisplay = document.getElementById('result-stars-display');
        starsDisplay.textContent = '';
        for (let i = 0; i < 3; i++) {
            const star = document.createElement('span');
            star.textContent = i < starsEarned ? '\u2605' : '\u2606';
            star.style.color = i < starsEarned ? '#FFE66D' : '#ccc';
            star.style.fontSize = '3rem';
            star.style.margin = '0 3px';
            star.style.textShadow = i < starsEarned ? '0 0 10px rgba(255,230,109,0.5)' : 'none';
            starsDisplay.appendChild(star);
        }

        // Game switch grid
        const currentGameName = this.currentGame ? this.currentGame.name : null;
        const grid = document.getElementById('switch-game-grid');
        grid.innerHTML = '';

        if (this.isMultiplayer && Multiplayer.isHost) {
            this.allGames.forEach(game => {
                const btn = document.createElement('button');
                btn.className = 'switch-game-btn' + (game.id === currentGameName ? ' sg-current' : '');
                btn.innerHTML = `<span class="sg-icon">${game.icon}</span><span class="sg-label">${game.label}</span>`;
                btn.addEventListener('click', () => {
                    Sound.play('click');
                    this.hideModal();
                    if (this.currentGame && this.currentGame.cleanup) {
                        this.currentGame.cleanup();
                    }
                    this.currentGame = null;
                    const totalQ = game.id === 'pattern' ? 8 : 10;
                    Multiplayer.selectGame(game.id, this.age, totalQ);
                });
                grid.appendChild(btn);
            });
        } else if (!this.isMultiplayer) {
            this.allGames.forEach(game => {
                const btn = document.createElement('button');
                btn.className = 'switch-game-btn' + (game.id === currentGameName ? ' sg-current' : '');
                btn.innerHTML = `<span class="sg-icon">${game.icon}</span><span class="sg-label">${game.label}</span>`;
                btn.addEventListener('click', () => {
                    Sound.play('click');
                    this.hideModal();
                    if (this.currentGame && this.currentGame.cleanup) {
                        this.currentGame.cleanup();
                    }
                    this.currentGame = null;
                    this.launchGame(game.id);
                });
                grid.appendChild(btn);
            });
        }

        modal.classList.remove('hidden');

        if (starsEarned >= 2) this.spawnConfetti();
        if (starsEarned === 3) Sound.play('excellent');
        else if (starsEarned >= 1) Sound.play('good');
        else Sound.play('tryAgain');
    },

    // ==================== PROFILE CAMERA ====================
    _selfieBase64: null,
    _profileStream: null,

    _startProfileCamera() {
        const video = document.getElementById('profile-camera-feed');
        const preview = document.getElementById('profile-selfie-preview');
        const captureBtn = document.getElementById('btn-capture-selfie');
        const retakeBtn = document.getElementById('btn-retake-selfie');

        video.classList.remove('hidden');
        preview.classList.add('hidden');
        captureBtn.classList.remove('hidden');
        retakeBtn.classList.add('hidden');
        this._selfieBase64 = null;
        this._updateProfileConfirmBtn();

        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 200 }, height: { ideal: 200 } }, audio: false })
            .then(stream => {
                this._profileStream = stream;
                video.srcObject = stream;
            })
            .catch(err => {
                console.error('[Profile] Camera error:', err);
                video.style.display = 'none';
                // Use a default avatar
                this._selfieBase64 = null;
            });
    },

    _stopProfileCamera() {
        if (this._profileStream) {
            this._profileStream.getTracks().forEach(t => t.stop());
            this._profileStream = null;
        }
        const video = document.getElementById('profile-camera-feed');
        if (video) video.srcObject = null;
    },

    _captureSelfie() {
        const video = document.getElementById('profile-camera-feed');
        const canvas = document.getElementById('profile-selfie-canvas');
        const preview = document.getElementById('profile-selfie-preview');
        const captureBtn = document.getElementById('btn-capture-selfie');
        const retakeBtn = document.getElementById('btn-retake-selfie');

        const ctx = canvas.getContext('2d');
        // Draw video frame to 200x200 canvas
        const size = Math.min(video.videoWidth, video.videoHeight);
        const sx = (video.videoWidth - size) / 2;
        const sy = (video.videoHeight - size) / 2;
        ctx.drawImage(video, sx, sy, size, size, 0, 0, 200, 200);

        this._selfieBase64 = canvas.toDataURL('image/jpeg', 0.7);
        preview.src = this._selfieBase64;

        video.classList.add('hidden');
        preview.classList.remove('hidden');
        captureBtn.classList.add('hidden');
        retakeBtn.classList.remove('hidden');

        this._stopProfileCamera();
        this._updateProfileConfirmBtn();
    },

    _retakeSelfie() {
        this._selfieBase64 = null;
        this._updateProfileConfirmBtn();
        this._startProfileCamera();
    },

    _updateProfileConfirmBtn() {
        const name = document.getElementById('profile-name-input').value.trim();
        const btn = document.getElementById('btn-confirm-profile');
        if (name && this._selfieBase64) {
            btn.classList.remove('hidden');
        } else {
            btn.classList.add('hidden');
        }
    },

    // ==================== ONLINE PLAYERS GRID ====================
    _renderOnlinePlayers(players) {
        const grid = document.getElementById('online-players-grid');
        const inviteBtn = document.getElementById('btn-invite');

        // Filter out self
        const others = players.filter(p => p.id !== Multiplayer.playerId);

        // Clear grid but preserve structure
        grid.innerHTML = '';

        if (others.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'online-empty';
            empty.textContent = 'Aucun autre joueur en ligne...';
            grid.appendChild(empty);
            inviteBtn.classList.add('hidden');
            return;
        }

        others.forEach(p => {
            const card = document.createElement('div');
            card.className = 'online-player-card' + (Multiplayer._selectedInviteIds.has(p.id) ? ' selected' : '');
            card.dataset.playerId = p.id;
            card.innerHTML = `
                <div class="online-player-avatar">
                    <img src="${this.getAvatarSrc(p.avatar)}" alt="${p.name}">
                </div>
                <span class="online-player-name">${p.name}</span>
                <span class="online-player-check">\u2713</span>
            `;
            card.addEventListener('click', () => {
                Sound.play('click');
                if (Multiplayer._selectedInviteIds.has(p.id)) {
                    Multiplayer._selectedInviteIds.delete(p.id);
                    card.classList.remove('selected');
                } else {
                    if (Multiplayer._selectedInviteIds.size < 5) {
                        Multiplayer._selectedInviteIds.add(p.id);
                        card.classList.add('selected');
                    }
                }
                inviteBtn.classList.toggle('hidden', Multiplayer._selectedInviteIds.size === 0);
            });
            grid.appendChild(card);
        });

        inviteBtn.classList.toggle('hidden', Multiplayer._selectedInviteIds.size === 0);
    }
};


// ==================== INSTRUCTIONS DES JEUX ====================
const Instructions = {
    get(gameName, age) {
        const data = {
            math: {
                icon: '\u{1F9EE}',
                title: 'Magicien des Maths',
                text: 'R\u00E9sous les probl\u00E8mes de math\u00E9matiques ! Regarde bien le calcul affich\u00E9 et choisis la bonne r\u00E9ponse parmi les quatre propositions. Tu as 10 questions. Bonne chance !',
                voiceText: 'Bienvenue dans le Magicien des Maths ! Tu vas voir des calculs \u00E0 l\'\u00E9cran. Regarde bien le probl\u00E8me, puis clique sur la bonne r\u00E9ponse parmi les quatre choix. Il y a 10 questions. Bonne chance !'
            },
            words: {
                icon: '\u{1F4DD}',
                title: 'Explorateur de Mots',
                text: age <= 6
                    ? 'Regarde l\'image et trouve par quelle lettre commence le mot ! Choisis la bonne lettre parmi les propositions.'
                    : age <= 8
                    ? 'Trouve la lettre manquante dans chaque mot ! Regarde bien le mot avec un trou et choisis la bonne lettre.'
                    : 'Remets les lettres dans le bon ordre pour former le mot ! Clique sur les lettres une par une.',
                voiceText: age <= 6
                    ? 'Bienvenue dans l\'Explorateur de Mots ! Tu vas voir une image et un mot. Trouve par quelle lettre commence ce mot et clique sur la bonne r\u00E9ponse !'
                    : age <= 8
                    ? 'Bienvenue dans l\'Explorateur de Mots ! Chaque mot a une lettre manquante. Regarde bien le mot et choisis la lettre qui manque !'
                    : 'Bienvenue dans l\'Explorateur de Mots ! Les lettres du mot sont m\u00E9lang\u00E9es. Clique sur les lettres dans le bon ordre pour reformer le mot !'
            },
            memory: {
                icon: '\u{1F0CF}',
                title: 'Jeu de M\u00E9moire',
                text: 'Retourne les cartes pour trouver les paires ! M\u00E9morise bien la position de chaque image. Essaie de trouver toutes les paires avec le moins de coups possible !',
                voiceText: 'Bienvenue dans le Jeu de M\u00E9moire ! Clique sur une carte pour la retourner. Ensuite, clique sur une autre carte. Si les deux images sont identiques, c\'est gagn\u00E9 ! Sinon, elles se retournent. M\u00E9morise bien les positions !'
            },
            pattern: {
                icon: '\u{1F50D}',
                title: 'D\u00E9tective de Motifs',
                text: 'Observe bien la suite d\'\u00E9l\u00E9ments et trouve ce qui vient apr\u00E8s ! Regarde le motif qui se r\u00E9p\u00E8te et choisis la bonne r\u00E9ponse.',
                voiceText: 'Bienvenue D\u00E9tective ! Tu vas voir une suite d\'\u00E9l\u00E9ments avec un point d\'interrogation \u00E0 la fin. Observe bien le motif, puis choisis ce qui vient apr\u00E8s parmi les quatre propositions !'
            },
            draw: {
                icon: '\u{1F3A8}',
                title: 'Dessine & Colorie',
                text: 'C\'est le moment de cr\u00E9er ! Choisis tes couleurs pr\u00E9f\u00E9r\u00E9es, la taille du pinceau, et dessine tout ce que tu veux. Tu peux utiliser la gomme et sauvegarder ton dessin !',
                voiceText: 'Bienvenue dans l\'atelier de dessin ! Choisis une couleur en cliquant dessus, puis dessine sur le cadre blanc avec ta souris. Tu peux changer la taille du pinceau, utiliser la gomme, et sauvegarder ton chef-d\'\u0153uvre !'
            },
            quiz: {
                icon: '\u2753',
                title: 'Quiz',
                text: 'R\u00E9ponds \u00E0 des questions amusantes ! Lis bien chaque question et choisis la bonne r\u00E9ponse parmi les quatre propositions. Il y a 10 questions. Bonne chance !',
                voiceText: 'Bienvenue dans le Quiz ! Tu vas voir des questions amusantes sur les animaux, la nature, les sciences et plein d\'autres sujets. Lis bien la question et clique sur la bonne r\u00E9ponse. Bonne chance !'
            },
            intrus: {
                icon: '\u{1F50E}',
                title: 'Trouve l\'Intrus',
                text: 'Tu vas voir 4 images. Trois vont ensemble, mais une est diff\u00E9rente ! Trouve l\'intrus et clique dessus. Il y a 10 questions. Bonne chance !',
                voiceText: 'Bienvenue dans Trouve l\'Intrus ! Tu vas voir 4 images \u00E0 l\'\u00E9cran. Trois d\'entre elles vont ensemble, mais une est diff\u00E9rente. Clique sur celle qui ne va pas avec les autres !'
            },
            vf: {
                icon: '\u2705',
                title: 'Vrai ou Faux',
                text: 'Tu vas lire une affirmation. Est-ce que c\'est vrai ou faux ? Clique sur le bon bouton ! Il y a 10 questions. Bonne chance !',
                voiceText: 'Bienvenue dans Vrai ou Faux ! Tu vas lire une phrase \u00E0 l\'\u00E9cran. R\u00E9fl\u00E9chis bien, puis clique sur Vrai si c\'est correct, ou sur Faux si c\'est incorrect !'
            },
            colorseq: {
                icon: '\u{1F7E2}',
                title: 'Suite de Couleurs',
                text: 'Regarde bien les couleurs qui s\'allument et reproduis la s\u00E9quence dans le m\u00EAme ordre ! La s\u00E9quence s\'allonge \u00E0 chaque tour. Jusqu\'o\u00F9 iras-tu ?',
                voiceText: 'Bienvenue dans la Suite de Couleurs ! Des cercles color\u00E9s vont s\'allumer un par un. M\u00E9morise l\'ordre, puis clique sur les couleurs dans le m\u00EAme ordre. Attention, la s\u00E9quence s\'allonge !'
            },
            countobj: {
                icon: '\u{1F522}',
                title: 'Compte les Objets',
                text: 'Des objets sont \u00E9parpill\u00E9s sur l\'\u00E9cran. Compte bien les objets demand\u00E9s et choisis la bonne r\u00E9ponse ! Il y a 10 questions. Bonne chance !',
                voiceText: 'Bienvenue dans Compte les Objets ! Tu vas voir plein d\'objets \u00E9parpill\u00E9s. On te demandera combien il y en a d\'un certain type. Compte bien et clique sur la bonne r\u00E9ponse !'
            },
            timer: {
                icon: '\u23F1',
                title: 'Chrono D\u00E9fi',
                text: 'Le chrono d\u00E9marre \u00E0 00:00 et monte. Appuie sur STOP le plus pr\u00E8s possible de 10:00 ! Il y a 5 manches. Celui qui est le plus pr\u00E8s de 10 secondes gagne le point !',
                voiceText: 'Bienvenue dans le Chrono D\u00E9fi ! Un chrono va d\u00E9marrer \u00E0 z\u00E9ro et monter. Tu dois appuyer sur le bouton Stop le plus pr\u00E8s possible de 10 secondes. Bonne chance !'
            }
        };
        return data[gameName] || data.math;
    }
};


// ==================== SYNTHÈSE VOCALE ====================
const Voice = {
    speaking: false,
    _cachedVoice: null,

    _pickBestFrenchVoice() {
        if (this._cachedVoice) return this._cachedVoice;
        const voices = speechSynthesis.getVoices();
        const french = voices.filter(v => v.lang.startsWith('fr'));
        if (french.length === 0) return null;

        // Score voices: prefer natural/premium voices over robotic defaults
        const score = (v) => {
            const name = v.name.toLowerCase();
            // Google Natural/Wavenet voices (Chrome) — best quality
            if (name.includes('google') && name.includes('natural')) return 100;
            if (name.includes('google')) return 90;
            // Microsoft Online (Neural) voices (Edge/Windows) — very natural
            if (name.includes('online') || name.includes('neural')) return 85;
            // Apple premium voices (Safari/macOS/iOS)
            if (name.includes('audrey') || name.includes('thomas') || name.includes('amelie')) return 80;
            // Enhanced / premium markers
            if (name.includes('premium') || name.includes('enhanced') || name.includes('natural')) return 75;
            // Non-local voices are often higher quality
            if (!v.localService) return 60;
            return 10;
        };

        french.sort((a, b) => score(b) - score(a));
        this._cachedVoice = french[0];
        return this._cachedVoice;
    },

    speak(text) {
        if (!('speechSynthesis' in window)) return;
        this.stop();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR';
        utterance.rate = 0.95;
        utterance.pitch = 1.1;
        utterance.volume = 1;

        const voice = this._pickBestFrenchVoice();
        if (voice) utterance.voice = voice;

        utterance.onstart = () => { this.speaking = true; };
        utterance.onend = () => { this.speaking = false; };
        utterance.onerror = () => { this.speaking = false; };

        speechSynthesis.speak(utterance);
    },

    stop() {
        if ('speechSynthesis' in window) {
            speechSynthesis.cancel();
            this.speaking = false;
        }
    }
};

// Charger les voix (nécessaire pour certains navigateurs)
if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = () => { Voice._cachedVoice = null; speechSynthesis.getVoices(); };
}


// ==================== EFFETS SONORES ====================
const Sound = {
    ctx: null,

    getContext() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.ctx;
    },

    play(type) {
        try {
            const ctx = this.getContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = 0.15;

            switch (type) {
                case 'click':
                    osc.frequency.value = 600;
                    osc.type = 'sine';
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.1);
                    break;
                case 'correct':
                    osc.frequency.value = 523;
                    osc.type = 'sine';
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.15);
                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(ctx.destination);
                    osc2.frequency.value = 659;
                    osc2.type = 'sine';
                    gain2.gain.value = 0.15;
                    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
                    osc2.start(ctx.currentTime + 0.15);
                    osc2.stop(ctx.currentTime + 0.35);
                    break;
                case 'wrong':
                    osc.frequency.value = 200;
                    osc.type = 'square';
                    gain.gain.value = 0.08;
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.3);
                    break;
                case 'excellent':
                    [523, 659, 784, 1047].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g);
                        g.connect(ctx.destination);
                        o.frequency.value = freq;
                        o.type = 'sine';
                        g.gain.value = 0.12;
                        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15 * (i + 1) + 0.15);
                        o.start(ctx.currentTime + 0.15 * i);
                        o.stop(ctx.currentTime + 0.15 * (i + 1) + 0.1);
                    });
                    break;
                case 'good':
                    [440, 554].forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g);
                        g.connect(ctx.destination);
                        o.frequency.value = freq;
                        o.type = 'sine';
                        g.gain.value = 0.12;
                        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2 * (i + 1) + 0.2);
                        o.start(ctx.currentTime + 0.2 * i);
                        o.stop(ctx.currentTime + 0.2 * (i + 1) + 0.15);
                    });
                    break;
                case 'tryAgain':
                    osc.frequency.value = 330;
                    osc.type = 'sine';
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.5);
                    break;
                case 'flip':
                    osc.frequency.value = 400;
                    osc.type = 'sine';
                    gain.gain.value = 0.1;
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.08);
                    break;
                case 'match':
                    osc.frequency.value = 700;
                    osc.type = 'sine';
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
                    osc.start(ctx.currentTime);
                    osc.stop(ctx.currentTime + 0.2);
                    break;
            }
        } catch (e) { /* ignorer les erreurs audio */ }
    }
};


// ==================== MUSIQUE D'ACCUEIL ====================
const HomepageMusic = {
    ctx: null,
    nodes: [],
    playing: false,
    muted: false,
    masterGain: null,
    filter: null,
    delay: null,
    interval: null,
    btn: null,
    beat: 0,
    bpm: 95,

    init() {
        const welcome = document.getElementById('welcome-screen');
        if (!welcome || this.btn) return;
        this.btn = document.createElement('button');
        this.btn.id = 'music-toggle';
        this.btn.className = 'music-toggle-btn';
        this.btn.innerHTML = '\u{1F50A}';
        this.btn.title = 'Couper/Remettre la musique';
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        welcome.appendChild(this.btn);
    },

    start() {
        if (this.playing) return;
        this.init();
        if (this.muted) {
            if (this.btn) this.btn.innerHTML = '\u{1F507}';
            return;
        }
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            // Mobile browsers require resume() inside a user gesture
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }

            // Master output chain: filter -> delay -> gain -> destination
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = 0.18;

            // Warm low-pass filter for lo-fi feel
            this.filter = this.ctx.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 2800;
            this.filter.Q.value = 0.7;

            // Subtle delay for spaciousness
            this.delay = this.ctx.createDelay(1.0);
            this.delay.delayTime.value = 60 / this.bpm * 0.75;
            const delayGain = this.ctx.createGain();
            delayGain.gain.value = 0.15;

            this.filter.connect(this.masterGain);
            this.filter.connect(this.delay);
            this.delay.connect(delayGain);
            delayGain.connect(this.masterGain);
            this.masterGain.connect(this.ctx.destination);

            this.playing = true;
            this.beat = 0;
            if (this.btn) this.btn.innerHTML = '\u{1F50A}';
            this._scheduleBar();
        } catch (e) { /* ignore audio errors */ }
    },

    stop() {
        this.playing = false;
        if (this.interval) { clearTimeout(this.interval); this.interval = null; }
        this.nodes.forEach(n => { try { n.stop(); } catch(e){} });
        this.nodes = [];
        if (this.ctx) { try { this.ctx.close(); } catch(e){} this.ctx = null; }
    },

    toggle() {
        this.muted = !this.muted;
        if (this.muted) {
            this.stop();
            if (this.btn) this.btn.innerHTML = '\u{1F507}';
        } else {
            this.start();
        }
    },

    // Soft synth pad - two detuned oscillators for warmth
    _pad(freq, start, dur, vol) {
        if (!this.ctx || !this.playing) return;
        const v = vol || 0.12;
        [-4, 4].forEach(detune => {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.detune.value = detune;
            g.gain.setValueAtTime(0, start);
            g.gain.linearRampToValueAtTime(v, start + 0.12);
            g.gain.setValueAtTime(v, start + dur - 0.15);
            g.gain.linearRampToValueAtTime(0, start + dur);
            osc.connect(g);
            g.connect(this.filter);
            osc.start(start);
            osc.stop(start + dur + 0.05);
            this.nodes.push(osc);
        });
    },

    // Plucky synth lead - quick attack, filtered
    _pluck(freq, start, dur, vol) {
        if (!this.ctx || !this.playing) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        const f = this.ctx.createBiquadFilter();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        f.type = 'lowpass';
        f.frequency.setValueAtTime(3500, start);
        f.frequency.exponentialRampToValueAtTime(800, start + dur);
        g.gain.setValueAtTime(vol || 0.2, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(f);
        f.connect(g);
        g.connect(this.filter);
        osc.start(start);
        osc.stop(start + dur + 0.05);
        this.nodes.push(osc);
    },

    // Soft sub bass
    _bass(freq, start, dur) {
        if (!this.ctx || !this.playing) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.2, start + 0.04);
        g.gain.setValueAtTime(0.15, start + dur * 0.5);
        g.gain.linearRampToValueAtTime(0, start + dur);
        osc.connect(g);
        g.connect(this.filter);
        osc.start(start);
        osc.stop(start + dur + 0.05);
        this.nodes.push(osc);
    },

    // Soft kick / thump
    _kick(start) {
        if (!this.ctx || !this.playing) return;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120, start);
        osc.frequency.exponentialRampToValueAtTime(40, start + 0.12);
        g.gain.setValueAtTime(0.18, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
        osc.connect(g);
        g.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + 0.25);
        this.nodes.push(osc);
    },

    // Hi-hat using filtered noise
    _hat(start, vol) {
        if (!this.ctx || !this.playing) return;
        const bufferSize = this.ctx.sampleRate * 0.05;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const f = this.ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 8000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(vol || 0.06, start);
        g.gain.exponentialRampToValueAtTime(0.001, start + 0.05);
        src.connect(f);
        f.connect(g);
        g.connect(this.masterGain);
        src.start(start);
        this.nodes.push(src);
    },

    _scheduleBar() {
        if (!this.playing || !this.ctx) return;
        const t = this.ctx.currentTime + 0.05;
        const beatDur = 60 / this.bpm;
        const barDur = beatDur * 4;
        const bar = this.beat % 4;

        // Chord progression: Cmaj7 - Am7 - Fmaj7 - G7 (modern pop/lofi)
        const chords = [
            { root: 131, notes: [262, 330, 392, 494] },  // Cmaj7
            { root: 110, notes: [220, 262, 330, 392] },  // Am7
            { root: 175, notes: [349, 440, 523, 659] },  // Fmaj7
            { root: 196, notes: [392, 494, 587, 698] }   // G7
        ];

        // Melody patterns - dreamy pentatonic phrases
        const melodyPatterns = [
            [[784, 0.5], [880, 0.5], [1047, 1], [880, 0.5], [784, 0.5], [659, 1]],
            [[659, 0.75], [784, 0.25], [880, 0.5], [784, 0.5], [659, 1], [523, 1]],
            [[1047, 0.5], [880, 0.5], [784, 1], [659, 0.5], [784, 0.5], [880, 1]],
            [[523, 0.5], [659, 0.5], [784, 0.5], [880, 0.5], [1047, 1], [880, 1]]
        ];

        const chord = chords[bar];

        // Pad chord - warm sustained background
        chord.notes.forEach(n => this._pad(n, t, barDur, 0.06));

        // Sub bass
        this._bass(chord.root, t, barDur);

        // Drums - chill lo-fi pattern
        for (let i = 0; i < 4; i++) {
            const bt = t + i * beatDur;
            if (i === 0 || i === 2) this._kick(bt);
            this._hat(bt, 0.04);
            if (i === 1 || i === 3) this._hat(bt + beatDur * 0.5, 0.025);
        }

        // Plucky melody - play on some bars with variation
        if (bar === 0 || bar === 2) {
            const pattern = melodyPatterns[Math.floor(Math.random() * melodyPatterns.length)];
            let mOff = 0;
            pattern.forEach(([freq, dur]) => {
                const d = dur * beatDur;
                this._pluck(freq, t + mOff, d * 0.9, 0.13);
                mOff += d;
            });
        }

        // Sparkle arpeggios on other bars
        if (bar === 1 || bar === 3) {
            chord.notes.forEach((n, i) => {
                this._pluck(n * 2, t + i * beatDur * 0.5, beatDur * 0.4, 0.05);
            });
        }

        // Cleanup old nodes
        this.nodes = this.nodes.filter(n => {
            try { return n.context && n.context.state !== 'closed'; } catch(e) { return false; }
        });

        this.beat++;
        this.interval = setTimeout(() => this._scheduleBar(), barDur * 1000 - 50);
    }
};


// ==================== FONCTIONS UTILITAIRES ====================
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function generateWrongAnswers(correct, count, min, max) {
    const wrongs = new Set();
    while (wrongs.size < count) {
        let w = randInt(min, max);
        if (w !== correct && !wrongs.has(w)) wrongs.add(w);
    }
    return [...wrongs];
}


// ==================== JEU : MAGICIEN DES MATHS ====================
class MathWizard {
    constructor(age, container, rng) {
        this.name = 'math';
        this.age = age;
        this.container = container;
        this._rng = rng;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = [];
        this.generateQuestions();
        this.showQuestion();
    }

    _randInt(min, max) {
        return this._rng ? this._rng.randInt(min, max) : randInt(min, max);
    }

    _shuffle(arr) {
        return this._rng ? this._rng.shuffle(arr) : shuffle(arr);
    }

    _random() {
        return this._rng ? this._rng.next() : Math.random();
    }

    generateQuestions() {
        this.questions = [];
        for (let i = 0; i < this.total; i++) {
            this.questions.push(this.createQuestion());
        }
    }

    createQuestion() {
        let a, b, op, answer, question;

        if (this.age <= 6) {
            op = this._random() > 0.3 ? '+' : '-';
            if (op === '+') {
                a = this._randInt(1, 8);
                b = this._randInt(1, 8);
                answer = a + b;
            } else {
                a = this._randInt(3, 10);
                b = this._randInt(1, a - 1);
                answer = a - b;
            }
            question = `${a} ${op} ${b} = ?`;
        } else if (this.age <= 8) {
            const ops = ['+', '-', '\u00D7'];
            op = ops[this._randInt(0, 2)];
            if (op === '+') {
                a = this._randInt(5, 30);
                b = this._randInt(5, 30);
                answer = a + b;
            } else if (op === '-') {
                a = this._randInt(10, 50);
                b = this._randInt(1, a);
                answer = a - b;
            } else {
                a = this._randInt(2, 6);
                b = this._randInt(2, 6);
                answer = a * b;
            }
            question = `${a} ${op} ${b} = ?`;
        } else {
            const ops = ['+', '-', '\u00D7', '\u00F7'];
            op = ops[this._randInt(0, 3)];
            if (op === '+') {
                a = this._randInt(20, 100);
                b = this._randInt(10, 80);
                answer = a + b;
            } else if (op === '-') {
                a = this._randInt(30, 150);
                b = this._randInt(10, a);
                answer = a - b;
            } else if (op === '\u00D7') {
                a = this._randInt(3, 12);
                b = this._randInt(3, 12);
                answer = a * b;
            } else {
                b = this._randInt(2, 10);
                answer = this._randInt(2, 12);
                a = b * answer;
            }
            question = `${a} ${op} ${b} = ?`;
        }

        const wrongs = this._generateWrongAnswers(answer, 3,
            Math.max(0, answer - (this.age <= 6 ? 5 : 15)),
            answer + (this.age <= 6 ? 5 : 15));
        const options = this._shuffle([answer, ...wrongs]);

        return { question, answer, options };
    }

    _generateWrongAnswers(correct, count, min, max) {
        const wrongs = new Set();
        while (wrongs.size < count) {
            let w = this._randInt(min, max);
            if (w !== correct && !wrongs.has(w)) wrongs.add(w);
        }
        return [...wrongs];
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];
        const emojis = ['\u{1F9EE}', '\u{1F522}', '\u{2795}', '\u{1F4AF}', '\u{1F3AF}'];

        this.container.innerHTML = `
            <div class="question-display">
                <span class="question-emoji">${emojis[randInt(0, emojis.length - 1)]}</span>
                <div class="question-text">${q.question}</div>
            </div>
            <div class="answers-grid">
                ${q.options.map(opt =>
                    `<button class="answer-btn" data-answer="${opt}">${opt}</button>`
                ).join('')}
            </div>
        `;

        this.container.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn, parseInt(btn.dataset.answer)));
        });
    }

    checkAnswer(btn, selected) {
        const q = this.questions[this.current];
        const buttons = this.container.querySelectorAll('.answer-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === q.answer) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            buttons.forEach(b => {
                if (parseInt(b.dataset.answer) === q.answer) b.classList.add('correct');
            });
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1200);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('math', stars);

        const titles = ['Continue comme \u00E7a !', 'Bon travail !', 'Tr\u00E8s bien !', 'Parfait !'];
        App.showModal(
            titles[stars],
            `Tu as trouv\u00E9 ${this.score} bonnes r\u00E9ponses sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : EXPLORATEUR DE MOTS ====================
class WordExplorer {
    constructor(age, container, rng) {
        this.name = 'words';
        this.age = age;
        this.container = container;
        this._rng = rng;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = [];
        this.currentWord = [];
        this.generateQuestions();
        this.showQuestion();
    }

    _randInt(min, max) { return this._rng ? this._rng.randInt(min, max) : randInt(min, max); }
    _shuffle(arr) { return this._rng ? this._rng.shuffle(arr) : shuffle(arr); }

    getWordBank() {
        const simple = [
            { word: 'CHAT', emoji: '\u{1F431}' },
            { word: 'LUNE', emoji: '\u{1F319}' },
            { word: 'MAIN', emoji: '\u270B' },
            { word: 'VENT', emoji: '\u{1F32C}\uFE0F' },
            { word: 'NUIT', emoji: '\u{1F303}' },
            { word: 'PIED', emoji: '\u{1F9B6}' },
            { word: 'BRAS', emoji: '\u{1F4AA}' },
            { word: 'ROBE', emoji: '\u{1F457}' },
            { word: 'DENT', emoji: '\u{1F9B7}' },
            { word: 'FOUR', emoji: '\u{1F525}' },
            { word: 'PONT', emoji: '\u{1F309}' },
            { word: 'GANT', emoji: '\u{1F9E4}' },
            { word: 'JOUR', emoji: '\u2600\uFE0F' },
            { word: 'PAIN', emoji: '\u{1F956}' },
            { word: 'LAIT', emoji: '\u{1F95B}' },
            { word: 'ROSE', emoji: '\u{1F339}' },
            { word: 'BAIN', emoji: '\u{1F6C1}' },
            { word: 'OURS', emoji: '\u{1F43B}' },
            { word: 'LION', emoji: '\u{1F981}' },
            { word: 'CERF', emoji: '\u{1F98C}' },
            { word: 'LOUP', emoji: '\u{1F43A}' },
            { word: 'CAKE', emoji: '\u{1F370}' },
            { word: 'MIEL', emoji: '\u{1F36F}' },
            { word: 'PEUR', emoji: '\u{1F628}' },
            { word: 'RIRE', emoji: '\u{1F602}' },
            { word: 'NEUF', emoji: '\u{1F522}' },
            { word: 'BLEU', emoji: '\u{1F535}' },
            { word: 'MINE', emoji: '\u270F\uFE0F' },
            { word: 'BOIS', emoji: '\u{1FAB5}' },
            { word: 'TOIT', emoji: '\u{1F3E0}' },
            { word: 'PEAU', emoji: '\u270B' },
            { word: 'DOUX', emoji: '\u{1F9F8}' },
            { word: 'TIGE', emoji: '\u{1F33F}' },
            { word: 'NOIX', emoji: '\u{1F95C}' },
            { word: 'ROUX', emoji: '\u{1F98A}' }
        ];

        const medium = [
            { word: 'FLEUR', emoji: '\u{1F33A}' },
            { word: 'ARBRE', emoji: '\u{1F333}' },
            { word: 'LIVRE', emoji: '\u{1F4D6}' },
            { word: 'NUAGE', emoji: '\u2601\uFE0F' },
            { word: 'CHIEN', emoji: '\u{1F436}' },
            { word: 'TRAIN', emoji: '\u{1F682}' },
            { word: 'LAPIN', emoji: '\u{1F430}' },
            { word: 'TIGRE', emoji: '\u{1F42F}' },
            { word: 'PLAGE', emoji: '\u{1F3D6}\uFE0F' },
            { word: 'POULE', emoji: '\u{1F414}' },
            { word: 'TERRE', emoji: '\u{1F30D}' },
            { word: 'LAMPE', emoji: '\u{1F4A1}' },
            { word: 'POMME', emoji: '\u{1F34E}' },
            { word: 'PIANO', emoji: '\u{1F3B9}' },
            { word: 'GLACE', emoji: '\u{1F368}' },
            { word: 'FUSEE', emoji: '\u{1F680}' },
            { word: 'HERBE', emoji: '\u{1F33F}' },
            { word: 'AVION', emoji: '\u2708\uFE0F' },
            { word: 'ROUE', emoji: '\u{1F6DE}' },
            { word: 'COEUR', emoji: '\u2764\uFE0F' },
            { word: 'TABLE', emoji: '\u{1F4DD}' },
            { word: 'SOUCI', emoji: '\u{1F33B}' },
            { word: 'FRERE', emoji: '\u{1F466}' },
            { word: 'CYGNE', emoji: '\u{1F9A2}' },
            { word: 'PERLE', emoji: '\u{1F90D}' },
            { word: 'NEIGE', emoji: '\u2744\uFE0F' },
            { word: 'BAGUE', emoji: '\u{1F48D}' },
            { word: 'DANSE', emoji: '\u{1F483}' },
            { word: 'PLUME', emoji: '\u{1FAB6}' },
            { word: 'CORDE', emoji: '\u{1FA22}' },
            { word: 'RUCHE', emoji: '\u{1F41D}' },
            { word: 'POIRE', emoji: '\u{1F350}' },
            { word: 'MOUCHE', emoji: '\u{1FAB0}' },
            { word: 'SINGE', emoji: '\u{1F435}' },
            { word: 'FRAISE', emoji: '\u{1F353}' }
        ];

        const hard = [
            { word: 'MAISON', emoji: '\u{1F3E0}' },
            { word: 'BATEAU', emoji: '\u26F5' },
            { word: 'ANIMAL', emoji: '\u{1F43E}' },
            { word: 'JARDIN', emoji: '\u{1F33B}' },
            { word: 'CAMION', emoji: '\u{1F69B}' },
            { word: 'BALLON', emoji: '\u{1F388}' },
            { word: 'CHEVAL', emoji: '\u{1F434}' },
            { word: 'DRAGON', emoji: '\u{1F409}' },
            { word: 'OISEAU', emoji: '\u{1F426}' },
            { word: 'SOLEIL', emoji: '\u2600\uFE0F' },
            { word: 'RENARD', emoji: '\u{1F98A}' },
            { word: 'MONTRE', emoji: '\u231A' },
            { word: 'ORANGE', emoji: '\u{1F34A}' },
            { word: 'NUAGES', emoji: '\u{1F325}\uFE0F' },
            { word: 'PAPIER', emoji: '\u{1F4C4}' },
            { word: 'PIRATE', emoji: '\u{1F3F4}\u200D\u2620\uFE0F' },
            { word: 'REQUIN', emoji: '\u{1F988}' },
            { word: 'TORTUE', emoji: '\u{1F422}' },
            { word: 'CIRQUE', emoji: '\u{1F3AA}' },
            { word: 'VIOLET', emoji: '\u{1F49C}' },
            { word: 'FEUTRE', emoji: '\u{1F58D}\uFE0F' },
            { word: 'LOUTRE', emoji: '\u{1F9A6}' },
            { word: 'CASQUE', emoji: '\u{1FA96}' },
            { word: 'PLANTE', emoji: '\u{1FAB4}' },
            { word: 'BANANE', emoji: '\u{1F34C}' },
            { word: 'MOUTON', emoji: '\u{1F411}' },
            { word: 'GIRAFE', emoji: '\u{1F992}' },
            { word: 'CRABE', emoji: '\u{1F980}' },
            { word: 'TEMPETE', emoji: '\u26C8\uFE0F' },
            { word: 'FOURMI', emoji: '\u{1F41C}' },
            { word: 'LICORNE', emoji: '\u{1F984}' },
            { word: 'MUSIQUE', emoji: '\u{1F3B5}' },
            { word: 'FOUDRE', emoji: '\u26A1' },
            { word: 'HIBOU', emoji: '\u{1F989}' },
            { word: 'TIGRES', emoji: '\u{1F405}' }
        ];
        if (this.age <= 6) return simple;
        if (this.age <= 8) return medium;
        return hard;
    }

    generateQuestions() {
        const bank = this._shuffle(this.getWordBank());
        this.questions = [];
        for (let i = 0; i < this.total; i++) {
            const entry = bank[i % bank.length];
            this.questions.push(this.createQuestion(entry));
        }
    }

    createQuestion(entry) {
        if (this.age <= 6) {
            const correct = entry.word[0];
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const wrongs = [];
            while (wrongs.length < 3) {
                const l = letters[this._randInt(0, 25)];
                if (l !== correct && !wrongs.includes(l)) wrongs.push(l);
            }
            return {
                type: 'startLetter',
                word: entry.word,
                emoji: entry.emoji,
                answer: correct,
                options: this._shuffle([correct, ...wrongs])
            };
        } else if (this.age <= 8) {
            const pos = this._randInt(0, entry.word.length - 1);
            const missing = entry.word[pos];
            const display = entry.word.split('').map((c, i) => i === pos ? '_' : c).join(' ');
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const wrongs = [];
            while (wrongs.length < 3) {
                const l = letters[this._randInt(0, 25)];
                if (l !== missing && !wrongs.includes(l)) wrongs.push(l);
            }
            return {
                type: 'fillLetter',
                word: entry.word,
                emoji: entry.emoji,
                display,
                answer: missing,
                position: pos,
                options: this._shuffle([missing, ...wrongs])
            };
        } else {
            let scrambled = this._shuffle(entry.word.split('')).join('');
            let attempts = 0;
            while (scrambled === entry.word && attempts < 10) {
                scrambled = this._shuffle(entry.word.split('')).join('');
                attempts++;
            }
            return {
                type: 'unscramble',
                word: entry.word,
                emoji: entry.emoji,
                scrambled,
                answer: entry.word
            };
        }
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        if (q.type === 'startLetter') {
            this.container.innerHTML = `
                <div class="question-display">
                    <span class="question-emoji">${q.emoji}</span>
                    <div class="question-text">Par quelle lettre commence <strong>${q.word}</strong> ?</div>
                </div>
                <div class="answers-grid">
                    ${q.options.map(opt =>
                        `<button class="answer-btn" data-answer="${opt}">${opt}</button>`
                    ).join('')}
                </div>
            `;
            this.container.querySelectorAll('.answer-btn').forEach(btn => {
                btn.addEventListener('click', () => this.checkAnswer(btn, btn.dataset.answer, q.answer));
            });
        } else if (q.type === 'fillLetter') {
            this.container.innerHTML = `
                <div class="question-display">
                    <span class="question-emoji">${q.emoji}</span>
                    <div class="question-text">${q.display}</div>
                    <p class="word-hint">Trouve la lettre manquante !</p>
                </div>
                <div class="answers-grid">
                    ${q.options.map(opt =>
                        `<button class="answer-btn" data-answer="${opt}">${opt}</button>`
                    ).join('')}
                </div>
            `;
            this.container.querySelectorAll('.answer-btn').forEach(btn => {
                btn.addEventListener('click', () => this.checkAnswer(btn, btn.dataset.answer, q.answer));
            });
        } else {
            this.currentWord = [];
            this.container.innerHTML = `
                <div class="question-display">
                    <span class="question-emoji">${q.emoji}</span>
                    <div class="question-text">Remets les lettres en ordre !</div>
                </div>
                <div class="letter-tiles mb-20" id="word-slots">
                    ${q.word.split('').map((_, i) =>
                        `<div class="letter-tile slot" data-index="${i}"></div>`
                    ).join('')}
                </div>
                <div class="letter-tiles" id="letter-choices">
                    ${q.scrambled.split('').map((l, i) =>
                        `<div class="letter-tile choice" data-letter="${l}" data-idx="${i}">${l}</div>`
                    ).join('')}
                </div>
                <div class="text-center mb-20">
                    <button class="btn-secondary" id="clear-word" style="color: white; margin-top: 15px;">Effacer</button>
                </div>
            `;

            this.bindUnscrambleEvents(q);
        }
    }

    bindUnscrambleEvents(q) {
        const choices = this.container.querySelectorAll('.letter-tile.choice');
        const slots = this.container.querySelectorAll('.letter-tile.slot');

        choices.forEach(tile => {
            tile.addEventListener('click', () => {
                if (tile.classList.contains('disabled')) return;
                Sound.play('click');

                this.currentWord.push({
                    letter: tile.dataset.letter,
                    idx: parseInt(tile.dataset.idx)
                });
                tile.classList.add('disabled');

                const slotIdx = this.currentWord.length - 1;
                if (slotIdx < slots.length) {
                    slots[slotIdx].textContent = tile.dataset.letter;
                    slots[slotIdx].classList.add('filled');
                }

                if (this.currentWord.length === q.word.length) {
                    const attempt = this.currentWord.map(w => w.letter).join('');
                    setTimeout(() => {
                        if (attempt === q.answer) {
                            this.score++;
                            Sound.play('correct');
                            App.showFeedback(true);
                        } else {
                            Sound.play('wrong');
                            App.showFeedback(false);
                        }
                        this.current++;
                        setTimeout(() => this.showQuestion(), 1000);
                    }, 300);
                }
            });
        });

        document.getElementById('clear-word').addEventListener('click', () => {
            Sound.play('click');
            this.currentWord = [];
            slots.forEach(s => { s.textContent = ''; s.classList.remove('filled'); });
            choices.forEach(c => c.classList.remove('disabled'));
        });
    }

    checkAnswer(btn, selected, correct) {
        const buttons = this.container.querySelectorAll('.answer-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === correct) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            buttons.forEach(b => {
                if (b.dataset.answer === correct) b.classList.add('correct');
            });
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1200);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('words', stars);
        App.showModal(
            stars >= 2 ? 'Champion des mots !' : stars >= 1 ? 'Bien jou\u00E9 !' : 'Continue \u00E0 t\'entra\u00EEner !',
            `Tu as trouv\u00E9 ${this.score} bonnes r\u00E9ponses sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : MÉMOIRE ====================
class MemoryMatch {
    constructor(age, container, rng) {
        this.name = 'memory';
        this.age = age;
        this.container = container;
        this._rng = rng;
        this.moves = 0;
        this.matches = 0;
        this.flippedCards = [];
        this.isChecking = false;
        this.startTime = Date.now();

        if (age <= 6) {
            this.pairs = 6;
            this.gridClass = 'grid-3x4';
        } else if (age <= 8) {
            this.pairs = 8;
            this.gridClass = 'grid-4x4';
        } else {
            this.pairs = 10;
            this.gridClass = 'grid-4x5';
        }

        const _shuffle = rng ? (a) => rng.shuffle(a) : shuffle;

        this.emojis = _shuffle([
            '\u{1F436}', '\u{1F431}', '\u{1F438}', '\u{1F981}', '\u{1F42F}', '\u{1F428}',
            '\u{1F43C}', '\u{1F42E}', '\u{1F437}', '\u{1F435}', '\u{1F98A}', '\u{1F430}',
            '\u{1F43B}', '\u{1F414}', '\u{1F427}', '\u{1F422}', '\u{1F98B}', '\u{1F41D}'
        ]).slice(0, this.pairs);

        this.cards = _shuffle([...this.emojis, ...this.emojis]);
        this.render();
    }

    render() {
        App.updateGameProgress(this.matches, this.pairs);
        App.updateGameScore(this.matches);
        document.getElementById('game-question-total').textContent = this.pairs;

        this.container.innerHTML = `
            <div class="memory-stats">
                <div class="memory-stat">Coups : <span id="move-count">${this.moves}</span></div>
                <div class="memory-stat">Paires : <span id="match-count">${this.matches}</span>/${this.pairs}</div>
            </div>
            <div class="memory-grid ${this.gridClass}" id="memory-grid">
                ${this.cards.map((emoji, i) => `
                    <div class="memory-card" data-index="${i}" data-emoji="${emoji}">
                        <div class="memory-card-inner">
                            <div class="memory-card-face memory-card-back">?</div>
                            <div class="memory-card-face memory-card-front">${emoji}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        this.container.querySelectorAll('.memory-card').forEach(card => {
            card.addEventListener('click', () => this.flipCard(card));
        });
    }

    flipCard(card) {
        if (this.isChecking) return;
        if (card.classList.contains('flipped') || card.classList.contains('matched')) return;
        if (this.flippedCards.length >= 2) return;

        Sound.play('flip');
        card.classList.add('flipped');
        this.flippedCards.push(card);

        if (this.flippedCards.length === 2) {
            this.moves++;
            document.getElementById('move-count').textContent = this.moves;
            this.checkMatch();
        }
    }

    checkMatch() {
        this.isChecking = true;
        const [card1, card2] = this.flippedCards;
        const match = card1.dataset.emoji === card2.dataset.emoji;

        setTimeout(() => {
            if (match) {
                card1.classList.add('matched');
                card2.classList.add('matched');
                this.matches++;
                Sound.play('match');
                document.getElementById('match-count').textContent = this.matches;
                App.updateGameProgress(this.matches, this.pairs);
                App.updateGameScore(this.matches);

                if (this.matches === this.pairs) {
                    setTimeout(() => this.endGame(), 500);
                }
            } else {
                card1.classList.remove('flipped');
                card2.classList.remove('flipped');
                Sound.play('wrong');
            }

            this.flippedCards = [];
            this.isChecking = false;
        }, match ? 500 : 1000);
    }

    endGame() {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        const perfectMoves = this.pairs;
        const ratio = perfectMoves / this.moves;

        let stars;
        if (ratio >= 0.7) stars = 3;
        else if (ratio >= 0.45) stars = 2;
        else if (ratio >= 0.25) stars = 1;
        else stars = 0;

        App.addStars('memory', stars);
        App.showModal(
            stars >= 2 ? 'M\u00E9moire en or !' : stars >= 1 ? 'Bonne m\u00E9moire !' : 'Continue \u00E0 t\'entra\u00EEner !',
            `Tu as trouv\u00E9 toutes les paires en ${this.moves} coups !`,
            `Temps : ${elapsed} secondes | ${stars} \u00E9toile${stars !== 1 ? 's' : ''} gagn\u00E9e${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : DÉTECTIVE DE MOTIFS ====================
class PatternDetective {
    constructor(age, container, rng) {
        this.name = 'pattern';
        this.age = age;
        this.container = container;
        this._rng = rng;
        this.score = 0;
        this.current = 0;
        this.total = 8;
        this.questions = [];
        this.generateQuestions();
        this.showQuestion();
    }

    _randInt(min, max) { return this._rng ? this._rng.randInt(min, max) : randInt(min, max); }
    _shuffle(arr) { return this._rng ? this._rng.shuffle(arr) : shuffle(arr); }
    _random() { return this._rng ? this._rng.next() : Math.random(); }

    generateQuestions() {
        this.questions = [];
        for (let i = 0; i < this.total; i++) {
            this.questions.push(this.createQuestion());
        }
    }

    createQuestion() {
        if (this.age <= 6) {
            return this.createSimplePattern();
        } else if (this.age <= 8) {
            return this._random() > 0.4 ? this.createMediumPattern() : this.createSimplePattern();
        } else {
            return this._random() > 0.3 ? this.createHardPattern() : this.createMediumPattern();
        }
    }

    createSimplePattern() {
        const patterns = [
            { items: ['\u{1F534}', '\u{1F535}', '\u{1F534}', '\u{1F535}', '\u{1F534}'], answer: '\u{1F535}' },
            { items: ['\u2B50', '\u{1F319}', '\u2B50', '\u{1F319}', '\u2B50'], answer: '\u{1F319}' },
            { items: ['\u{1F34E}', '\u{1F34A}', '\u{1F34E}', '\u{1F34A}', '\u{1F34E}'], answer: '\u{1F34A}' },
            { items: ['\u2764\uFE0F', '\u{1F499}', '\u2764\uFE0F', '\u{1F499}', '\u2764\uFE0F'], answer: '\u{1F499}' },
            { items: ['\u{1F534}', '\u{1F7E2}', '\u{1F535}', '\u{1F534}', '\u{1F7E2}'], answer: '\u{1F535}' },
            { items: ['\u2B50', '\u{1F319}', '\u2600\uFE0F', '\u2B50', '\u{1F319}'], answer: '\u2600\uFE0F' },
            { items: ['\u{1F431}', '\u{1F436}', '\u{1F438}', '\u{1F431}', '\u{1F436}'], answer: '\u{1F438}' },
            { items: ['1', '2', '3', '4', '5'], answer: '6' },
            { items: ['A', 'B', 'C', 'D', 'E'], answer: 'F' }
        ];

        const p = patterns[randInt(0, patterns.length - 1)];
        const wrongPool = ['\u{1F534}', '\u{1F535}', '\u{1F7E2}', '\u{1F7E1}', '\u2B50', '\u{1F319}', '\u{1F431}', '\u{1F438}',
            '1', '2', '3', '4', '5', '6', '7', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
        const wrongs = [];
        while (wrongs.length < 3) {
            const w = wrongPool[randInt(0, wrongPool.length - 1)];
            if (w !== p.answer && !wrongs.includes(w)) wrongs.push(w);
        }

        return { sequence: p.items, answer: p.answer, options: shuffle([p.answer, ...wrongs]) };
    }

    createMediumPattern() {
        const type = randInt(0, 3);
        let sequence, answer;

        switch (type) {
            case 0: {
                const start = randInt(1, 5);
                const step = randInt(2, 4);
                sequence = [];
                for (let i = 0; i < 5; i++) sequence.push(String(start + step * i));
                answer = String(start + step * 5);
                break;
            }
            case 1: {
                const s = randInt(1, 3);
                sequence = [];
                let val = s;
                for (let i = 0; i < 5; i++) { sequence.push(String(val)); val *= 2; }
                answer = String(val);
                break;
            }
            case 2: {
                const big = randInt(30, 50);
                const sub = randInt(3, 6);
                sequence = [];
                for (let i = 0; i < 5; i++) sequence.push(String(big - sub * i));
                answer = String(big - sub * 5);
                break;
            }
            default: {
                const shapes = shuffle(['\u25B2', '\u25CF', '\u25A0', '\u2B22', '\u25C6']);
                const cycle = shapes.slice(0, 3);
                sequence = [];
                for (let i = 0; i < 5; i++) sequence.push(cycle[i % 3]);
                answer = cycle[5 % 3];
            }
        }

        const wrongs = [];
        while (wrongs.length < 3) {
            let w;
            if (isNaN(answer)) {
                const pool = ['\u25B2', '\u25CF', '\u25A0', '\u2B22', '\u25C6', '\u25CB', '\u25BD'];
                w = pool[randInt(0, pool.length - 1)];
            } else {
                w = String(parseInt(answer) + randInt(-5, 5));
            }
            if (w !== answer && !wrongs.includes(w) && w !== '0') wrongs.push(w);
        }

        return { sequence, answer, options: shuffle([answer, ...wrongs]) };
    }

    createHardPattern() {
        const type = randInt(0, 3);
        let sequence, answer;

        switch (type) {
            case 0: {
                const a = randInt(1, 3);
                const b = randInt(1, 4);
                sequence = [a, b];
                for (let i = 2; i < 5; i++) sequence.push(sequence[i - 1] + sequence[i - 2]);
                answer = sequence[3] + sequence[4];
                sequence = sequence.map(String);
                answer = String(answer);
                break;
            }
            case 1: {
                const base = randInt(1, 2);
                sequence = [];
                for (let i = base; i < base + 5; i++) sequence.push(String(i * i));
                answer = String((base + 5) * (base + 5));
                break;
            }
            case 2: {
                const s = randInt(1, 3);
                const mult = randInt(2, 3);
                const add = randInt(1, 2);
                sequence = [s];
                for (let i = 1; i < 5; i++) sequence.push(sequence[i - 1] * mult + add);
                answer = sequence[4] * mult + add;
                sequence = sequence.map(String);
                answer = String(answer);
                break;
            }
            default: {
                const s = randInt(2, 5);
                sequence = [s];
                for (let i = 1; i < 5; i++) {
                    sequence.push(i % 2 === 1 ? sequence[i - 1] * 2 : sequence[i - 1] + 3);
                }
                answer = 5 % 2 === 1 ? sequence[4] * 2 : sequence[4] + 3;
                sequence = sequence.map(String);
                answer = String(answer);
            }
        }

        const wrongs = [];
        const numAnswer = parseInt(answer);
        while (wrongs.length < 3) {
            const w = String(numAnswer + randInt(-8, 8));
            if (w !== answer && !wrongs.includes(w) && parseInt(w) > 0) wrongs.push(w);
        }

        return { sequence, answer, options: shuffle([answer, ...wrongs]) };
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        this.container.innerHTML = `
            <div class="question-display">
                <div class="question-text mb-10">Que vient-il ensuite ?</div>
            </div>
            <div class="pattern-sequence mb-30">
                ${q.sequence.map(item =>
                    `<div class="pattern-item">${item}</div><span class="pattern-arrow">\u279C</span>`
                ).join('')}
                <div class="pattern-item mystery">?</div>
            </div>
            <div class="answers-grid">
                ${q.options.map(opt =>
                    `<button class="answer-btn" data-answer="${opt}">${opt}</button>`
                ).join('')}
            </div>
        `;

        this.container.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn));
        });
    }

    checkAnswer(btn) {
        const q = this.questions[this.current];
        const selected = btn.dataset.answer;
        const buttons = this.container.querySelectorAll('.answer-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === q.answer) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            buttons.forEach(b => {
                if (b.dataset.answer === q.answer) b.classList.add('correct');
            });
        }

        const mystery = this.container.querySelector('.pattern-item.mystery');
        if (mystery) {
            mystery.textContent = q.answer;
            mystery.classList.remove('mystery');
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1500);
    }

    endGame() {
        const stars = this.score >= 7 ? 3 : this.score >= 5 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('pattern', stars);
        App.showModal(
            stars >= 2 ? 'Super d\u00E9tective !' : stars >= 1 ? 'Bien observ\u00E9 !' : 'Continue \u00E0 chercher !',
            `Tu as trouv\u00E9 ${this.score} motifs sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : DESSINE & COLORIE ====================
class ColorDraw {
    constructor(age, container) {
        this.name = 'draw';
        this.age = age;
        this.container = container;
        this.color = '#FF6B6B';
        this.brushSize = 8;
        this.isDrawing = false;
        this.isEraser = false;
        this.history = [];
        this.render();
    }

    render() {
        const colors = [
            '#FF6B6B', '#FF8A5C', '#FFE66D', '#51CF66', '#4ECDC4',
            '#339AF0', '#6C63FF', '#9775FA', '#FF6B9D', '#2d3436',
            '#FFFFFF', '#8B4513'
        ];

        this.container.innerHTML = `
            <div class="draw-container">
                <div class="draw-toolbar">
                    <div class="color-palette">
                        ${colors.map(c =>
                            `<div class="color-swatch ${c === this.color ? 'active' : ''}"
                                 data-color="${c}"
                                 style="background:${c};${c === '#FFFFFF' ? 'border: 2px solid #ccc;' : ''}"></div>`
                        ).join('')}
                    </div>
                    <div class="tool-divider"></div>
                    <div class="brush-sizes">
                        <div class="brush-size-btn size-sm" data-size="3"></div>
                        <div class="brush-size-btn size-md active" data-size="8"></div>
                        <div class="brush-size-btn size-lg" data-size="15"></div>
                    </div>
                    <div class="tool-divider"></div>
                    <button class="tool-btn" id="eraser-btn">Gomme</button>
                    <button class="tool-btn" id="undo-btn">Annuler</button>
                    <button class="tool-btn" id="clear-btn">Tout effacer</button>
                    <button class="tool-btn" id="save-btn">Sauvegarder</button>
                </div>
                <div class="canvas-wrapper">
                    <canvas id="draw-canvas" width="700" height="450"></canvas>
                </div>
                <div class="encouragement">Dessine tout ce que tu veux ! Utilise les couleurs et les pinceaux.</div>
            </div>
        `;

        this.canvas = document.getElementById('draw-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.saveState();

        this.bindDrawEvents();
    }

    bindDrawEvents() {
        const canvas = this.canvas;
        const rect = () => canvas.getBoundingClientRect();

        const getPos = (e) => {
            const r = rect();
            const scaleX = canvas.width / r.width;
            const scaleY = canvas.height / r.height;
            if (e.touches) {
                return {
                    x: (e.touches[0].clientX - r.left) * scaleX,
                    y: (e.touches[0].clientY - r.top) * scaleY
                };
            }
            return {
                x: (e.clientX - r.left) * scaleX,
                y: (e.clientY - r.top) * scaleY
            };
        };

        const startDraw = (e) => {
            e.preventDefault();
            this.isDrawing = true;
            const pos = getPos(e);
            this.ctx.beginPath();
            this.ctx.moveTo(pos.x, pos.y);
        };

        const draw = (e) => {
            if (!this.isDrawing) return;
            e.preventDefault();
            const pos = getPos(e);
            this.ctx.lineWidth = this.brushSize;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            if (this.isEraser) {
                this.ctx.globalCompositeOperation = 'destination-out';
                this.ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                this.ctx.globalCompositeOperation = 'source-over';
                this.ctx.strokeStyle = this.color;
            }

            this.ctx.lineTo(pos.x, pos.y);
            this.ctx.stroke();
        };

        const endDraw = () => {
            if (this.isDrawing) {
                this.isDrawing = false;
                this.ctx.globalCompositeOperation = 'source-over';
                this.saveState();
            }
        };

        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', endDraw);
        canvas.addEventListener('mouseleave', endDraw);

        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', endDraw);

        this.container.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                this.color = swatch.dataset.color;
                this.isEraser = false;
                document.getElementById('eraser-btn').classList.remove('eraser-active');
                this.container.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
                Sound.play('click');
            });
        });

        this.container.querySelectorAll('.brush-size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.brushSize = parseInt(btn.dataset.size);
                this.container.querySelectorAll('.brush-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                Sound.play('click');
            });
        });

        document.getElementById('eraser-btn').addEventListener('click', () => {
            this.isEraser = !this.isEraser;
            document.getElementById('eraser-btn').classList.toggle('eraser-active');
            Sound.play('click');
        });

        document.getElementById('undo-btn').addEventListener('click', () => {
            this.undo();
            Sound.play('click');
        });

        document.getElementById('clear-btn').addEventListener('click', () => {
            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.saveState();
            Sound.play('click');
        });

        document.getElementById('save-btn').addEventListener('click', () => {
            const link = document.createElement('a');
            link.download = 'mon-dessin.png';
            link.href = this.canvas.toDataURL();
            link.click();
            Sound.play('correct');
        });
    }

    saveState() {
        this.history.push(this.canvas.toDataURL());
        if (this.history.length > 30) this.history.shift();
    }

    undo() {
        if (this.history.length > 1) {
            this.history.pop();
            const img = new Image();
            img.onload = () => {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.drawImage(img, 0, 0);
            };
            img.src = this.history[this.history.length - 1];
        }
    }

    cleanup() {}
}


// ==================== JEU : QUIZ ====================
class QuizTime {
    constructor(age, container) {
        this.name = 'quiz';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = this.getQuestions();
        this.showQuestion();
    }

    getQuestions() {
        const q56 = [
            { q: 'Quel bruit fait la vache ?', options: ['Meuh', 'Ouaf', 'Miaou', 'Coin-coin'], answer: 0, emoji: '\u{1F42E}' },
            { q: 'Combien de pattes a un chat ?', options: ['2', '4', '6', '8'], answer: 1, emoji: '\u{1F431}' },
            { q: 'De quelle couleur est le ciel ?', options: ['Vert', 'Bleu', 'Rouge', 'Jaune'], answer: 1, emoji: '\u{1F324}\uFE0F' },
            { q: 'Quelle forme a 3 c\u00F4t\u00E9s ?', options: ['Carr\u00E9', 'Cercle', 'Triangle', '\u00C9toile'], answer: 2, emoji: '\u{1F4D0}' },
            { q: 'Quel animal dit "Coin-coin" ?', options: ['Chien', 'Chat', 'Canard', 'Cheval'], answer: 2, emoji: '\u{1F986}' },
            { q: 'Combien de doigts as-tu en tout ?', options: ['5', '8', '10', '12'], answer: 2, emoji: '\u270B' },
            { q: 'Quel fruit est jaune et courb\u00E9 ?', options: ['Pomme', 'Banane', 'Orange', 'Raisin'], answer: 1, emoji: '\u{1F34C}' },
            { q: 'En quelle saison tombe la neige ?', options: ['\u00C9t\u00E9', 'Printemps', 'Automne', 'Hiver'], answer: 3, emoji: '\u2744\uFE0F' },
            { q: 'Quel couleur obtient-on en m\u00E9langeant rouge et jaune ?', options: ['Bleu', 'Vert', 'Orange', 'Violet'], answer: 2, emoji: '\u{1F3A8}' },
            { q: 'Que fabriquent les abeilles ?', options: ['Du lait', 'Du miel', 'Du jus', "De l'eau"], answer: 1, emoji: '\u{1F41D}' },
            { q: 'Qui est plus gros : un \u00E9l\u00E9phant ou une souris ?', options: ['La souris', "L'\u00E9l\u00E9phant", 'Pareil', 'Le chat'], answer: 1, emoji: '\u{1F418}' },
            { q: 'Avec quoi mange-t-on de la soupe ?', options: ['Fourchette', 'Couteau', 'Cuill\u00E8re', 'Verre'], answer: 2, emoji: '\u{1F963}' },
            { q: 'Quel animal a une tr\u00E8s longue trompe ?', options: ['La girafe', "L'\u00E9l\u00E9phant", 'Le singe', 'Le lion'], answer: 1, emoji: '\u{1F418}' },
            { q: 'Combien de roues a un v\u00E9lo ?', options: ['1', '2', '3', '4'], answer: 1, emoji: '\u{1F6B2}' },
            { q: 'Quel animal vit dans une coquille ?', options: ['Le chat', "L'escargot", 'Le chien', 'Le lapin'], answer: 1, emoji: '\u{1F40C}' },
            { q: 'Quelle couleur obtient-on en m\u00E9langeant bleu et jaune ?', options: ['Rouge', 'Orange', 'Vert', 'Violet'], answer: 2, emoji: '\u{1F3A8}' },
            { q: 'Quel repas prend-on le matin ?', options: ['Le d\u00EEner', 'Le go\u00FBter', 'Le petit-d\u00E9jeuner', 'Le souper'], answer: 2, emoji: '\u{1F950}' },
            { q: 'Combien y a-t-il de saisons ?', options: ['2', '3', '4', '5'], answer: 2, emoji: '\u{1F342}' },
            { q: 'Quel animal fait "B\u00EA\u00EA" ?', options: ['La vache', 'Le mouton', 'Le cochon', 'Le coq'], answer: 1, emoji: '\u{1F411}' },
            { q: 'De quelle couleur est une fraise ?', options: ['Jaune', 'Bleue', 'Verte', 'Rouge'], answer: 3, emoji: '\u{1F353}' },
            { q: 'Quel animal a de longues oreilles et saute ?', options: ['Le chat', 'Le lapin', 'Le chien', 'La poule'], answer: 1, emoji: '\u{1F430}' },
            { q: 'O\u00F9 vivent les poissons ?', options: ['Dans les arbres', 'Dans le ciel', "Dans l'eau", 'Sous la terre'], answer: 2, emoji: '\u{1F41F}' },
            { q: 'Combien de pattes a une araign\u00E9e ?', options: ['4', '6', '8', '10'], answer: 2, emoji: '\u{1F577}\uFE0F' },
            { q: 'Quel animal est le roi de la jungle ?', options: ['Le tigre', "L'ours", 'Le lion', 'Le loup'], answer: 2, emoji: '\u{1F981}' },
            { q: 'Quelle est la couleur du soleil dans les dessins ?', options: ['Bleu', 'Vert', 'Rouge', 'Jaune'], answer: 3, emoji: '\u2600\uFE0F' },
            { q: 'Quel animal fait "Cocorico" ?', options: ['Le canard', 'La poule', 'Le coq', 'Le dindon'], answer: 2, emoji: '\u{1F413}' },
            { q: 'Avec quoi peut-on couper du papier ?', options: ['Un stylo', 'Des ciseaux', 'Une gomme', 'Un crayon'], answer: 1, emoji: '\u2702\uFE0F' },
            { q: 'Quel est le b\u00E9b\u00E9 du cheval ?', options: ['Le chiot', 'Le chaton', 'Le poulain', "L'agneau"], answer: 2, emoji: '\u{1F434}' },
            { q: 'Quelle forme a un ballon de foot ?', options: ['Carr\u00E9', 'Triangle', 'Ronde', 'Rectangle'], answer: 2, emoji: '\u26BD' },
            { q: 'Combien font 2 + 3 ?', options: ['4', '5', '6', '7'], answer: 1, emoji: '\u{1F522}' },
            { q: "Qu'est-ce qui tombe du ciel quand il pleut ?", options: ['Des feuilles', 'De la neige', "De l'eau", 'Du sable'], answer: 2, emoji: '\u{1F327}\uFE0F' },
            { q: "De quelle couleur est l'herbe ?", options: ['Rouge', 'Bleue', 'Jaune', 'Verte'], answer: 3, emoji: '\u{1F33F}' },
            { q: 'Quel animal produit du lait ?', options: ['Le chat', 'La vache', 'Le lapin', 'Le coq'], answer: 1, emoji: '\u{1F404}' },
            { q: 'Combien de c\u00F4t\u00E9s a un carr\u00E9 ?', options: ['3', '4', '5', '6'], answer: 1, emoji: '\u{1F7E6}' },
            { q: 'Quel animal a des rayures noires et blanches ?', options: ['Le lion', 'Le z\u00E8bre', "L'ours", 'Le singe'], answer: 1, emoji: '\u{1F993}' },
            { q: 'Que fait-on avec un lit ?', options: ['On mange', 'On dort', 'On joue', 'On court'], answer: 1, emoji: '\u{1F6CF}\uFE0F' },
            { q: 'Quel insecte fait de la lumi\u00E8re la nuit ?', options: ['La mouche', 'La luciole', 'Le papillon', 'La fourmi'], answer: 1, emoji: '\u{1FAB2}' },
            { q: 'Quel animal porte sa maison sur son dos ?', options: ['Le h\u00E9risson', 'La tortue', 'Le crabe', 'Le lapin'], answer: 1, emoji: '\u{1F422}' },
            { q: "Qu'utilise-t-on pour \u00E9crire sur du papier ?", options: ['Un marteau', 'Un crayon', 'Une assiette', 'Une chaussure'], answer: 1, emoji: '\u270F\uFE0F' },
            { q: 'Quel animal vole et fait du miel ?', options: ['La mouche', 'Le papillon', "L'abeille", 'La coccinelle'], answer: 2, emoji: '\u{1F41D}' }
        ];

        const q78 = [
            { q: 'Quelle plan\u00E8te est la plus proche du Soleil ?', options: ['Terre', 'V\u00E9nus', 'Mercure', 'Mars'], answer: 2, emoji: '\u{1FA90}' },
            { q: 'Combien de jours y a-t-il dans une semaine ?', options: ['5', '6', '7', '8'], answer: 2, emoji: '\u{1F4C5}' },
            { q: 'Quel est le plus grand oc\u00E9an ?', options: ['Atlantique', 'Indien', 'Arctique', 'Pacifique'], answer: 3, emoji: '\u{1F30A}' },
            { q: 'De quel gaz les plantes ont-elles besoin ?', options: ['Oxyg\u00E8ne', 'Dioxyde de carbone', 'Azote', 'H\u00E9lium'], answer: 1, emoji: '\u{1F331}' },
            { q: 'Quel continent a le plus de pays ?', options: ['Asie', 'Europe', 'Afrique', 'Am\u00E9riques'], answer: 2, emoji: '\u{1F30D}' },
            { q: 'Combien de c\u00F4t\u00E9s a un hexagone ?', options: ['4', '5', '6', '8'], answer: 2, emoji: '\u2B22' },
            { q: 'Quel est le mat\u00E9riau naturel le plus dur ?', options: ['Or', 'Fer', 'Diamant', 'Argent'], answer: 2, emoji: '\u{1F48E}' },
            { q: 'Quel animal terrestre est le plus rapide ?', options: ['Lion', 'Cheval', 'Gu\u00E9pard', 'Aigle'], answer: 2, emoji: '\u{1F406}' },
            { q: 'Quel organe pompe le sang dans ton corps ?', options: ['Cerveau', 'Poumons', 'C\u0153ur', 'Estomac'], answer: 2, emoji: '\u2764\uFE0F' },
            { q: 'Combien de mois ont 31 jours ?', options: ['5', '6', '7', '8'], answer: 2, emoji: '\u{1F4C6}' },
            { q: "Quelle est la temp\u00E9rature d'\u00E9bullition de l'eau ?", options: ['50\u00B0C', '100\u00B0C', '150\u00B0C', '200\u00B0C'], answer: 1, emoji: '\u{1F321}\uFE0F' },
            { q: 'Quel animal peut changer de couleur ?', options: ['Grenouille', 'Cam\u00E9l\u00E9on', 'Serpent', 'Perroquet'], answer: 1, emoji: '\u{1F98E}' },
            { q: 'Combien de plan\u00E8tes y a-t-il dans le syst\u00E8me solaire ?', options: ['6', '7', '8', '9'], answer: 2, emoji: '\u{1FA90}' },
            { q: 'Quel est le fleuve le plus long du monde ?', options: ['Le Nil', "L'Amazone", 'Le Mississippi', 'Le Yangts\u00E9'], answer: 1, emoji: '\u{1F3DE}\uFE0F' },
            { q: 'Quel animal est connu pour sa m\u00E9moire ?', options: ['Le poisson', "L'\u00E9l\u00E9phant", 'Le chat', 'Le hamster'], answer: 1, emoji: '\u{1F418}' },
            { q: 'Combien de dents a un adulte normalement ?', options: ['20', '28', '32', '36'], answer: 2, emoji: '\u{1F9B7}' },
            { q: 'Quelle est la plan\u00E8te rouge ?', options: ['V\u00E9nus', 'Mars', 'Jupiter', 'Saturne'], answer: 1, emoji: '\u{1F534}' },
            { q: 'Quel est le plus petit continent ?', options: ['Europe', 'Antarctique', 'Oc\u00E9anie', 'Afrique'], answer: 2, emoji: '\u{1F30F}' },
            { q: "De quelle couleur est une \u00E9meraude ?", options: ['Rouge', 'Bleue', 'Verte', 'Jaune'], answer: 2, emoji: '\u{1F49A}' },
            { q: 'Combien de pattes a un insecte ?', options: ['4', '6', '8', '10'], answer: 1, emoji: '\u{1F41C}' },
            { q: 'Quel est le plus grand animal du monde ?', options: ["L'\u00E9l\u00E9phant", 'La girafe', 'La baleine bleue', 'Le requin'], answer: 2, emoji: '\u{1F40B}' },
            { q: "Quel pays a la forme d'une botte ?", options: ['France', 'Espagne', 'Italie', 'Gr\u00E8ce'], answer: 2, emoji: '\u{1F1EE}\u{1F1F9}' },
            { q: 'Combien de couleurs y a-t-il dans un arc-en-ciel ?', options: ['5', '6', '7', '8'], answer: 2, emoji: '\u{1F308}' },
            { q: 'Quel os est le plus long du corps humain ?', options: ["L'hum\u00E9rus", 'Le tibia', 'Le f\u00E9mur', 'Le p\u00E9ron\u00E9'], answer: 2, emoji: '\u{1F9B4}' },
            { q: 'Quel est le m\u00E9tal le plus l\u00E9ger ?', options: ['Fer', 'Aluminium', 'Or', 'Lithium'], answer: 3, emoji: '\u2697\uFE0F' },
            { q: "Quel animal est le symbole de l'Australie ?", options: ['Le koala', 'Le kangourou', "L'\u00E9meu", 'Le wombat'], answer: 1, emoji: '\u{1F998}' },
            { q: "Combien de litres de sang a un adulte environ ?", options: ['2 litres', '5 litres', '8 litres', '10 litres'], answer: 1, emoji: '\u{1FA78}' },
            { q: "Quelle est la capitale de l'Espagne ?", options: ['Barcelone', 'Madrid', 'S\u00E9ville', 'Valence'], answer: 1, emoji: '\u{1F1EA}\u{1F1F8}' },
            { q: 'Quel est le plus gros organe du corps humain ?', options: ['Le foie', 'Le cerveau', 'La peau', 'Les poumons'], answer: 2, emoji: '\u{1F9EC}' },
            { q: 'De quoi est principalement compos\u00E9 le Soleil ?', options: ['De roche', 'De fer', "D'hydrog\u00E8ne", "D'oxyg\u00E8ne"], answer: 2, emoji: '\u2600\uFE0F' },
            { q: 'Quel est le mammif\u00E8re le plus petit du monde ?', options: ['La souris', 'Le hamster', 'La musaraigne \u00E9trusque', 'Le rat'], answer: 2, emoji: '\u{1F42D}' },
            { q: "Combien d'heures y a-t-il dans une journ\u00E9e ?", options: ['12', '20', '24', '30'], answer: 2, emoji: '\u{1F550}' },
            { q: 'Quel animal dort debout ?', options: ['La vache', 'Le cheval', 'Le chat', 'Le chien'], answer: 1, emoji: '\u{1F40E}' },
            { q: 'Quel sens utilise-t-on pour \u00E9couter ?', options: ['La vue', "L'ou\u00EFe", 'Le go\u00FBt', 'Le toucher'], answer: 1, emoji: '\u{1F442}' },
            { q: "Combien de semaines y a-t-il dans une ann\u00E9e ?", options: ['48', '50', '52', '54'], answer: 2, emoji: '\u{1F4C5}' },
            { q: 'Quel gaz respirons-nous ?', options: ['Azote', 'Oxyg\u00E8ne', 'Hydrog\u00E8ne', 'H\u00E9lium'], answer: 1, emoji: '\u{1F4A8}' },
            { q: 'Quel instrument de musique a 6 cordes ?', options: ['Violon', 'Guitare', 'Harpe', 'Piano'], answer: 1, emoji: '\u{1F3B8}' },
            { q: 'Quelle plan\u00E8te a des anneaux visibles ?', options: ['Jupiter', 'Mars', 'Saturne', 'Neptune'], answer: 2, emoji: '\u{1FA90}' },
            { q: 'De quel pays vient le sushi ?', options: ['Chine', 'Cor\u00E9e', 'Tha\u00EFlande', 'Japon'], answer: 3, emoji: '\u{1F363}' },
            { q: "Combien de vert\u00E8bres a un \u00EAtre humain ?", options: ['24', '33', '40', '50'], answer: 1, emoji: '\u{1F9B4}' },
            { q: 'Quel est le plus long animal du monde ?', options: ['La baleine bleue', 'Le python r\u00E9ticul\u00E9', 'La m\u00E9duse \u00E0 crini\u00E8re de lion', 'Le requin-baleine'], answer: 2, emoji: '\u{1F40D}' },
            { q: 'Quelle est la capitale de la Gr\u00E8ce ?', options: ['Istanbul', 'Ath\u00E8nes', 'Rome', 'Sofia'], answer: 1, emoji: '\u{1F1EC}\u{1F1F7}' },
            { q: 'Combien de faces a un d\u00E9 classique ?', options: ['4', '6', '8', '12'], answer: 1, emoji: '\u{1F3B2}' },
            { q: 'Quel m\u00E9tal est attir\u00E9 par un aimant ?', options: ['Aluminium', 'Cuivre', 'Fer', 'Or'], answer: 2, emoji: '\u{1F9F2}' },
            { q: "Quel est l'animal le plus haut du monde ?", options: ['L\'\u00E9l\u00E9phant', 'La girafe', 'Le chameau', 'L\'autruche'], answer: 1, emoji: '\u{1F992}' },
            { q: 'Combien de minutes y a-t-il dans une heure ?', options: ['30', '45', '60', '100'], answer: 2, emoji: '\u{1F552}' },
            { q: 'Quel organe filtre le sang dans le corps ?', options: ['Le foie', 'Les reins', 'Le c\u0153ur', 'Les poumons'], answer: 1, emoji: '\u{1F9EC}' },
            { q: "Quelle mer borde le sud de la France ?", options: ['Mer du Nord', 'Oc\u00E9an Atlantique', 'Mer M\u00E9diterran\u00E9e', 'Manche'], answer: 2, emoji: '\u{1F30A}' },
            { q: 'Quel est le plus petit pays du monde ?', options: ['Monaco', 'Vatican', 'Malte', 'San Marin'], answer: 1, emoji: '\u{1F3F0}' }
        ];

        const q910 = [
            { q: "Quel est le symbole chimique de l'eau ?", options: ['O2', 'H2O', 'CO2', 'NaCl'], answer: 1, emoji: '\u{1F4A7}' },
            { q: 'Qui a peint la Joconde ?', options: ['Picasso', 'De Vinci', 'Van Gogh', 'Monet'], answer: 1, emoji: '\u{1F5BC}\uFE0F' },
            { q: 'Quelle est la capitale du Japon ?', options: ['S\u00E9oul', 'P\u00E9kin', 'Tokyo', 'Bangkok'], answer: 2, emoji: '\u{1F5FC}' },
            { q: "Combien d'os y a-t-il dans le corps humain ?", options: ['106', '206', '306', '406'], answer: 1, emoji: '\u{1F9B4}' },
            { q: 'Quelle est la plus grande plan\u00E8te du syst\u00E8me solaire ?', options: ['Saturne', 'Jupiter', 'Neptune', 'Uranus'], answer: 1, emoji: '\u{1FA90}' },
            { q: 'Quelle force nous maintient au sol ?', options: ['Magn\u00E9tisme', 'Friction', 'Gravit\u00E9', 'Vent'], answer: 2, emoji: '\u{1F30D}' },
            { q: 'Combien font 15% de 200 ?', options: ['15', '20', '25', '30'], answer: 3, emoji: '\u{1F4CA}' },
            { q: 'Quel instrument a 88 touches ?', options: ['Guitare', 'Violon', 'Piano', 'Batterie'], answer: 2, emoji: '\u{1F3B9}' },
            { q: 'Quelle est la vitesse de la lumi\u00E8re ?', options: ['300 km/s', '3 000 km/s', '300 000 km/s', '3 000 000 km/s'], answer: 2, emoji: '\u26A1' },
            { q: "Quel pourcentage de la Terre est couvert d'eau ?", options: ['50%', '61%', '71%', '81%'], answer: 2, emoji: '\u{1F30A}' },
            { q: 'Quel est le plus petit nombre premier ?', options: ['0', '1', '2', '3'], answer: 2, emoji: '\u{1F522}' },
            { q: "Quel gaz compose la majorit\u00E9 de l'atmosph\u00E8re ?", options: ['Oxyg\u00E8ne', 'Azote', 'Dioxyde de carbone', 'Hydrog\u00E8ne'], answer: 1, emoji: '\u{1F32C}\uFE0F' },
            { q: "Quelle est la capitale de l'Australie ?", options: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'], answer: 2, emoji: '\u{1F1E6}\u{1F1FA}' },
            { q: "Combien de chromosomes a un \u00EAtre humain ?", options: ['23', '44', '46', '48'], answer: 2, emoji: '\u{1F9EC}' },
            { q: "Quel est le plus long fleuve d'Europe ?", options: ['Le Danube', 'Le Rhin', 'La Volga', 'La Seine'], answer: 2, emoji: '\u{1F3DE}\uFE0F' },
            { q: 'Qui a formul\u00E9 la th\u00E9orie de la relativit\u00E9 ?', options: ['Newton', 'Einstein', 'Galil\u00E9e', 'Hawking'], answer: 1, emoji: '\u{1F9EA}' },
            { q: 'Quel est le symbole chimique du fer ?', options: ['Fr', 'Fi', 'Fe', 'Fa'], answer: 2, emoji: '\u2699\uFE0F' },
            { q: 'Quel est le plus grand d\u00E9sert du monde ?', options: ['Le Sahara', 'Le Gobi', "L'Antarctique", "L'Arabie"], answer: 2, emoji: '\u{1F3D4}\uFE0F' },
            { q: 'Combien de faces a un cube ?', options: ['4', '6', '8', '12'], answer: 1, emoji: '\u{1F3B2}' },
            { q: 'Quelle est la monnaie du Japon ?', options: ['Le yuan', 'Le won', 'Le yen', 'Le baht'], answer: 2, emoji: '\u{1F4B4}' },
            { q: "Quel est l'organe le plus lourd du corps ?", options: ['Le cerveau', 'Le foie', 'La peau', 'Les poumons'], answer: 1, emoji: '\u{1FAC1}' },
            { q: "Quel est le point le plus profond de l'oc\u00E9an ?", options: ['Fosse de Porto Rico', 'Fosse des Mariannes', 'Fosse de Java', 'Fosse des Tonga'], answer: 1, emoji: '\u{1F30A}' },
            { q: "De combien d'atomes est compos\u00E9e une mol\u00E9cule d'eau ?", options: ['2', '3', '4', '5'], answer: 1, emoji: '\u{1F4A7}' },
            { q: 'Quel pays a la plus grande population ?', options: ['USA', 'Inde', 'Chine', 'Br\u00E9sil'], answer: 1, emoji: '\u{1F30F}' },
            { q: 'Quelle est la formule de la force ?', options: ['F = m \u00D7 a', 'F = m + a', 'F = m / a', 'F = m \u2212 a'], answer: 0, emoji: '\u2696\uFE0F' },
            { q: 'Combien de sommets a un triangle ?', options: ['2', '3', '4', '5'], answer: 1, emoji: '\u{1F4D0}' },
            { q: 'Quel animal peut r\u00E9g\u00E9n\u00E9rer ses membres ?', options: ['Le l\u00E9zard', "L'\u00E9toile de mer", 'Le serpent', 'La grenouille'], answer: 1, emoji: '\u2B50' },
            { q: "Quel est le m\u00E9tal le plus conducteur d'\u00E9lectricit\u00E9 ?", options: ['Or', 'Cuivre', 'Argent', 'Aluminium'], answer: 2, emoji: '\u26A1' },
            { q: "Quelle est la capitale de l'\u00C9gypte ?", options: ['Alexandrie', 'Le Caire', 'Louxor', 'Assouan'], answer: 1, emoji: '\u{1F3DB}\uFE0F' },
            { q: 'Combien font 3 puissance 4 ?', options: ['12', '64', '81', '27'], answer: 2, emoji: '\u{1F522}' },
            { q: 'Quel est le gaz n\u00E9cessaire \u00E0 la combustion ?', options: ['Azote', 'Hydrog\u00E8ne', 'Oxyg\u00E8ne', 'H\u00E9lium'], answer: 2, emoji: '\u{1F525}' },
            { q: 'Quelle plan\u00E8te est surnomm\u00E9e "la plan\u00E8te bleue" ?', options: ['Neptune', 'Uranus', 'La Terre', 'V\u00E9nus'], answer: 2, emoji: '\u{1F30D}' },
            { q: 'Quel scientifique a d\u00E9couvert la p\u00E9nicilline ?', options: ['Pasteur', 'Fleming', 'Koch', 'Curie'], answer: 1, emoji: '\u{1F52C}' },
            { q: 'Combien de satellites naturels a la Terre ?', options: ['0', '1', '2', '3'], answer: 1, emoji: '\u{1F319}' },
            { q: "Quel est le symbole chimique de l'or ?", options: ['Or', 'Au', 'Ag', 'Go'], answer: 1, emoji: '\u{1F947}' },
            { q: "\u00C0 quelle temp\u00E9rature l'eau g\u00E8le-t-elle ?", options: ['-10\u00B0C', '0\u00B0C', '10\u00B0C', '4\u00B0C'], answer: 1, emoji: '\u{1F9CA}' },
            { q: 'Quel est le plus petit os du corps humain ?', options: ['Le marteau', "L'\u00E9trier", "L'enclume", 'Le pisiforme'], answer: 1, emoji: '\u{1F9B4}' },
            { q: 'Quelle est la 7e plan\u00E8te du syst\u00E8me solaire ?', options: ['Saturne', 'Neptune', 'Uranus', 'Pluton'], answer: 2, emoji: '\u{1FA90}' },
            { q: "De quelle \u00EEle vient Napol\u00E9on ?", options: ['Sicile', 'Sardaigne', 'Corse', 'Malte'], answer: 2, emoji: '\u{1F451}' },
            { q: "Combien de litres d'air respirons-nous par jour ?", options: ['5 000', '10 000', '15 000', '20 000'], answer: 2, emoji: '\u{1F4A8}' },
            { q: 'Quel est le plus grand organe interne du corps ?', options: ['Les poumons', 'Le foie', 'L\'estomac', 'Le cerveau'], answer: 1, emoji: '\u{1FAC1}' },
            { q: 'Quel m\u00E9tal a pour symbole Ag ?', options: ['Or', 'Argent', 'Aluminium', 'Arsenic'], answer: 1, emoji: '\u{1F48E}' },
            { q: 'Combien de paires de c\u00F4tes a le corps humain ?', options: ['10', '12', '14', '16'], answer: 1, emoji: '\u{1F9B4}' },
            { q: 'Quelle est la plan\u00E8te la plus lointaine du Soleil ?', options: ['Uranus', 'Neptune', 'Pluton', 'Saturne'], answer: 1, emoji: '\u{1FA90}' },
            { q: 'Qui a \u00E9crit "Les Mis\u00E9rables" ?', options: ['Zola', 'Hugo', 'Balzac', 'Dumas'], answer: 1, emoji: '\u{1F4D6}' },
            { q: 'Combien de c\u00F4t\u00E9s a un d\u00E9cagone ?', options: ['8', '10', '12', '14'], answer: 1, emoji: '\u{1F4D0}' },
            { q: 'Quel est le pH neutre ?', options: ['0', '5', '7', '14'], answer: 2, emoji: '\u{1F9EA}' },
            { q: 'Quelle est la capitale du Canada ?', options: ['Toronto', 'Montr\u00E9al', 'Vancouver', 'Ottawa'], answer: 3, emoji: '\u{1F1E8}\u{1F1E6}' },
            { q: 'Quel est le nombre de Pi arrondi au centi\u00E8me ?', options: ['3,12', '3,14', '3,16', '3,18'], answer: 1, emoji: '\u{1F522}' },
            { q: 'Quelle est la mol\u00E9cule de sel de cuisine ?', options: ['NaCl', 'KCl', 'CaCl2', 'NaOH'], answer: 0, emoji: '\u{1F9C2}' },
            { q: 'Quel est l\'animal terrestre le plus lourd ?', options: ['L\'hippopotame', 'Le rhinoc\u00E9ros', 'L\'\u00E9l\u00E9phant d\'Afrique', 'La girafe'], answer: 2, emoji: '\u{1F418}' },
            { q: 'Combien de touches a un piano standard ?', options: ['66', '78', '88', '96'], answer: 2, emoji: '\u{1F3B9}' },
            { q: 'Quelle invention est attribu\u00E9e \u00E0 Gutenberg ?', options: ['Le t\u00E9l\u00E9scope', 'L\'imprimerie', 'La boussole', 'La poudre'], answer: 1, emoji: '\u{1F4DA}' },
            { q: 'Quel est le fleuve le plus long de France ?', options: ['La Seine', 'Le Rh\u00F4ne', 'La Loire', 'La Garonne'], answer: 2, emoji: '\u{1F3DE}\uFE0F' },
            { q: 'Combien de degr\u00E9s a un angle droit ?', options: ['45', '90', '180', '360'], answer: 1, emoji: '\u{1F4D0}' }
        ];
        let pool;
        if (this.age <= 6) pool = q56;
        else if (this.age <= 8) pool = q78;
        else pool = q910;

        return shuffle(pool).slice(0, this.total);
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        this.container.innerHTML = `
            <div class="question-display">
                <span class="question-emoji">${q.emoji}</span>
                <div class="question-text">${q.q}</div>
            </div>
            <div class="answers-grid">
                ${q.options.map((opt, i) =>
                    `<button class="answer-btn" data-index="${i}">${opt}</button>`
                ).join('')}
            </div>
        `;

        this.container.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn, parseInt(btn.dataset.index)));
        });
    }

    checkAnswer(btn, selected) {
        const q = this.questions[this.current];
        const buttons = this.container.querySelectorAll('.answer-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === q.answer) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            buttons.forEach(b => {
                if (parseInt(b.dataset.index) === q.answer) b.classList.add('correct');
            });
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1200);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('quiz', stars);
        App.showModal(
            stars >= 2 ? 'Champion du Quiz !' : stars >= 1 ? 'Bien jou\u00E9 !' : 'Essaie encore !',
            `Tu as trouv\u00E9 ${this.score} bonnes r\u00E9ponses sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : TROUVE L'INTRUS ====================
class OddOneOut {
    constructor(age, container) {
        this.name = 'intrus';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = [];
        this.generateQuestions();
        this.showQuestion();
    }

    getQuestionBank() {
        const q56 = [
            { items: ['\u{1F34E}', '\u{1F34C}', '\u{1F347}', '\u{1F436}'], intrus: 3, hint: "Un n'est pas un fruit" },
            { items: ['\u{1F697}', '\u{1F68C}', '\u{1F431}', '\u{1F6B2}'], intrus: 2, hint: "Un n'est pas un v\u00E9hicule" },
            { items: ['\u{1F431}', '\u{1F436}', '\u{1F34E}', '\u{1F430}'], intrus: 2, hint: "Un n'est pas un animal" },
            { items: ['\u{1F534}', '\u{1F535}', '\u{1F7E2}', '\u{1F414}'], intrus: 3, hint: "Un n'est pas une couleur" },
            { items: ['\u2600\uFE0F', '\u{1F319}', '\u2B50', '\u{1F333}'], intrus: 3, hint: "Un n'est pas dans le ciel" },
            { items: ['\u{1F6E9}\uFE0F', '\u{1F681}', '\u{1F680}', '\u{1F41F}'], intrus: 3, hint: 'Un ne vole pas' },
            { items: ['\u{1F352}', '\u{1F353}', '\u{1F951}', '\u{1F3E0}'], intrus: 3, hint: 'Un ne se mange pas' },
            { items: ['\u{1F3B8}', '\u{1F3B9}', '\u{1F3BB}', '\u{1F4DA}'], intrus: 3, hint: "Un n'est pas un instrument" },
            { items: ['\u{1F45F}', '\u{1F462}', '\u{1F97E}', '\u{1F384}'], intrus: 3, hint: 'Un ne se porte pas aux pieds' },
            { items: ['\u{1F436}', '\u{1F431}', '\u{1F42D}', '\u{1F697}'], intrus: 3, hint: "Un n'est pas un animal" },
            { items: ['\u{1F4FA}', '\u{1F4BB}', '\u{1F4F1}', '\u{1F34E}'], intrus: 3, hint: "Un n'est pas \u00E9lectronique" },
            { items: ['\u{1F33B}', '\u{1F337}', '\u{1F339}', '\u{1F40D}'], intrus: 3, hint: "Un n'est pas une fleur" },
            { items: ['\u{1F955}', '\u{1F966}', '\u{1F952}', '\u{1F3A8}'], intrus: 3, hint: "Un n'est pas un l\u00E9gume" },
            { items: ['\u{1F37A}', '\u{1F95B}', '\u{1F9C3}', '\u{1F4D6}'], intrus: 3, hint: 'Un ne se boit pas' },
            { items: ['\u{1F40A}', '\u{1F422}', '\u{1F98E}', '\u{1F99C}'], intrus: 3, hint: "Un n'est pas un reptile" },
            { items: ['\u{1FA91}', '\u{1F3E0}', '\u26FA', '\u{1F431}'], intrus: 3, hint: "Un n'est pas une habitation" },
            { items: ['\u{1F6B2}', '\u{1F6F4}', '\u{1F3CD}\uFE0F', '\u{1F4D6}'], intrus: 3, hint: "Un n'a pas de roues" },
            { items: ['\u{1F34A}', '\u{1F34B}', '\u{1F34E}', '\u{1F451}'], intrus: 3, hint: "Un n'est pas un fruit" },
            { items: ['\u{1F40D}', '\u{1F41B}', '\u{1F98B}', '\u{1F697}'], intrus: 3, hint: "Un n'est pas un animal" },
            { items: ['\u{1F56F}\uFE0F', '\u{1F4A1}', '\u2600\uFE0F', '\u{1F9F2}'], intrus: 3, hint: "Un ne donne pas de lumi\u00E8re" },
            { items: ['\u{1F3B5}', '\u{1F3B6}', '\u{1F3B8}', '\u{1F4D0}'], intrus: 3, hint: "Un n'est pas li\u00E9 \u00E0 la musique" },
            { items: ['\u{1F40C}', '\u{1F422}', '\u{1F98E}', '\u{1F985}'], intrus: 3, hint: "Un n'est pas lent" },
            { items: ['\u{1F456}', '\u{1F455}', '\u{1F457}', '\u{1F4FA}'], intrus: 3, hint: "Un n'est pas un v\u00EAtement" },
            { items: ['\u{1F370}', '\u{1F36A}', '\u{1F369}', '\u{1F955}'], intrus: 3, hint: "Un n'est pas sucr\u00E9" },
            { items: ['\u{1F6BF}', '\u{1F6C1}', '\u{1F6BD}', '\u{1F333}'], intrus: 3, hint: "Un n'est pas dans la salle de bain" },
            { items: ['\u2708\uFE0F', '\u{1F681}', '\u{1F680}', '\u{1F6A2}'], intrus: 3, hint: "Un ne vole pas" },
            { items: ['\u{1F4CF}', '\u270F\uFE0F', '\u{1F58D}\uFE0F', '\u{1F34C}'], intrus: 3, hint: "Un n'est pas pour \u00E9crire" },
            { items: ['\u{1F436}', '\u{1F431}', '\u{1F430}', '\u{1F40D}'], intrus: 3, hint: "Un n'a pas de poils" },
            { items: ['\u{1F95A}', '\u{1F9C0}', '\u{1F95B}', '\u{1F3C0}'], intrus: 3, hint: "Un ne vient pas de la ferme" },
            { items: ['\u{1F41D}', '\u{1F98B}', '\u{1F41E}', '\u{1F433}'], intrus: 3, hint: "Un n'est pas un insecte" },
            { items: ['\u{1F4D5}', '\u{1F4D7}', '\u{1F4D8}', '\u26BD'], intrus: 3, hint: "Un n'est pas un livre" },
            { items: ['\u{1F31E}', '\u{1F525}', '\u{1F4A1}', '\u{1F9CA}'], intrus: 3, hint: "Un n'est pas chaud" }
        ];

        const q78 = [
            { items: ['\u{1F981}', '\u{1F405}', '\u{1F428}', '\u{1F408}'], intrus: 2, hint: "Un n'est pas un f\u00E9lin" },
            { items: ['\u{1F40A}', '\u{1F422}', '\u{1F407}', '\u{1F98E}'], intrus: 2, hint: "Un n'est pas un reptile" },
            { items: ['\u{1F433}', '\u{1F42C}', '\u{1F988}', '\u{1F41F}'], intrus: 3, hint: "Un n'est pas un mammif\u00E8re marin" },
            { items: ['\u{1F34E}', '\u{1F34A}', '\u{1F955}', '\u{1F353}'], intrus: 2, hint: "Un n'est pas un fruit" },
            { items: ['\u{1F1EB}\u{1F1F7}', '\u{1F1EA}\u{1F1F8}', '\u{1F1EE}\u{1F1F9}', '\u{1F1EF}\u{1F1F5}'], intrus: 3, hint: "Un n'est pas en Europe" },
            { items: ['\u{1F3B9}', '\u{1F3B8}', '\u{1F3BB}', '\u{1F3A8}'], intrus: 3, hint: "Un n'est pas \u00E0 cordes" },
            { items: ['\u2615', '\u{1F375}', '\u{1F9C3}', '\u{1F354}'], intrus: 3, hint: "Un n'est pas une boisson chaude" },
            { items: ['\u{1F6F8}', '\u{1FA90}', '\u{1F30D}', '\u2B50'], intrus: 2, hint: "Un n'est pas dans l'espace" },
            { items: ['\u{1F40D}', '\u{1F98E}', '\u{1F422}', '\u{1F438}'], intrus: 3, hint: "Un n'est pas un reptile" },
            { items: ['\u{1F3B7}', '\u{1F3BA}', '\u{1F941}', '\u{1F3B8}'], intrus: 3, hint: "Un n'est pas un instrument \u00E0 vent" },
            { items: ['\u2764\uFE0F', '\u{1F499}', '\u{1F49B}', '\u{1F338}'], intrus: 3, hint: "Un n'est pas un c\u0153ur" },
            { items: ['\u{1F980}', '\u{1F990}', '\u{1F99E}', '\u{1F426}'], intrus: 3, hint: "Un n'est pas un crustac\u00E9" },
            { items: ['\u{1F34B}', '\u{1F34A}', '\u{1F95D}', '\u{1F34E}'], intrus: 2, hint: "Un n'est pas un agrume" },
            { items: ['\u{1F697}', '\u{1F3CE}\uFE0F', '\u{1F69A}', '\u{1F6A2}'], intrus: 3, hint: 'Un ne roule pas' },
            { items: ['\u{1F333}', '\u{1F332}', '\u{1F334}', '\u{1F335}'], intrus: 3, hint: "Un n'est pas un arbre" },
            { items: ['\u{1F314}', '\u{1F31E}', '\u{1FA90}', '\u{1F30D}'], intrus: 3, hint: "Un n'est pas lumineux par lui-m\u00EAme" },
            { items: ['\u{1F987}', '\u{1F985}', '\u{1F99A}', '\u{1F422}'], intrus: 3, hint: "Un ne vole pas" },
            { items: ['\u{1F3C0}', '\u26BD', '\u{1F3BE}', '\u{1F3B9}'], intrus: 3, hint: "Un n'est pas un sport" },
            { items: ['\u{1F4D0}', '\u{1F4CF}', '\u{1F4D0}', '\u{1F3A8}'], intrus: 3, hint: "Un n'est pas un outil de g\u00E9om\u00E9trie" },
            { items: ['\u{1F9C1}', '\u{1F370}', '\u{1F36B}', '\u{1F9C5}'], intrus: 3, hint: "Un n'est pas un dessert" },
            { items: ['\u{1F3DF}\uFE0F', '\u{1F3DB}\uFE0F', '\u{1F3E0}', '\u{1F333}'], intrus: 3, hint: "Un n'est pas un b\u00E2timent" },
            { items: ['\u{1F9F2}', '\u26A1', '\u{1F4A1}', '\u{1F952}'], intrus: 3, hint: "Un n'est pas li\u00E9 \u00E0 l'\u00E9lectricit\u00E9" },
            { items: ['\u{1F30A}', '\u{1F3CA}', '\u{1F6A3}', '\u{1F3C7}'], intrus: 3, hint: "Un n'est pas un sport aquatique" },
            { items: ['\u{1F1EC}\u{1F1E7}', '\u{1F1FA}\u{1F1F8}', '\u{1F1E8}\u{1F1E6}', '\u{1F1EE}\u{1F1F9}'], intrus: 3, hint: "Un n'est pas anglophone" },
            { items: ['\u{1F40C}', '\u{1F422}', '\u{1F9A5}', '\u{1F406}'], intrus: 3, hint: "Un n'est pas lent" },
            { items: ['\u{1F9C0}', '\u{1F95B}', '\u{1F9C8}', '\u{1F36C}'], intrus: 3, hint: "Un n'est pas un produit laitier" },
            { items: ['\u{1F3B7}', '\u{1F3BA}', '\u{1F3B8}', '\u{1F3BB}'], intrus: 0, hint: "Un n'est pas un instrument \u00E0 cordes" },
            { items: ['\u{1F9CA}', '\u2744\uFE0F', '\u{1F328}\uFE0F', '\u{1F525}'], intrus: 3, hint: "Un n'est pas froid" },
            { items: ['\u{1F965}', '\u{1F34D}', '\u{1F95D}', '\u{1F955}'], intrus: 3, hint: "Un n'est pas un fruit tropical" },
            { items: ['\u{1F3A8}', '\u{1F58C}\uFE0F', '\u{1F58D}\uFE0F', '\u{1F52C}'], intrus: 3, hint: "Un n'est pas pour dessiner" },
            { items: ['\u{1F99C}', '\u{1F985}', '\u{1F426}', '\u{1F41F}'], intrus: 3, hint: "Un n'est pas un oiseau" },
            { items: ['\u{1F697}', '\u{1F68C}', '\u{1F69A}', '\u{1F681}'], intrus: 3, hint: "Un ne roule pas sur la route" }
        ];

        const q910 = [
            { items: ['2\uFE0F\u20E3', '3\uFE0F\u20E3', '5\uFE0F\u20E3', '9\uFE0F\u20E3'], intrus: 3, hint: "Un n'est pas un nombre premier" },
            { items: ['\u{1F433}', '\u{1F42C}', '\u{1F988}', '\u{1F41F}'], intrus: 3, hint: "Un n'est pas un mammif\u00E8re" },
            { items: ['\u{1F1EB}\u{1F1F7}', '\u{1F1E9}\u{1F1EA}', '\u{1F1EE}\u{1F1F9}', '\u{1F1E7}\u{1F1F7}'], intrus: 3, hint: "Un n'est pas en Europe" },
            { items: ['\u2600\uFE0F', '\u{1F30D}', '\u{1FA90}', '\u2B50'], intrus: 1, hint: "Un n'est pas une \u00E9toile" },
            { items: ['\u{1F34E}', '\u{1F345}', '\u{1F352}', '\u{1F955}'], intrus: 3, hint: "Un n'est pas rouge" },
            { items: ['\u2744\uFE0F', '\u{1F9CA}', '\u{1F525}', '\u{1F328}\uFE0F'], intrus: 2, hint: "Un n'est pas froid" },
            { items: ['\u{1F40D}', '\u{1F98E}', '\u{1F40A}', '\u{1F430}'], intrus: 3, hint: "Un n'est pas \u00E0 sang froid" },
            { items: ['\u{1F3B9}', '\u{1F3B7}', '\u{1F3BA}', '\u{1F3B5}'], intrus: 0, hint: "Un n'est pas un instrument \u00E0 vent" },
            { items: ['\u{1F4D0}', '\u{1F4D0}', '\u{1F4D0}', '\u26BD'], intrus: 3, hint: "Un n'a pas d'angles" },
            { items: ['\u{1F1EF}\u{1F1F5}', '\u{1F1E8}\u{1F1F3}', '\u{1F1F0}\u{1F1F7}', '\u{1F1EB}\u{1F1F7}'], intrus: 3, hint: "Un n'est pas en Asie" },
            { items: ['\u{1F30B}', '\u{1F3D4}\uFE0F', '\u{1F30A}', '\u{1F3D4}\uFE0F'], intrus: 2, hint: "Un n'est pas sur terre" },
            { items: ['Au', 'Ag', 'Fe', 'H\u2082O'], intrus: 3, hint: "Un n'est pas un \u00E9l\u00E9ment chimique" },
            { items: ['\u{1F1EA}\u{1F1EC}', '\u{1F1EC}\u{1F1F7}', '\u{1F1EE}\u{1F1F9}', '\u{1F1E6}\u{1F1FA}'], intrus: 3, hint: "Un n'est pas m\u00E9diterran\u00E9en" },
            { items: ['\u{1F40B}', '\u{1F42C}', '\u{1F9AD}', '\u{1F41F}'], intrus: 3, hint: "Un n'est pas un mammif\u00E8re" },
            { items: ['\u{1F314}', '\u{1FA90}', '\u{1F30C}', '\u{1F30D}'], intrus: 3, hint: "Un n'est pas un astre" },
            { items: ['\u26A1', '\u{1F4A8}', '\u2600\uFE0F', '\u{1F6E2}\uFE0F'], intrus: 3, hint: "Un n'est pas une \u00E9nergie renouvelable" },
            { items: ['O\u2082', 'N\u2082', 'CO\u2082', 'H\u2082O'], intrus: 3, hint: "Un n'est pas un gaz" },
            { items: ['\u{1F9ED}', '\u{1F52D}', '\u{1F52C}', '\u{1F3A8}'], intrus: 3, hint: "Un n'est pas un instrument scientifique" },
            { items: ['\u{1F1EF}\u{1F1F5}', '\u{1F1F0}\u{1F1F7}', '\u{1F1E8}\u{1F1F3}', '\u{1F1E7}\u{1F1EA}'], intrus: 3, hint: "Un n'est pas en Asie" },
            { items: ['\u{1F48E}', '\u{1F947}', '\u{1F948}', '\u{1F4D5}'], intrus: 3, hint: "Un n'est pas pr\u00E9cieux" },
            { items: ['\u{1F9E0}', '\u2764\uFE0F', '\u{1FAC1}', '\u{1F4D0}'], intrus: 3, hint: "Un n'est pas un organe" },
            { items: ['\u{1F1EC}\u{1F1E7}', '\u{1F1FA}\u{1F1F8}', '\u{1F1E6}\u{1F1FA}', '\u{1F1E7}\u{1F1F7}'], intrus: 3, hint: "Un n'est pas anglophone" },
            { items: ['\u{1F30B}', '\u{1F3D4}\uFE0F', '\u{1F3DC}\uFE0F', '\u{1F30A}'], intrus: 3, hint: "Un n'est pas un relief terrestre" },
            { items: ['\u{1F9EA}', '\u{1F52C}', '\u{1F9EC}', '\u{1F3B8}'], intrus: 3, hint: "Un n'est pas li\u00E9 aux sciences" },
            { items: ['Fe', 'Cu', 'Au', 'H'], intrus: 3, hint: "Un n'est pas un m\u00E9tal" },
            { items: ['\u{1F40B}', '\u{1F418}', '\u{1F993}', '\u{1F41C}'], intrus: 3, hint: "Un n'est pas un grand animal" },
            { items: ['\u{1F3C8}', '\u{1F3C0}', '\u26BD', '\u265F\uFE0F'], intrus: 3, hint: "Un n'est pas un sport de terrain" },
            { items: ['\u{1F1EE}\u{1F1F3}', '\u{1F1E8}\u{1F1F3}', '\u{1F1F7}\u{1F1FA}', '\u{1F1E8}\u{1F1ED}'], intrus: 3, hint: "Un n'a pas plus d'un milliard d'habitants" },
            { items: ['\u{1F342}', '\u{1F343}', '\u{1F33F}', '\u{1F525}'], intrus: 3, hint: "Un n'est pas une feuille" },
            { items: ['100', '144', '169', '150'], intrus: 3, hint: "Un n'est pas un carr\u00E9 parfait" },
            { items: ['\u{1F9D1}\u200D\u{1F52C}', '\u{1F9D1}\u200D\u{1F3EB}', '\u{1F9D1}\u200D\u2695\uFE0F', '\u{1F3B5}'], intrus: 3, hint: "Un n'est pas un m\u00E9tier" },
            { items: ['\u{1F30D}', '\u{1FA90}', '\u2B50', '\u{1F4A1}'], intrus: 3, hint: "Un n'est pas un corps c\u00E9leste" }
        ];
        if (this.age <= 6) return q56;
        if (this.age <= 8) return q78;
        return q910;
    }

    generateQuestions() {
        const bank = shuffle(this.getQuestionBank());
        this.questions = bank.slice(0, this.total);
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        this.container.innerHTML = `
            <div class="question-display">
                <span class="question-emoji">\u{1F50E}</span>
                <div class="question-text">Trouve l'intrus !</div>
                <p class="word-hint">${q.hint}</p>
            </div>
            <div class="intrus-grid">
                ${q.items.map((item, i) =>
                    `<div class="intrus-item" data-index="${i}">${item}</div>`
                ).join('')}
            </div>
        `;

        this.container.querySelectorAll('.intrus-item').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn, parseInt(btn.dataset.index)));
        });
    }

    checkAnswer(btn, selected) {
        const q = this.questions[this.current];
        const items = this.container.querySelectorAll('.intrus-item');
        items.forEach(b => b.classList.add('disabled'));

        if (selected === q.intrus) {
            btn.classList.add('correct-intrus');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong-intrus');
            Sound.play('wrong');
            App.showFeedback(false);
            items[q.intrus].classList.add('highlight-answer');
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1300);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('intrus', stars);
        App.showModal(
            stars >= 2 ? 'Super d\u00E9tective !' : stars >= 1 ? 'Bien vu !' : 'Essaie encore !',
            `Tu as trouv\u00E9 ${this.score} intrus sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : VRAI OU FAUX ====================
class TrueOrFalse {
    constructor(age, container) {
        this.name = 'vf';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = this.getQuestions();
        this.showQuestion();
    }

    getQuestions() {
        const q56 = [
            { statement: 'Le chat fait "Miaou"', answer: true, emoji: '\u{1F431}' },
            { statement: 'La neige est chaude', answer: false, emoji: '\u2744\uFE0F' },
            { statement: 'Le soleil brille la nuit', answer: false, emoji: '\u{1F31E}' },
            { statement: "Les poissons vivent dans l'eau", answer: true, emoji: '\u{1F41F}' },
            { statement: 'Les oiseaux ont des ailes', answer: true, emoji: '\u{1F426}' },
            { statement: 'La banane est bleue', answer: false, emoji: '\u{1F34C}' },
            { statement: 'Le chien fait "Ouaf"', answer: true, emoji: '\u{1F436}' },
            { statement: 'On mange la soupe avec une fourchette', answer: false, emoji: '\u{1F963}' },
            { statement: 'La lune se voit la nuit', answer: true, emoji: '\u{1F319}' },
            { statement: 'Les arbres ont des feuilles', answer: true, emoji: '\u{1F333}' },
            { statement: 'La glace est chaude', answer: false, emoji: '\u{1F368}' },
            { statement: 'Un triangle a 3 c\u00F4t\u00E9s', answer: true, emoji: '\u{1F4D0}' },
            { statement: 'Les lapins volent', answer: false, emoji: '\u{1F430}' },
            { statement: 'Le feu est froid', answer: false, emoji: '\u{1F525}' },
            { statement: 'On dort dans un lit', answer: true, emoji: '\u{1F6CF}\uFE0F' },
            { statement: 'Les \u00E9l\u00E9phants sont petits', answer: false, emoji: '\u{1F418}' },
            { statement: 'Les poules ont des dents', answer: false, emoji: '\u{1F414}' },
            { statement: 'Le chocolat est fait avec du cacao', answer: true, emoji: '\u{1F36B}' },
            { statement: "L'escargot est rapide", answer: false, emoji: '\u{1F40C}' },
            { statement: "L'eau de la mer est sal\u00E9e", answer: true, emoji: '\u{1F30A}' },
            { statement: 'Les carottes sont orange', answer: true, emoji: '\u{1F955}' },
            { statement: 'Les v\u00E9los ont un moteur', answer: false, emoji: '\u{1F6B2}' },
            { statement: 'Les vaches donnent du lait', answer: true, emoji: '\u{1F404}' },
            { statement: 'On peut voir les \u00E9toiles le jour', answer: false, emoji: '\u2B50' },
            { statement: 'Le z\u00E8bre a des rayures', answer: true, emoji: '\u{1F993}' },
            { statement: 'Les serpents ont des pattes', answer: false, emoji: '\u{1F40D}' },
            { statement: 'La Terre est ronde', answer: true, emoji: '\u{1F30D}' },
            { statement: "L'arc-en-ciel est tout gris", answer: false, emoji: '\u{1F308}' },
            { statement: 'Les papillons \u00E9taient des chenilles', answer: true, emoji: '\u{1F98B}' },
            { statement: 'Un carr\u00E9 a 4 c\u00F4t\u00E9s \u00E9gaux', answer: true, emoji: '\u{1F7E6}' },
            { statement: 'Les crocodiles vivent au P\u00F4le Nord', answer: false, emoji: '\u{1F40A}' },
            { statement: "Les pommes poussent sur des arbres", answer: true, emoji: '\u{1F34E}' },
            { statement: 'Le miel est fabriqu\u00E9 par les fourmis', answer: false, emoji: '\u{1F41D}' },
            { statement: 'On respire avec les poumons', answer: true, emoji: '\u{1FAC1}' },
            { statement: 'Les chats adorent nager', answer: false, emoji: '\u{1F431}' },
            { statement: "Les baleines sont des poissons", answer: false, emoji: '\u{1F433}' },
            { statement: 'Le pain est fait avec de la farine', answer: true, emoji: '\u{1F956}' },
            { statement: "Les kangourous vivent en Afrique", answer: false, emoji: '\u{1F998}' },
            { statement: "Les tortues ont une carapace", answer: true, emoji: '\u{1F422}' },
            { statement: "Les nuages sont faits de coton", answer: false, emoji: '\u2601\uFE0F' }
        ];

        const q78 = [
            { statement: 'La Terre tourne autour du Soleil', answer: true, emoji: '\u{1F30D}' },
            { statement: "L'eau bout \u00E0 100\u00B0C", answer: true, emoji: '\u{1F321}\uFE0F' },
            { statement: 'Les araign\u00E9es ont 6 pattes', answer: false, emoji: '\u{1F577}\uFE0F' },
            { statement: 'Paris est la capitale de la France', answer: true, emoji: '\u{1F1EB}\u{1F1F7}' },
            { statement: 'Le son voyage plus vite que la lumi\u00E8re', answer: false, emoji: '\u{1F4A1}' },
            { statement: 'Les plantes ont besoin de lumi\u00E8re pour pousser', answer: true, emoji: '\u{1F331}' },
            { statement: 'La baleine est un poisson', answer: false, emoji: '\u{1F433}' },
            { statement: "L'oc\u00E9an Pacifique est le plus grand", answer: true, emoji: '\u{1F30A}' },
            { statement: 'Les dinosaures existent encore', answer: false, emoji: '\u{1F995}' },
            { statement: 'Le c\u0153ur a 4 cavit\u00E9s', answer: true, emoji: '\u2764\uFE0F' },
            { statement: 'Les champignons sont des plantes', answer: false, emoji: '\u{1F344}' },
            { statement: 'La lune a sa propre lumi\u00E8re', answer: false, emoji: '\u{1F319}' },
            { statement: 'Un hexagone a 6 c\u00F4t\u00E9s', answer: true, emoji: '\u2B22' },
            { statement: 'Les dauphins sont des mammif\u00E8res', answer: true, emoji: '\u{1F42C}' },
            { statement: 'Le Sahara est le plus grand d\u00E9sert du monde', answer: false, emoji: '\u{1F3DC}\uFE0F' },
            { statement: 'Les \u00E9toiles sont des boules de gaz br\u00FBlant', answer: true, emoji: '\u2B50' },
            { statement: 'Le f\u00E9mur est le plus long os du corps', answer: true, emoji: '\u{1F9B4}' },
            { statement: "Les pingouins vivent au P\u00F4le Nord", answer: false, emoji: '\u{1F427}' },
            { statement: "La lumi\u00E8re du soleil met 8 minutes pour atteindre la Terre", answer: true, emoji: '\u2600\uFE0F' },
            { statement: "Les \u00E9clairs se produisent avant le tonnerre", answer: true, emoji: '\u26A1' },
            { statement: "Les humains ont 5 sens", answer: true, emoji: '\u{1F442}' },
            { statement: "Les autruches peuvent voler", answer: false, emoji: '\u{1F426}' },
            { statement: "Le Nil est le plus long fleuve d'Afrique", answer: true, emoji: '\u{1F3DE}\uFE0F' },
            { statement: "Les os des b\u00E9b\u00E9s sont plus nombreux que ceux des adultes", answer: true, emoji: '\u{1F476}' },
            { statement: "Mars a deux lunes", answer: true, emoji: '\u{1FA90}' },
            { statement: "Les tomates sont des l\u00E9gumes", answer: false, emoji: '\u{1F345}' },
            { statement: "La Grande Muraille de Chine est le plus long mur du monde", answer: true, emoji: '\u{1F9F1}' },
            { statement: "Les requins doivent nager pour respirer", answer: true, emoji: '\u{1F988}' },
            { statement: "Le sang est bleu dans les veines", answer: false, emoji: '\u{1FA78}' },
            { statement: "Un an sur Jupiter dure environ 12 ans terrestres", answer: true, emoji: '\u{1FA90}' },
            { statement: "Les chauves-souris sont aveugles", answer: false, emoji: '\u{1F987}' },
            { statement: "Le Mont Blanc est le plus haut sommet d'Europe", answer: true, emoji: '\u{1F3D4}\uFE0F' },
            { statement: "Les poissons rouges ont une m\u00E9moire de 3 secondes", answer: false, emoji: '\u{1F41F}' },
            { statement: "L'Amazone est le fleuve le plus long du monde", answer: true, emoji: '\u{1F30A}' },
            { statement: "Les coccinelles sont des col\u00E9opt\u00E8res", answer: true, emoji: '\u{1F41E}' },
            { statement: "La banane est une herbe", answer: true, emoji: '\u{1F34C}' },
            { statement: "Le diamant est fait de carbone", answer: true, emoji: '\u{1F48E}' },
            { statement: "Les girafes dorment 8 heures par nuit", answer: false, emoji: '\u{1F992}' },
            { statement: "La peau est le plus grand organe du corps humain", answer: true, emoji: '\u{1F9EC}' },
            { statement: "Les serpents ont des oreilles visibles", answer: false, emoji: '\u{1F40D}' }
        ];

        const q910 = [
            { statement: "La Grande Muraille de Chine est visible depuis l'espace", answer: false, emoji: '\u{1F9F1}' },
            { statement: 'La lumi\u00E8re voyage \u00E0 300 000 km/s', answer: true, emoji: '\u26A1' },
            { statement: 'Les humains utilisent seulement 10% de leur cerveau', answer: false, emoji: '\u{1F9E0}' },
            { statement: 'V\u00E9nus est la plan\u00E8te la plus chaude du syst\u00E8me solaire', answer: true, emoji: '\u{1FA90}' },
            { statement: "L'ADN a la forme d'une double h\u00E9lice", answer: true, emoji: '\u{1F9EC}' },
            { statement: "L'oxyg\u00E8ne est le gaz le plus abondant dans l'atmosph\u00E8re", answer: false, emoji: '\u{1F32C}\uFE0F' },
            { statement: 'Les \u00E9clairs sont plus chauds que la surface du soleil', answer: true, emoji: '\u26A1' },
            { statement: 'Napol\u00E9on \u00E9tait tr\u00E8s petit', answer: false, emoji: '\u{1F451}' },
            { statement: 'Un kilom\u00E8tre fait 1000 m\u00E8tres', answer: true, emoji: '\u{1F4CF}' },
            { statement: 'Les carot\u00E9no\u00EFdes am\u00E9liorent la vue', answer: false, emoji: '\u{1F955}' },
            { statement: 'Le diamant est la forme la plus dure de carbone', answer: true, emoji: '\u{1F48E}' },
            { statement: 'Le sang d\u00E9soxyg\u00E9n\u00E9 est bleu', answer: false, emoji: '\u{1FA78}' },
            { statement: 'Jupiter est la plus grande plan\u00E8te du syst\u00E8me solaire', answer: true, emoji: '\u{1FA90}' },
            { statement: 'Les cha\u00EEnes de montagnes se forment par les plaques tectoniques', answer: true, emoji: '\u{1F3D4}\uFE0F' },
            { statement: 'La temp\u00E9rature la plus basse possible est -273,15\u00B0C', answer: true, emoji: '\u{1F321}\uFE0F' },
            { statement: 'Les requins sont des mammif\u00E8res', answer: false, emoji: '\u{1F988}' },
            { statement: "Le son ne se propage pas dans le vide", answer: true, emoji: '\u{1F50A}' },
            { statement: "Les \u00E9lectrons sont plus gros que les protons", answer: false, emoji: '\u269B\uFE0F' },
            { statement: "La photosynth\u00E8se produit de l'oxyg\u00E8ne", answer: true, emoji: '\u{1F33F}' },
            { statement: "Le mercure est le seul m\u00E9tal liquide \u00E0 temp\u00E9rature ambiante", answer: true, emoji: '\u{1F321}\uFE0F' },
            { statement: "Les chameaux stockent de l'eau dans leurs bosses", answer: false, emoji: '\u{1F42A}' },
            { statement: "La Terre est la 3\u00E8me plan\u00E8te du syst\u00E8me solaire", answer: true, emoji: '\u{1F30D}' },
            { statement: "Le c\u0153ur humain bat environ 100 000 fois par jour", answer: true, emoji: '\u2764\uFE0F' },
            { statement: "Les \u00E9ponges sont des animaux", answer: true, emoji: '\u{1F9FD}' },
            { statement: "Le pH de l'eau pure est de 14", answer: false, emoji: '\u{1F4A7}' },
            { statement: "La Lune s'\u00E9loigne de la Terre chaque ann\u00E9e", answer: true, emoji: '\u{1F319}' },
            { statement: "Les plantes respirent aussi la nuit", answer: true, emoji: '\u{1F33F}' },
            { statement: "L'estomac produit un nouvel acide toutes les 2 semaines", answer: false, emoji: '\u{1F9EA}' },
            { statement: "Pluton est toujours consid\u00E9r\u00E9e comme une plan\u00E8te", answer: false, emoji: '\u{1FA90}' },
            { statement: "La vitesse du son est d'environ 340 m/s dans l'air", answer: true, emoji: '\u{1F50A}' },
            { statement: "Les empreintes digitales de chaque personne sont uniques", answer: true, emoji: '\u{1F91A}' },
            { statement: "Le verre est un liquide tr\u00E8s visqueux", answer: false, emoji: '\u{1FAA9}' },
            { statement: "La Voie Lact\u00E9e contient environ 200 milliards d'\u00E9toiles", answer: true, emoji: '\u{1F30C}' },
            { statement: "Les globules rouges n'ont pas de noyau", answer: true, emoji: '\u{1FA78}' },
            { statement: "L'or est le m\u00E9tal le plus conducteur", answer: false, emoji: '\u{1F947}' },
            { statement: "Un atome est principalement constitu\u00E9 de vide", answer: true, emoji: '\u269B\uFE0F' },
            { statement: "Les ondes radio voyagent \u00E0 la vitesse de la lumi\u00E8re", answer: true, emoji: '\u{1F4FB}' },
            { statement: "Il fait plus froid au P\u00F4le Sud qu'au P\u00F4le Nord", answer: true, emoji: '\u{1F9CA}' },
            { statement: "Les araign\u00E9es sont des insectes", answer: false, emoji: '\u{1F577}\uFE0F' },
            { statement: "Le titane est plus l\u00E9ger que l'acier", answer: true, emoji: '\u2699\uFE0F' }
        ];
        let pool;
        if (this.age <= 6) pool = q56;
        else if (this.age <= 8) pool = q78;
        else pool = q910;

        return shuffle(pool).slice(0, this.total);
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        this.container.innerHTML = `
            <div class="question-display">
                <span class="question-emoji">${q.emoji}</span>
                <div class="question-text">${q.statement}</div>
            </div>
            <div class="vf-buttons">
                <button class="vf-btn vf-vrai" data-answer="true">
                    <span class="vf-icon">\u2705</span>
                    Vrai
                </button>
                <button class="vf-btn vf-faux" data-answer="false">
                    <span class="vf-icon">\u274C</span>
                    Faux
                </button>
            </div>
        `;

        this.container.querySelectorAll('.vf-btn').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn));
        });
    }

    checkAnswer(btn) {
        const q = this.questions[this.current];
        const selected = btn.dataset.answer === 'true';
        const buttons = this.container.querySelectorAll('.vf-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === q.answer) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            // Highlight the correct answer
            buttons.forEach(b => {
                const val = b.dataset.answer === 'true';
                if (val === q.answer) b.classList.add('correct');
            });
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1300);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('vf', stars);
        App.showModal(
            stars >= 2 ? 'Incollable !' : stars >= 1 ? 'Bien jou\u00E9 !' : 'Essaie encore !',
            `Tu as trouv\u00E9 ${this.score} bonnes r\u00E9ponses sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== JEU : SUITE DE COULEURS ====================
class ColorSequence {
    constructor(age, container) {
        this.name = 'colorseq';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.round = 0;
        this.sequence = [];
        this.playerSequence = [];
        this.isPlaying = false;
        this.isPlayerTurn = false;
        this.gameOver = false;

        if (age <= 6) {
            this.colorCount = 4;
            this.startLength = 2;
            this.speed = 800;
        } else if (age <= 8) {
            this.colorCount = 5;
            this.startLength = 3;
            this.speed = 600;
        } else {
            this.colorCount = 6;
            this.startLength = 3;
            this.speed = 500;
        }

        this.allColors = [
            { color: '#FF6B6B', name: 'Rouge', freq: 261 },
            { color: '#339AF0', name: 'Bleu', freq: 329 },
            { color: '#51CF66', name: 'Vert', freq: 392 },
            { color: '#FFE66D', name: 'Jaune', freq: 523 },
            { color: '#9775FA', name: 'Violet', freq: 440 },
            { color: '#FF8A5C', name: 'Orange', freq: 349 }
        ].slice(0, this.colorCount);

        this.maxRounds = 10;
        this.render();
        this.startNewRound();
    }

    render() {
        this.container.innerHTML = `
            <div class="cs-container">
                <div class="cs-status" id="cs-status">Observe bien...</div>
                <div class="cs-circles" id="cs-circles">
                    ${this.allColors.map((c, i) =>
                        `<div class="cs-circle" data-index="${i}" style="background:${c.color};"></div>`
                    ).join('')}
                </div>
                <div class="cs-dots" id="cs-dots">
                    ${Array.from({length: this.maxRounds}, (_, i) =>
                        `<div class="cs-dot" data-round="${i}"></div>`
                    ).join('')}
                </div>
            </div>
        `;

        this.container.querySelectorAll('.cs-circle').forEach(circle => {
            circle.addEventListener('click', () => {
                if (!this.isPlayerTurn || this.isPlaying) return;
                this.handlePlayerClick(parseInt(circle.dataset.index));
            });
        });

        App.updateGameProgress(1, this.maxRounds);
        App.updateGameScore(this.score);
    }

    playTone(freq, duration) {
        try {
            const ctx = Sound.getContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.value = 0.15;
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + duration / 1000);
        } catch (e) { /* ignore */ }
    }

    async startNewRound() {
        if (this.gameOver) return;

        this.round++;
        this.playerSequence = [];

        App.updateGameProgress(this.round, this.maxRounds);

        // Update dots
        const dots = this.container.querySelectorAll('.cs-dot');
        dots.forEach((dot, i) => {
            dot.className = 'cs-dot';
            if (i < this.round - 1) dot.classList.add('cs-dot-done');
            else if (i === this.round - 1) dot.classList.add('cs-dot-current');
        });

        // Add new color to sequence
        if (this.sequence.length < this.startLength) {
            // Fill initial sequence
            while (this.sequence.length < this.startLength) {
                this.sequence.push(randInt(0, this.colorCount - 1));
            }
        } else {
            this.sequence.push(randInt(0, this.colorCount - 1));
        }

        const statusEl = document.getElementById('cs-status');
        if (statusEl) statusEl.textContent = 'Observe bien...';

        // Disable circles during playback
        this.setCirclesDisabled(true);
        this.isPlaying = true;

        await this.sleep(500);
        await this.playSequence();

        this.isPlaying = false;
        this.isPlayerTurn = true;
        this.setCirclesDisabled(false);
        if (statusEl) statusEl.textContent = '\u00C0 toi ! Reproduis la s\u00E9quence';
    }

    async playSequence() {
        const circles = this.container.querySelectorAll('.cs-circle');
        for (let i = 0; i < this.sequence.length; i++) {
            const idx = this.sequence[i];
            const circle = circles[idx];
            if (!circle) return;

            circle.classList.add('cs-lit');
            this.playTone(this.allColors[idx].freq, this.speed * 0.7);
            await this.sleep(this.speed * 0.7);
            circle.classList.remove('cs-lit');
            await this.sleep(this.speed * 0.3);
        }
    }

    handlePlayerClick(index) {
        const expectedIndex = this.playerSequence.length;
        const expected = this.sequence[expectedIndex];

        // Light up briefly
        const circles = this.container.querySelectorAll('.cs-circle');
        const circle = circles[index];
        circle.classList.add('cs-lit');
        this.playTone(this.allColors[index].freq, 200);
        setTimeout(() => circle.classList.remove('cs-lit'), 200);

        if (index === expected) {
            this.playerSequence.push(index);

            if (this.playerSequence.length === this.sequence.length) {
                // Round completed successfully
                this.score++;
                this.isPlayerTurn = false;
                App.updateGameScore(this.score);
                Sound.play('correct');
                App.showFeedback(true);

                const dots = this.container.querySelectorAll('.cs-dot');
                if (dots[this.round - 1]) dots[this.round - 1].className = 'cs-dot cs-dot-done';

                if (this.round >= this.maxRounds) {
                    setTimeout(() => this.endGame(), 800);
                } else {
                    setTimeout(() => this.startNewRound(), 1000);
                }
            }
        } else {
            // Wrong answer
            this.isPlayerTurn = false;
            circle.classList.add('cs-wrong-flash');
            Sound.play('wrong');
            App.showFeedback(false);

            const dots = this.container.querySelectorAll('.cs-dot');
            if (dots[this.round - 1]) dots[this.round - 1].className = 'cs-dot cs-dot-fail';

            setTimeout(() => {
                circle.classList.remove('cs-wrong-flash');
                this.endGame();
            }, 1000);
        }
    }

    setCirclesDisabled(disabled) {
        this.container.querySelectorAll('.cs-circle').forEach(c => {
            if (disabled) c.classList.add('cs-disabled');
            else c.classList.remove('cs-disabled');
        });
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    endGame() {
        this.gameOver = true;
        const maxPossible = this.maxRounds;
        const stars = this.score >= maxPossible * 0.8 ? 3 : this.score >= maxPossible * 0.5 ? 2 : this.score >= maxPossible * 0.2 ? 1 : 0;
        App.addStars('colorseq', stars);
        App.showModal(
            stars >= 2 ? 'Quelle m\u00E9moire !' : stars >= 1 ? 'Bien jou\u00E9 !' : 'Essaie encore !',
            `Tu as reproduit ${this.score} s\u00E9quence${this.score !== 1 ? 's' : ''} !`,
            `S\u00E9quence maximale : ${this.sequence.length} couleurs | ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {
        this.gameOver = true;
    }
}


// ==================== JEU : COMPTE LES OBJETS ====================
class CountObjects {
    constructor(age, container, rng) {
        this.name = 'countobj';
        this.age = age;
        this.container = container;
        this._rng = rng;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = [];
        this.generateQuestions();
        this.showQuestion();
    }

    _randInt(min, max) {
        return this._rng ? this._rng.randInt(min, max) : randInt(min, max);
    }

    _shuffle(arr) {
        return this._rng ? this._rng.shuffle(arr) : shuffle(arr);
    }

    _random() {
        return this._rng ? this._rng.next() : Math.random();
    }

    getEmojis() {
        return [
            '\u{1F34E}', '\u{1F34C}', '\u{1F347}', '\u{1F353}', '\u{1F352}', '\u{1F34A}',
            '\u{1F431}', '\u{1F436}', '\u{1F430}', '\u{1F42D}', '\u{1F98B}', '\u{1F41D}',
            '\u2B50', '\u{1F319}', '\u{1F33B}', '\u{1F337}', '\u{1F680}', '\u{1F3C0}',
            '\u{1F381}', '\u{1F36D}', '\u{1F36A}', '\u{1F40C}', '\u{1F41E}', '\u{1F98A}'
        ];
    }

    _generateWrongAnswers(correct, count, min, max) {
        const wrongs = new Set();
        while (wrongs.size < count) {
            let w = this._randInt(min, max);
            if (w !== correct && !wrongs.has(w)) wrongs.add(w);
        }
        return [...wrongs];
    }

    generateQuestions() {
        const emojis = this.getEmojis();
        this.questions = [];

        for (let i = 0; i < this.total; i++) {
            const available = this._shuffle(emojis);
            const target = available[0];
            let targetCount, distractorTypes;

            if (this.age <= 6) {
                targetCount = this._randInt(2, 5);
                distractorTypes = 0;
            } else if (this.age <= 8) {
                targetCount = this._randInt(3, 7);
                distractorTypes = this._randInt(1, 2);
            } else {
                targetCount = this._randInt(4, 9);
                distractorTypes = this._randInt(2, 3);
            }

            const objects = [];
            for (let j = 0; j < targetCount; j++) {
                objects.push({ emoji: target, isTarget: true });
            }

            for (let d = 0; d < distractorTypes; d++) {
                const distractor = available[d + 1];
                const distractorCount = this._randInt(1, Math.max(1, targetCount - 1));
                for (let j = 0; j < distractorCount; j++) {
                    objects.push({ emoji: distractor, isTarget: false });
                }
            }

            // Generate positions with collision avoidance
            const positions = this.generatePositions(objects.length);

            const wrongAnswers = this._generateWrongAnswers(targetCount, 3, Math.max(1, targetCount - 3), targetCount + 4);
            const options = this._shuffle([targetCount, ...wrongAnswers]);

            this.questions.push({
                target,
                targetCount,
                objects: this._shuffle(objects),
                positions,
                options
            });
        }
    }

    generatePositions(count) {
        const positions = [];
        const padding = 12;
        const objSize = 40;

        for (let i = 0; i < count; i++) {
            let x, y;
            let attempts = 0;
            let valid = false;

            while (!valid && attempts < 100) {
                x = padding + this._random() * (100 - 2 * padding - objSize / 5);
                y = padding + this._random() * (100 - 2 * padding - objSize / 5);
                valid = true;

                for (const pos of positions) {
                    const dx = x - pos.x;
                    const dy = y - pos.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 10) {
                        valid = false;
                        break;
                    }
                }
                attempts++;
            }

            positions.push({ x, y });
        }

        return positions;
    }

    showQuestion() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        App.updateGameProgress(this.current + 1, this.total);
        App.updateGameScore(this.score);

        const q = this.questions[this.current];

        this.container.innerHTML = `
            <div class="count-question-text">Combien de ${q.target} vois-tu ?</div>
            <div class="count-area">
                ${q.objects.map((obj, i) => {
                    const pos = q.positions[i];
                    return `<span class="count-object" style="left:${pos.x}%;top:${pos.y}%">${obj.emoji}</span>`;
                }).join('')}
            </div>
            <div class="answers-grid">
                ${q.options.map(opt =>
                    `<button class="answer-btn" data-answer="${opt}">${opt}</button>`
                ).join('')}
            </div>
        `;

        this.container.querySelectorAll('.answer-btn').forEach(btn => {
            btn.addEventListener('click', () => this.checkAnswer(btn, parseInt(btn.dataset.answer)));
        });
    }

    checkAnswer(btn, selected) {
        const q = this.questions[this.current];
        const buttons = this.container.querySelectorAll('.answer-btn');
        buttons.forEach(b => b.classList.add('disabled'));

        if (selected === q.targetCount) {
            btn.classList.add('correct');
            this.score++;
            Sound.play('correct');
            App.showFeedback(true);
        } else {
            btn.classList.add('wrong');
            Sound.play('wrong');
            App.showFeedback(false);
            buttons.forEach(b => {
                if (parseInt(b.dataset.answer) === q.targetCount) b.classList.add('correct');
            });
        }

        this.current++;
        setTimeout(() => this.showQuestion(), 1200);
    }

    endGame() {
        const stars = this.score >= 9 ? 3 : this.score >= 6 ? 2 : this.score >= 3 ? 1 : 0;
        App.addStars('countobj', stars);
        App.showModal(
            stars >= 2 ? 'Super compteur !' : stars >= 1 ? 'Bien compt\u00E9 !' : 'Essaie encore !',
            `Tu as trouv\u00E9 ${this.score} bonnes r\u00E9ponses sur ${this.total} !`,
            `Tu as gagn\u00E9 ${stars} \u00E9toile${stars !== 1 ? 's' : ''} !`,
            stars
        );
    }

    cleanup() {}
}


// ==================== CHRONO DEFI (TIMER CHALLENGE) ====================
class TimerChallenge {
    constructor(age, container) {
        this.name = 'timer';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.current = 0;
        this.total = 5;
        this.timerInterval = null;
        this.startTime = 0;
        this.elapsed = 0;
        this.stopped = false;
        this.roundResults = [];
        this.startRound();
    }

    startRound() {
        if (this.current >= this.total) {
            this.endGame();
            return;
        }

        this.stopped = false;
        this.elapsed = 0;

        this.container.innerHTML = `
            <div class="timer-game">
                <div class="timer-round-info">Manche ${this.current + 1} / ${this.total}</div>
                <div class="timer-display-wrapper">
                    <div class="timer-display" id="timer-display">00:00</div>
                    <div class="timer-target">Objectif : <strong>10:00</strong></div>
                </div>
                <button class="timer-stop-btn" id="timer-stop-btn">STOP</button>
                <div class="timer-result-area" id="timer-result-area"></div>
            </div>
        `;

        const stopBtn = document.getElementById('timer-stop-btn');
        stopBtn.addEventListener('click', () => this.stopTimer());

        // Countdown 3-2-1 then start
        this.showCountdown(() => {
            this.startTime = performance.now();
            this.timerInterval = setInterval(() => this.updateDisplay(), 10);
        });
    }

    showCountdown(onComplete) {
        const display = document.getElementById('timer-display');
        const stopBtn = document.getElementById('timer-stop-btn');
        stopBtn.style.display = 'none';
        let count = 3;
        display.textContent = '  ' + count + '  ';

        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                display.textContent = '  ' + count + '  ';
            } else {
                clearInterval(countInterval);
                display.textContent = '00:00';
                stopBtn.style.display = '';
                onComplete();
            }
        }, 700);
    }

    updateDisplay() {
        if (this.stopped) return;
        this.elapsed = performance.now() - this.startTime;
        if (this.elapsed >= 10000) {
            this.elapsed = 10000;
            this.stopTimer();
            return;
        }
        const display = document.getElementById('timer-display');
        if (display) {
            display.textContent = this.formatTime(this.elapsed);
        }
    }

    formatTime(ms) {
        const totalCentiseconds = Math.floor(ms / 10);
        const seconds = Math.floor(totalCentiseconds / 100);
        const centiseconds = totalCentiseconds % 100;
        return String(seconds).padStart(2, '0') + ':' + String(centiseconds).padStart(2, '0');
    }

    stopTimer() {
        if (this.stopped) return;
        this.stopped = true;
        clearInterval(this.timerInterval);

        const finalTime = this.elapsed;
        const target = 10000; // 10 seconds in ms
        const diff = Math.abs(finalTime - target);
        const won = diff < 500; // within 0.5s is a "win" in solo

        this.roundResults.push({ time: finalTime, diff });

        if (diff < 200) {
            this.score++;
        }

        const resultArea = document.getElementById('timer-result-area');
        const display = document.getElementById('timer-display');
        display.textContent = this.formatTime(finalTime);

        if (diff < 100) {
            display.classList.add('timer-perfect');
            resultArea.innerHTML = `<div class="timer-result timer-great">Parfait ! ${this.formatTime(finalTime)}</div>`;
        } else if (diff < 300) {
            display.classList.add('timer-good');
            resultArea.innerHTML = `<div class="timer-result timer-good-result">Tr\u00E8s proche ! ${this.formatTime(finalTime)}</div>`;
        } else if (diff < 500) {
            resultArea.innerHTML = `<div class="timer-result timer-ok-result">Pas mal ! ${this.formatTime(finalTime)}</div>`;
        } else {
            resultArea.innerHTML = `<div class="timer-result timer-miss-result">Trop loin ! ${this.formatTime(finalTime)}</div>`;
        }

        Sound.play(diff < 500 ? 'correct' : 'wrong');

        this.current++;

        // Show next round button instead of auto-advancing
        const stopBtn = document.getElementById('timer-stop-btn');
        if (this.current < this.total) {
            stopBtn.textContent = 'Manche suivante';
            stopBtn.style.display = '';
            stopBtn.onclick = () => this.startRound();
        } else {
            stopBtn.textContent = 'Voir les r\u00E9sultats';
            stopBtn.style.display = '';
            stopBtn.onclick = () => this.endGame();
        }
    }

    endGame() {
        clearInterval(this.timerInterval);
        const avgDiff = this.roundResults.reduce((sum, r) => sum + r.diff, 0) / this.roundResults.length;
        const stars = avgDiff < 200 ? 3 : avgDiff < 500 ? 2 : avgDiff < 1000 ? 1 : 0;
        const bestRound = this.roundResults.reduce((best, r) => r.diff < best.diff ? r : best);

        App.addStars('timer', stars);
        App.showModal(
            stars >= 2 ? 'Chrono ma\u00EEtris\u00E9 !' : stars >= 1 ? 'Bon r\u00E9flexe !' : 'Essaie encore !',
            `Meilleur temps : ${this.formatTime(bestRound.time)}`,
            `\u00C9cart moyen : ${(avgDiff / 1000).toFixed(2)}s \u2022 ${stars} \u00E9toile${stars !== 1 ? 's' : ''}`,
            stars
        );
    }

    cleanup() {
        clearInterval(this.timerInterval);
    }
}


// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
