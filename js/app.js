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

        ['math', 'words', 'memory', 'pattern', 'draw', 'quiz', 'intrus', 'vf', 'colorseq', 'countobj'].forEach(game => {
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
    },

    bindEvents() {
        // Accueil -> Player Select
        document.getElementById('start-btn').addEventListener('click', () => {
            Sound.play('click');
            this.showScreen('player-select-screen');
        });

        // Retour à l'accueil
        document.getElementById('back-to-welcome').addEventListener('click', () => {
            Sound.play('click');
            this.showScreen('player-select-screen');
        });

        // Sélection de l'âge
        document.querySelectorAll('.age-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                Sound.play('click');
                this.age = parseInt(btn.dataset.age);
                document.getElementById('selected-age-display').textContent = this.age;
                this.updateStarsDisplay();
                this.showScreen('menu-screen');
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
                if (this.isMultiplayer && Multiplayer.isHost) {
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
                Multiplayer.leaveRoom();
                Multiplayer.disconnect();
                VideoChat.stop();
                this.isMultiplayer = false;
            }
            this.showScreen('menu-screen');
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
            countobj: 'Compte les Objets'
        };

        document.getElementById('game-title').textContent = titles[gameName] || 'Jeu';

        const gameProgressEl = document.querySelector('.game-progress');

        if (gameName === 'draw') {
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
        { id: 'countobj', icon: '\u{1F522}', label: 'Compter' }
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

    // ==================== MULTIPLAYER METHODS ====================

    bindMultiplayerEvents() {
        // Player select screen
        document.getElementById('back-to-welcome-from-player').addEventListener('click', () => {
            Sound.play('click');
            this.showScreen('welcome-screen');
        });

        document.querySelectorAll('.player-card').forEach(card => {
            card.addEventListener('click', () => {
                Sound.play('click');
                document.querySelectorAll('.player-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.playerAvatar = card.dataset.player;
                this.playerName = card.dataset.name;
                document.getElementById('play-mode-buttons').style.display = 'flex';
            });
        });

        // Play solo
        document.getElementById('play-solo-btn').addEventListener('click', () => {
            Sound.play('click');
            this.isMultiplayer = false;
            this.showScreen('age-screen');
        });

        // Play together
        document.getElementById('play-together-btn').addEventListener('click', async () => {
            Sound.play('click');
            this.isMultiplayer = true;
            this.showScreen('lobby-screen');
            document.getElementById('lobby-status').textContent = 'Connexion au serveur...';
            this._updateConnectionIndicator(false);
            try {
                await Multiplayer.connect();
                document.getElementById('lobby-status').textContent = '';
                this._updateConnectionIndicator(true);
            } catch (e) {
                document.getElementById('lobby-status').textContent = 'Erreur de connexion. Réessaye !';
                this._updateConnectionIndicator(false);
            }
        });

        // Lobby back
        document.getElementById('back-to-player-select').addEventListener('click', () => {
            Sound.play('click');
            if (Multiplayer.roomCode) Multiplayer.leaveRoom();
            Multiplayer.disconnect();
            VideoChat.stop();
            this.isMultiplayer = false;
            document.getElementById('lobby-options').classList.remove('hidden');
            document.getElementById('lobby-waiting').classList.add('hidden');
            this.showScreen('player-select-screen');
        });

        // Create room
        document.getElementById('create-room-btn').addEventListener('click', async () => {
            Sound.play('click');
            if (!Multiplayer.isReady()) {
                document.getElementById('lobby-status').textContent = 'Connexion en cours...';
                try {
                    await Multiplayer.connect();
                    this._updateConnectionIndicator(true);
                } catch (e) {
                    document.getElementById('lobby-status').textContent = 'Impossible de se connecter';
                    return;
                }
            }
            document.getElementById('lobby-status').textContent = 'Création de la salle...';
            Multiplayer.createRoom(this.playerName, this.playerAvatar);
        });

        // Join room
        document.getElementById('join-room-btn').addEventListener('click', async () => {
            Sound.play('click');
            const code = document.getElementById('room-code-input').value.trim().toUpperCase();
            if (code.length !== 3) {
                document.getElementById('lobby-status').textContent = 'Entre un code à 3 chiffres';
                return;
            }
            if (!Multiplayer.isReady()) {
                document.getElementById('lobby-status').textContent = 'Connexion en cours...';
                try {
                    await Multiplayer.connect();
                    this._updateConnectionIndicator(true);
                } catch (e) {
                    document.getElementById('lobby-status').textContent = 'Impossible de se connecter';
                    return;
                }
            }
            document.getElementById('lobby-status').textContent = 'Recherche de la salle...';
            Multiplayer.joinRoom(code, this.playerName, this.playerAvatar);
        });

        // Lobby start game (host picks)
        document.getElementById('lobby-start-btn').addEventListener('click', () => {
            Sound.play('click');
            // Go to age selection, then menu
            this.showScreen('age-screen');
        });

        // Disconnect overlay
        document.getElementById('disconnect-back-btn').addEventListener('click', () => {
            Sound.play('click');
            document.getElementById('disconnect-overlay').classList.add('hidden');
            this.isMultiplayer = false;
            this.hideMultiplayerHeader();
            VideoChat.stop();
            this.showScreen('menu-screen');
        });

        // Video chat controls
        document.getElementById('vc-mute-btn').addEventListener('click', () => {
            VideoChat.toggleMute();
        });
        document.getElementById('vc-camera-btn').addEventListener('click', () => {
            VideoChat.toggleCamera();
        });

        // Setup multiplayer callbacks
        Multiplayer.onRoomCreated = (roomCode) => {
            document.getElementById('lobby-options').classList.add('hidden');
            document.getElementById('lobby-waiting').classList.remove('hidden');
            document.getElementById('room-code-display').textContent = roomCode;
            document.getElementById('lobby-status').textContent = 'En attente d\'un joueur...';
            document.getElementById('lobby-start-btn').classList.add('hidden');

            // Start local video preview
            this._startLobbyVideo();
        };

        Multiplayer.onRoomJoined = async (players) => {
            document.getElementById('lobby-options').classList.add('hidden');
            document.getElementById('lobby-waiting').classList.remove('hidden');
            if (Multiplayer.roomCode) {
                document.getElementById('room-code-display').textContent = Multiplayer.roomCode;
            }

            // Show players
            const playersEl = document.getElementById('lobby-players');
            playersEl.innerHTML = '';
            players.forEach(p => {
                const div = document.createElement('div');
                div.className = 'lobby-player';
                div.innerHTML = `
                    <div class="lobby-player-avatar">
                        <img src="images/${p.avatar}.jpg" alt="${p.name}">
                    </div>
                    <span class="lobby-player-name">${p.name}</span>
                `;
                playersEl.appendChild(div);
            });

            if (players.length >= 2) {
                document.getElementById('lobby-status').textContent = 'Tout le monde est l\u00E0 !';

                if (Multiplayer.isHost) {
                    document.getElementById('lobby-start-btn').classList.remove('hidden');
                } else {
                    document.getElementById('lobby-status').textContent = 'L\'h\u00F4te va choisir le jeu...';
                }

                // Start video chat
                await this._startLobbyVideo();
                VideoChat.setupSignaling();
                if (Multiplayer.isHost) {
                    setTimeout(() => VideoChat.createOffer(), 1000);
                }
            }
        };

        Multiplayer.onRoomError = (message) => {
            document.getElementById('lobby-status').textContent = message;
            // Show lobby options again so user can retry
            document.getElementById('lobby-options').classList.remove('hidden');
            document.getElementById('lobby-waiting').classList.add('hidden');
        };

        // Connection state change handler
        Multiplayer.onConnectionChange = (connected) => {
            this._updateConnectionIndicator(connected);
            if (!connected && this.currentScreen === 'lobby-screen') {
                document.getElementById('lobby-status').textContent = 'Connexion perdue. Reconnexion...';
            }
        };

        Multiplayer.onPlayerLeft = (msg) => {
            if (msg.disconnected || this.currentScreen === 'game-screen') {
                document.getElementById('disconnect-overlay').classList.remove('hidden');
            } else {
                document.getElementById('lobby-status').textContent = 'L\'autre joueur est parti...';
                document.getElementById('lobby-start-btn').classList.add('hidden');
            }
        };

        Multiplayer.onGameStart = (msg) => {
            this.age = msg.age;
            document.getElementById('selected-age-display').textContent = this.age;
            this.startGameNow(msg.game, msg.seed);
        };
    },

    async _startLobbyVideo() {
        const hasMedia = await VideoChat.startLocalMedia();
        if (hasMedia) {
            const lobbyVideo = document.getElementById('lobby-local-video');
            if (lobbyVideo && VideoChat.localStream) {
                lobbyVideo.srcObject = VideoChat.localStream;
            }
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

        const me = Multiplayer.players.find(p => p.id === Multiplayer.playerId);
        const partner = Multiplayer.getPartner();

        if (me) {
            document.getElementById('mp-avatar-left').innerHTML = `<img src="images/${me.avatar}.jpg" alt="${me.name}">`;
            document.getElementById('mp-name-left').textContent = me.name;
            document.getElementById('mp-score-left').textContent = '0';
        }
        if (partner) {
            document.getElementById('mp-avatar-right').innerHTML = `<img src="images/${partner.avatar}.jpg" alt="${partner.name}">`;
            document.getElementById('mp-name-right').textContent = partner.name;
            document.getElementById('mp-score-right').textContent = '0';
        }
    },

    hideMultiplayerHeader() {
        document.getElementById('mp-score-header').classList.add('hidden');
    },

    updateMultiplayerScores(scores) {
        if (!scores) return;
        const me = Multiplayer.playerId;
        const partner = Multiplayer.getPartner();
        const myScore = scores[me] || 0;
        const partnerScore = partner ? (scores[partner.id] || 0) : 0;

        document.getElementById('mp-score-left').textContent = myScore;
        document.getElementById('mp-score-right').textContent = partnerScore;
    },

    showMultiplayerResult(title, message, detail, starsEarned) {
        const modal = document.getElementById('result-modal');
        document.getElementById('result-title').textContent = title;
        document.getElementById('result-message').textContent = message;

        const detailEl = document.getElementById('result-detail');
        detailEl.innerHTML = '';

        if (this._mpScores && Multiplayer.players.length >= 2) {
            const me = Multiplayer.players.find(p => p.id === Multiplayer.playerId);
            const partner = Multiplayer.getPartner();
            const myScore = this._mpScores[Multiplayer.playerId] || 0;
            const partnerScore = partner ? (this._mpScores[partner.id] || 0) : 0;

            const scoresDiv = document.createElement('div');
            scoresDiv.className = 'mp-result-scores';

            const isWinner = myScore > partnerScore;
            const isTie = myScore === partnerScore;
            const partnerIsWinner = partnerScore > myScore;

            scoresDiv.innerHTML = `
                <div class="mp-result-player ${isWinner ? 'mp-winner' : ''}">
                    ${isWinner ? '<span class="mp-result-crown">\u{1F451}</span>' : ''}
                    <div class="mp-result-avatar"><img src="images/${me.avatar}.jpg" alt="${me.name}"></div>
                    <span class="mp-result-name">${me.name}</span>
                    <span class="mp-result-score">${myScore}</span>
                </div>
                <div class="mp-result-player ${partnerIsWinner ? 'mp-winner' : ''}">
                    ${partnerIsWinner ? '<span class="mp-result-crown">\u{1F451}</span>' : ''}
                    <div class="mp-result-avatar"><img src="images/${partner.avatar}.jpg" alt="${partner.name}"></div>
                    <span class="mp-result-name">${partner.name}</span>
                    <span class="mp-result-score">${partnerScore}</span>
                </div>
            `;
            detailEl.appendChild(scoresDiv);

            if (isTie) {
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
            }
        };
        return data[gameName] || data.math;
    }
};


// ==================== SYNTHÈSE VOCALE ====================
const Voice = {
    speaking: false,

    speak(text) {
        if (!('speechSynthesis' in window)) return;
        this.stop();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR';
        utterance.rate = 0.9;
        utterance.pitch = 1.05;
        utterance.volume = 1;

        // Essayer de trouver une voix française
        const voices = speechSynthesis.getVoices();
        const frenchVoice = voices.find(v => v.lang.startsWith('fr'));
        if (frenchVoice) utterance.voice = frenchVoice;

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
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
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
            { word: 'PAIN', emoji: '\u{1F956}' }
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
            { word: 'PIANO', emoji: '\u{1F3B9}' }
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
            { word: 'NUAGES', emoji: '\u{1F325}\uFE0F' }
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
            { q: 'Que fabriquent les abeilles ?', options: ['Du lait', 'Du miel', 'Du jus', 'De l\'eau'], answer: 1, emoji: '\u{1F41D}' },
            { q: 'Qui est plus gros : un \u00E9l\u00E9phant ou une souris ?', options: ['La souris', 'L\'\u00E9l\u00E9phant', 'Pareil', 'Le chat'], answer: 1, emoji: '\u{1F418}' },
            { q: 'Avec quoi mange-t-on de la soupe ?', options: ['Fourchette', 'Couteau', 'Cuill\u00E8re', 'Verre'], answer: 2, emoji: '\u{1F963}' }
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
            { q: 'Quelle est la temp\u00E9rature d\'\u00E9bullition de l\'eau ?', options: ['50\u00B0C', '100\u00B0C', '150\u00B0C', '200\u00B0C'], answer: 1, emoji: '\u{1F321}\uFE0F' },
            { q: 'Quel animal peut changer de couleur ?', options: ['Grenouille', 'Cam\u00E9l\u00E9on', 'Serpent', 'Perroquet'], answer: 1, emoji: '\u{1F98E}' }
        ];

        const q910 = [
            { q: 'Quel est le symbole chimique de l\'eau ?', options: ['O2', 'H2O', 'CO2', 'NaCl'], answer: 1, emoji: '\u{1F4A7}' },
            { q: 'Qui a peint la Joconde ?', options: ['Picasso', 'De Vinci', 'Van Gogh', 'Monet'], answer: 1, emoji: '\u{1F5BC}\uFE0F' },
            { q: 'Quelle est la capitale du Japon ?', options: ['S\u00E9oul', 'P\u00E9kin', 'Tokyo', 'Bangkok'], answer: 2, emoji: '\u{1F5FC}' },
            { q: 'Combien d\'os y a-t-il dans le corps humain ?', options: ['106', '206', '306', '406'], answer: 1, emoji: '\u{1F9B4}' },
            { q: 'Quelle est la plus grande plan\u00E8te du syst\u00E8me solaire ?', options: ['Saturne', 'Jupiter', 'Neptune', 'Uranus'], answer: 1, emoji: '\u{1FA90}' },
            { q: 'Quelle force nous maintient au sol ?', options: ['Magn\u00E9tisme', 'Friction', 'Gravit\u00E9', 'Vent'], answer: 2, emoji: '\u{1F30D}' },
            { q: 'Combien font 15% de 200 ?', options: ['15', '20', '25', '30'], answer: 3, emoji: '\u{1F4CA}' },
            { q: 'Quel instrument a 88 touches ?', options: ['Guitare', 'Violon', 'Piano', 'Batterie'], answer: 2, emoji: '\u{1F3B9}' },
            { q: 'Quelle est la vitesse de la lumi\u00E8re ?', options: ['300 km/s', '3 000 km/s', '300 000 km/s', '3 000 000 km/s'], answer: 2, emoji: '\u26A1' },
            { q: 'Quel pourcentage de la Terre est couvert d\'eau ?', options: ['50%', '61%', '71%', '81%'], answer: 2, emoji: '\u{1F30A}' },
            { q: 'Quel est le plus petit nombre premier ?', options: ['0', '1', '2', '3'], answer: 2, emoji: '\u{1F522}' },
            { q: 'Quel gaz compose la majorit\u00E9 de l\'atmosph\u00E8re ?', options: ['Oxyg\u00E8ne', 'Azote', 'Dioxyde de carbone', 'Hydrog\u00E8ne'], answer: 1, emoji: '\u{1F32C}\uFE0F' }
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
            { items: ['\u{1F34E}', '\u{1F34C}', '\u{1F347}', '\u{1F436}'], intrus: 3, hint: 'Un n\'est pas un fruit' },
            { items: ['\u{1F697}', '\u{1F68C}', '\u{1F431}', '\u{1F6B2}'], intrus: 2, hint: 'Un n\'est pas un v\u00E9hicule' },
            { items: ['\u{1F431}', '\u{1F436}', '\u{1F34E}', '\u{1F430}'], intrus: 2, hint: 'Un n\'est pas un animal' },
            { items: ['\u{1F534}', '\u{1F535}', '\u{1F7E2}', '\u{1F414}'], intrus: 3, hint: 'Un n\'est pas une couleur' },
            { items: ['\u2600\uFE0F', '\u{1F319}', '\u2B50', '\u{1F333}'], intrus: 3, hint: 'Un n\'est pas dans le ciel' },
            { items: ['\u{1F6E9}\uFE0F', '\u{1F681}', '\u{1F680}', '\u{1F41F}'], intrus: 3, hint: 'Un ne vole pas' },
            { items: ['\u{1F352}', '\u{1F353}', '\u{1F951}', '\u{1F3E0}'], intrus: 3, hint: 'Un ne se mange pas' },
            { items: ['\u{1F3B8}', '\u{1F3B9}', '\u{1F3BB}', '\u{1F4DA}'], intrus: 3, hint: 'Un n\'est pas un instrument' },
            { items: ['\u{1F45F}', '\u{1F462}', '\u{1F97E}', '\u{1F384}'], intrus: 3, hint: 'Un ne se porte pas aux pieds' },
            { items: ['\u{1F436}', '\u{1F431}', '\u{1F42D}', '\u{1F697}'], intrus: 3, hint: 'Un n\'est pas un animal' },
            { items: ['\u{1F4FA}', '\u{1F4BB}', '\u{1F4F1}', '\u{1F34E}'], intrus: 3, hint: 'Un n\'est pas \u00E9lectronique' },
            { items: ['\u{1F33B}', '\u{1F337}', '\u{1F339}', '\u{1F40D}'], intrus: 3, hint: 'Un n\'est pas une fleur' },
            { items: ['\u{1F955}', '\u{1F966}', '\u{1F952}', '\u{1F3A8}'], intrus: 3, hint: 'Un n\'est pas un l\u00E9gume' },
            { items: ['\u{1F37A}', '\u{1F95B}', '\u{1F9C3}', '\u{1F4D6}'], intrus: 3, hint: 'Un ne se boit pas' },
            { items: ['\u{1F40A}', '\u{1F422}', '\u{1F98E}', '\u{1F99C}'], intrus: 3, hint: 'Un n\'est pas un reptile' },
            { items: ['\u{1FA91}', '\u{1F3E0}', '\u26FA', '\u{1F431}'], intrus: 3, hint: 'Un n\'est pas une habitation' }
        ];

        const q78 = [
            { items: ['\u{1F981}', '\u{1F405}', '\u{1F428}', '\u{1F408}'], intrus: 2, hint: 'Un n\'est pas un f\u00E9lin' },
            { items: ['\u{1F40A}', '\u{1F422}', '\u{1F407}', '\u{1F98E}'], intrus: 2, hint: 'Un n\'est pas un reptile' },
            { items: ['\u{1F433}', '\u{1F42C}', '\u{1F988}', '\u{1F41F}'], intrus: 3, hint: 'Un n\'est pas un mammif\u00E8re marin' },
            { items: ['\u{1F34E}', '\u{1F34A}', '\u{1F955}', '\u{1F353}'], intrus: 2, hint: 'Un n\'est pas un fruit' },
            { items: ['\u{1F1EB}\u{1F1F7}', '\u{1F1EA}\u{1F1F8}', '\u{1F1EE}\u{1F1F9}', '\u{1F1EF}\u{1F1F5}'], intrus: 3, hint: 'Un n\'est pas en Europe' },
            { items: ['\u{1F3B9}', '\u{1F3B8}', '\u{1F3BB}', '\u{1F3A8}'], intrus: 3, hint: 'Un n\'est pas \u00E0 cordes' },
            { items: ['\u2615', '\u{1F375}', '\u{1F9C3}', '\u{1F354}'], intrus: 3, hint: 'Un n\'est pas une boisson chaude' },
            { items: ['\u{1F6F8}', '\u{1FA90}', '\u{1F30D}', '\u2B50'], intrus: 2, hint: 'Un n\'est pas dans l\'espace' },
            { items: ['\u{1F40D}', '\u{1F98E}', '\u{1F422}', '\u{1F438}'], intrus: 3, hint: 'Un n\'est pas un reptile' },
            { items: ['\u{1F3B7}', '\u{1F3BA}', '\u{1F941}', '\u{1F3B8}'], intrus: 3, hint: 'Un n\'est pas un instrument \u00E0 vent' },
            { items: ['\u2764\uFE0F', '\u{1F499}', '\u{1F49B}', '\u{1F338}'], intrus: 3, hint: 'Un n\'est pas un c\u0153ur' },
            { items: ['\u{1F980}', '\u{1F990}', '\u{1F99E}', '\u{1F426}'], intrus: 3, hint: 'Un n\'est pas un crustac\u00E9' },
            { items: ['\u{1F34B}', '\u{1F34A}', '\u{1F95D}', '\u{1F34E}'], intrus: 2, hint: 'Un n\'est pas un agrume' },
            { items: ['\u{1F697}', '\u{1F3CE}\uFE0F', '\u{1F69A}', '\u{1F6A2}'], intrus: 3, hint: 'Un ne roule pas' },
            { items: ['\u{1F333}', '\u{1F332}', '\u{1F334}', '\u{1F335}'], intrus: 3, hint: 'Un n\'est pas un arbre' },
            { items: ['\u{1F314}', '\u{1F31E}', '\u{1FA90}', '\u{1F30D}'], intrus: 3, hint: 'Un n\'est pas lumineux par lui-m\u00EAme' }
        ];

        const q910 = [
            { items: ['2\uFE0F\u20E3', '3\uFE0F\u20E3', '5\uFE0F\u20E3', '9\uFE0F\u20E3'], intrus: 3, hint: 'Un n\'est pas un nombre premier' },
            { items: ['\u{1F433}', '\u{1F42C}', '\u{1F988}', '\u{1F41F}'], intrus: 3, hint: 'Un n\'est pas un mammif\u00E8re' },
            { items: ['\u{1F1EB}\u{1F1F7}', '\u{1F1E9}\u{1F1EA}', '\u{1F1EE}\u{1F1F9}', '\u{1F1E7}\u{1F1F7}'], intrus: 3, hint: 'Un n\'est pas en Europe' },
            { items: ['\u2600\uFE0F', '\u{1F30D}', '\u{1FA90}', '\u2B50'], intrus: 1, hint: 'Un n\'est pas une \u00E9toile' },
            { items: ['\u{1F34E}', '\u{1F345}', '\u{1F352}', '\u{1F955}'], intrus: 3, hint: 'Un n\'est pas rouge' },
            { items: ['\u2744\uFE0F', '\u{1F9CA}', '\u{1F525}', '\u{1F328}\uFE0F'], intrus: 2, hint: 'Un n\'est pas froid' },
            { items: ['\u{1F40D}', '\u{1F98E}', '\u{1F40A}', '\u{1F430}'], intrus: 3, hint: 'Un n\'est pas \u00E0 sang froid' },
            { items: ['\u{1F3B9}', '\u{1F3B7}', '\u{1F3BA}', '\u{1F3B5}'], intrus: 0, hint: 'Un n\'est pas un instrument \u00E0 vent' },
            { items: ['\u{1F4D0}', '\u{1F4D0}', '\u{1F4D0}', '\u26BD'], intrus: 3, hint: 'Un n\'a pas d\'angles' },
            { items: ['\u{1F1EF}\u{1F1F5}', '\u{1F1E8}\u{1F1F3}', '\u{1F1F0}\u{1F1F7}', '\u{1F1EB}\u{1F1F7}'], intrus: 3, hint: 'Un n\'est pas en Asie' },
            { items: ['\u{1F30B}', '\u{1F3D4}\uFE0F', '\u{1F30A}', '\u{1F3D4}\uFE0F'], intrus: 2, hint: 'Un n\'est pas sur terre' },
            { items: ['Au', 'Ag', 'Fe', 'H\u2082O'], intrus: 3, hint: 'Un n\'est pas un \u00E9l\u00E9ment chimique' },
            { items: ['\u{1F1EA}\u{1F1EC}', '\u{1F1EC}\u{1F1F7}', '\u{1F1EE}\u{1F1F9}', '\u{1F1E6}\u{1F1FA}'], intrus: 3, hint: 'Un n\'est pas m\u00E9diterran\u00E9en' },
            { items: ['\u{1F40B}', '\u{1F42C}', '\u{1F9AD}', '\u{1F41F}'], intrus: 3, hint: 'Un n\'est pas un mammif\u00E8re' },
            { items: ['\u{1F314}', '\u{1FA90}', '\u{1F30C}', '\u{1F30D}'], intrus: 3, hint: 'Un n\'est pas un astre' },
            { items: ['\u26A1', '\u{1F4A8}', '\u2600\uFE0F', '\u{1F6E2}\uFE0F'], intrus: 3, hint: 'Un n\'est pas une \u00E9nergie renouvelable' }
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
            { statement: 'Les poissons vivent dans l\'eau', answer: true, emoji: '\u{1F41F}' },
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
            { statement: 'Les \u00E9l\u00E9phants sont petits', answer: false, emoji: '\u{1F418}' }
        ];

        const q78 = [
            { statement: 'La Terre tourne autour du Soleil', answer: true, emoji: '\u{1F30D}' },
            { statement: 'L\'eau bout \u00E0 100\u00B0C', answer: true, emoji: '\u{1F321}\uFE0F' },
            { statement: 'Les araign\u00E9es ont 6 pattes', answer: false, emoji: '\u{1F577}\uFE0F' },
            { statement: 'Paris est la capitale de la France', answer: true, emoji: '\u{1F1EB}\u{1F1F7}' },
            { statement: 'Le son voyage plus vite que la lumi\u00E8re', answer: false, emoji: '\u{1F4A1}' },
            { statement: 'Les plantes ont besoin de lumi\u00E8re pour pousser', answer: true, emoji: '\u{1F331}' },
            { statement: 'La baleine est un poisson', answer: false, emoji: '\u{1F433}' },
            { statement: 'L\'oc\u00E9an Pacifique est le plus grand', answer: true, emoji: '\u{1F30A}' },
            { statement: 'Les dinosaures existent encore', answer: false, emoji: '\u{1F995}' },
            { statement: 'Le c\u0153ur a 4 cavit\u00E9s', answer: true, emoji: '\u2764\uFE0F' },
            { statement: 'Les champignons sont des plantes', answer: false, emoji: '\u{1F344}' },
            { statement: 'La lune a sa propre lumi\u00E8re', answer: false, emoji: '\u{1F319}' },
            { statement: 'Un hexagone a 6 c\u00F4t\u00E9s', answer: true, emoji: '\u2B22' },
            { statement: 'Les dauphins sont des mammif\u00E8res', answer: true, emoji: '\u{1F42C}' },
            { statement: 'Le Sahara est le plus grand d\u00E9sert du monde', answer: false, emoji: '\u{1F3DC}\uFE0F' },
            { statement: 'Les \u00E9toiles sont des boules de gaz br\u00FBlant', answer: true, emoji: '\u2B50' }
        ];

        const q910 = [
            { statement: 'La Grande Muraille de Chine est visible depuis l\'espace', answer: false, emoji: '\u{1F9F1}' },
            { statement: 'La lumi\u00E8re voyage \u00E0 300 000 km/s', answer: true, emoji: '\u26A1' },
            { statement: 'Les humains utilisent seulement 10% de leur cerveau', answer: false, emoji: '\u{1F9E0}' },
            { statement: 'V\u00E9nus est la plan\u00E8te la plus chaude du syst\u00E8me solaire', answer: true, emoji: '\u{1FA90}' },
            { statement: 'L\'ADN a la forme d\'une double h\u00E9lice', answer: true, emoji: '\u{1F9EC}' },
            { statement: 'L\'oxyg\u00E8ne est le gaz le plus abondant dans l\'atmosph\u00E8re', answer: false, emoji: '\u{1F32C}\uFE0F' },
            { statement: 'Les \u00E9clairs sont plus chauds que la surface du soleil', answer: true, emoji: '\u26A1' },
            { statement: 'Napol\u00E9on \u00E9tait tr\u00E8s petit', answer: false, emoji: '\u{1F451}' },
            { statement: 'Un kilom\u00E8tre fait 1000 m\u00E8tres', answer: true, emoji: '\u{1F4CF}' },
            { statement: 'Les carot\u00E9no\u00EFdes am\u00E9liorent la vue', answer: false, emoji: '\u{1F955}' },
            { statement: 'Le diamant est la forme la plus dure de carbone', answer: true, emoji: '\u{1F48E}' },
            { statement: 'Le sang d\u00E9soxyg\u00E9n\u00E9 est bleu', answer: false, emoji: '\u{1FA78}' },
            { statement: 'Jupiter est la plus grande plan\u00E8te du syst\u00E8me solaire', answer: true, emoji: '\u{1FA90}' },
            { statement: 'Les cha\u00EEnes de montagnes se forment par les plaques tectoniques', answer: true, emoji: '\u{1F3D4}\uFE0F' },
            { statement: 'La temp\u00E9rature la plus basse possible est -273,15\u00B0C', answer: true, emoji: '\u{1F321}\uFE0F' },
            { statement: 'Les requins sont des mammif\u00E8res', answer: false, emoji: '\u{1F988}' }
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
    constructor(age, container) {
        this.name = 'countobj';
        this.age = age;
        this.container = container;
        this.score = 0;
        this.current = 0;
        this.total = 10;
        this.questions = [];
        this.generateQuestions();
        this.showQuestion();
    }

    getEmojis() {
        return [
            '\u{1F34E}', '\u{1F34C}', '\u{1F347}', '\u{1F353}', '\u{1F352}', '\u{1F34A}',
            '\u{1F431}', '\u{1F436}', '\u{1F430}', '\u{1F42D}', '\u{1F98B}', '\u{1F41D}',
            '\u2B50', '\u{1F319}', '\u{1F33B}', '\u{1F337}', '\u{1F680}', '\u{1F3C0}',
            '\u{1F381}', '\u{1F36D}', '\u{1F36A}', '\u{1F40C}', '\u{1F41E}', '\u{1F98A}'
        ];
    }

    generateQuestions() {
        const emojis = this.getEmojis();
        this.questions = [];

        for (let i = 0; i < this.total; i++) {
            const available = shuffle(emojis);
            const target = available[0];
            let targetCount, distractorTypes;

            if (this.age <= 6) {
                targetCount = randInt(2, 5);
                distractorTypes = 0;
            } else if (this.age <= 8) {
                targetCount = randInt(3, 7);
                distractorTypes = randInt(1, 2);
            } else {
                targetCount = randInt(4, 9);
                distractorTypes = randInt(2, 3);
            }

            const objects = [];
            for (let j = 0; j < targetCount; j++) {
                objects.push({ emoji: target, isTarget: true });
            }

            for (let d = 0; d < distractorTypes; d++) {
                const distractor = available[d + 1];
                const distractorCount = randInt(1, Math.max(1, targetCount - 1));
                for (let j = 0; j < distractorCount; j++) {
                    objects.push({ emoji: distractor, isTarget: false });
                }
            }

            // Generate positions with collision avoidance
            const positions = this.generatePositions(objects.length);

            const wrongAnswers = generateWrongAnswers(targetCount, 3, Math.max(1, targetCount - 3), targetCount + 4);
            const options = shuffle([targetCount, ...wrongAnswers]);

            this.questions.push({
                target,
                targetCount,
                objects: shuffle(objects),
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
                x = padding + Math.random() * (100 - 2 * padding - objSize / 5);
                y = padding + Math.random() * (100 - 2 * padding - objSize / 5);
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


// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
