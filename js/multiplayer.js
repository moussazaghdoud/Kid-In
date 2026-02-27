/* ============================================
   Multiplayer Module
   WebSocket client + Game Wrapper
   ============================================ */

const Multiplayer = {
    ws: null,
    playerId: null,
    roomCode: null,
    players: [],
    isHost: false,
    connected: false,
    connecting: false,
    reconnectAttempts: 0,
    maxReconnectAttempts: 15,
    _keepAliveTimer: null,
    _lastRoomCode: null,
    _lastPlayerName: null,
    _lastAvatar: null,
    _intentionalDisconnect: false,
    _selectedInviteIds: new Set(),
    onRoomCreated: null,
    onRoomJoined: null,
    onRoomError: null,
    onPlayerLeft: null,
    onGameStart: null,
    onGameUpdate: null,
    onGameEnd: null,
    onRtcOffer: null,
    onRtcAnswer: null,
    onRtcIce: null,
    onRtcStart: null,
    onConnectionChange: null,
    onAgeSelected: null,
    // New invite system callbacks
    onOnlineList: null,
    onInviteIncoming: null,
    onInviteAccepted: null,
    onInviteMatched: null,
    onInviteDeclined: null,
    onInviteCancelled: null,
    onInviteTimeout: null,

    connect() {
        if (this.connected || this.connecting) {
            return Promise.resolve();
        }
        this.connecting = true;
        this._intentionalDisconnect = false;

        return new Promise((resolve, reject) => {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const url = `${protocol}//${location.host}/ws`;

            try {
                this.ws = new WebSocket(url);
            } catch (e) {
                this.connecting = false;
                reject(new Error('Connexion impossible'));
                return;
            }

            const connectionTimeout = setTimeout(() => {
                this.connecting = false;
                if (this.ws) {
                    this.ws.close();
                }
                reject(new Error('Délai de connexion dépassé'));
            }, 10000);

            this.ws.onopen = () => {
                clearTimeout(connectionTimeout);
                this.connected = true;
                this.connecting = false;
                this.reconnectAttempts = 0;
                console.log('[Multiplayer] Connected to server');
                if (this.onConnectionChange) this.onConnectionChange(true);
                this._startKeepAlive();
                resolve();
            };

            this.ws.onerror = (err) => {
                clearTimeout(connectionTimeout);
                this.connecting = false;
                console.error('[Multiplayer] WebSocket error:', err);
                reject(new Error('Connexion impossible'));
            };

            this.ws.onclose = (event) => {
                clearTimeout(connectionTimeout);
                this.connected = false;
                this.connecting = false;
                this._stopKeepAlive();
                console.log('[Multiplayer] Disconnected, code:', event.code);
                if (this.onConnectionChange) this.onConnectionChange(false);

                if (this._intentionalDisconnect) return;

                if (this.roomCode) {
                    this._lastRoomCode = this.roomCode;
                }

                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
                    console.log(`[Multiplayer] Reconnecting in ${Math.round(delay)}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                    this.connected = false;
                    this.connecting = false;
                    setTimeout(() => {
                        this.connect().then(() => {
                            if (this._lastRoomCode && this._lastPlayerName) {
                                console.log('[Multiplayer] Attempting to rejoin room:', this._lastRoomCode);
                                this.send({
                                    type: 'room:rejoin',
                                    roomCode: this._lastRoomCode,
                                    playerName: this._lastPlayerName,
                                    avatar: this._lastAvatar
                                });
                            }
                        }).catch(() => {});
                    }, delay);
                } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    if (this._lastRoomCode && this.onPlayerLeft) {
                        this.onPlayerLeft({ disconnected: true, wasInRoom: this._lastRoomCode });
                    }
                    this.roomCode = null;
                    this._lastRoomCode = null;
                }
            };

            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                this._handleMessage(msg);
            };
        });
    },

    _startKeepAlive() {
        this._stopKeepAlive();
        this._keepAliveTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, 10000);
    },

    _stopKeepAlive() {
        if (this._keepAliveTimer) {
            clearInterval(this._keepAliveTimer);
            this._keepAliveTimer = null;
        }
    },

    _handleMessage(msg) {
        switch (msg.type) {
            case 'connected':
                console.log('[Multiplayer] Server confirmed connection, id:', msg.playerId);
                this.playerId = msg.playerId;
                break;

            case 'pong':
                break;

            case 'room:created':
                this.playerId = msg.playerId;
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                this.isHost = true;
                console.log('[Multiplayer] Room created:', msg.roomCode);
                if (this.onRoomCreated) this.onRoomCreated(msg.roomCode);
                break;

            case 'room:joined-ack':
                this.playerId = msg.playerId;
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                this.isHost = false;
                console.log('[Multiplayer] Joined room:', msg.roomCode);
                break;

            case 'room:rejoined':
                this.playerId = msg.playerId;
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                console.log('[Multiplayer] Rejoined room:', msg.roomCode);
                break;

            case 'room:joined':
                this.players = msg.players;
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                console.log('[Multiplayer] Players in room:', this.players.map(p => p.name).join(', '));
                if (this.onRoomJoined) this.onRoomJoined(msg.players);
                break;

            case 'room:error':
                console.log('[Multiplayer] Room error:', msg.message);
                if (this.onRoomError) this.onRoomError(msg.message);
                break;

            case 'room:player-left':
                if (this.onPlayerLeft) this.onPlayerLeft(msg);
                break;

            case 'game:start':
                if (this.onGameStart) this.onGameStart(msg);
                break;

            case 'game:update':
                if (this.onGameUpdate) this.onGameUpdate(msg);
                break;

            case 'game:end':
                if (this.onGameEnd) this.onGameEnd(msg);
                break;

            case 'age:selected':
                if (this.onAgeSelected) this.onAgeSelected(msg);
                break;

            // New invite system messages
            case 'online:list':
                if (this.onOnlineList) this.onOnlineList(msg.players);
                break;

            case 'invite:incoming':
                if (this.onInviteIncoming) this.onInviteIncoming(msg);
                break;

            case 'invite:accepted':
                if (this.onInviteAccepted) this.onInviteAccepted(msg);
                break;

            case 'invite:matched':
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                console.log('[Multiplayer] Invite matched, room:', msg.roomCode);
                if (this.onInviteMatched) this.onInviteMatched(msg);
                break;

            case 'invite:declined':
                if (this.onInviteDeclined) this.onInviteDeclined(msg);
                break;

            case 'invite:cancelled':
                if (this.onInviteCancelled) this.onInviteCancelled(msg);
                break;

            case 'invite:timeout':
                if (this.onInviteTimeout) this.onInviteTimeout(msg);
                break;

            case 'rtc:offer':
                if (this.onRtcOffer) this.onRtcOffer(msg);
                break;

            case 'rtc:answer':
                if (this.onRtcAnswer) this.onRtcAnswer(msg);
                break;

            case 'rtc:ice':
                if (this.onRtcIce) this.onRtcIce(msg);
                break;

            case 'rtc:start':
                console.log('[Multiplayer] All players ready for audio');
                if (this.onRtcStart) this.onRtcStart();
                break;
        }
    },

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    },

    registerOnline(avatar, playerName) {
        this._lastPlayerName = playerName;
        this._lastAvatar = avatar;
        this.send({ type: 'invite:register', playerName, avatar });
    },

    invitePlayers(targetIds) {
        this.send({ type: 'invite:send', targetIds });
    },

    startInvite() {
        this.send({ type: 'invite:start' });
    },

    cancelInvite() {
        this.send({ type: 'invite:cancel' });
    },

    acceptInvite(hostId) {
        this.send({ type: 'invite:accept', hostId });
    },

    declineInvite(hostId) {
        this.send({ type: 'invite:decline', hostId });
    },

    createRoom(playerName, avatar) {
        this._lastPlayerName = playerName;
        this._lastAvatar = avatar;
        this.send({ type: 'room:create', playerName, avatar });
    },

    joinRoom(roomCode, playerName, avatar) {
        const code = roomCode.trim();
        this._lastPlayerName = playerName;
        this._lastAvatar = avatar;
        console.log('[Multiplayer] Sending join request for room:', code);
        this.send({ type: 'room:join', roomCode: code, playerName, avatar });
    },

    leaveRoom() {
        this.send({ type: 'room:leave' });
        this.roomCode = null;
        this._lastRoomCode = null;
        this.players = [];
        this.isHost = false;
    },

    selectAge(age) {
        this.send({ type: 'age:select', age });
    },

    selectGame(game, age, totalQuestions) {
        this.send({ type: 'game:select', game, age, totalQuestions });
    },

    sendAction(actionType, data) {
        this.send({
            type: 'game:action',
            actionType,
            ...data
        });
    },

    sendRtc(type, data, targetId) {
        this.send({ type, data, targetId });
    },

    getPartner() {
        return this.players.find(p => p.id !== this.playerId);
    },

    getOtherPlayers() {
        return this.players.filter(p => p.id !== this.playerId);
    },

    disconnect() {
        this._intentionalDisconnect = true;
        this._stopKeepAlive();
        if (this.ws) {
            this.ws.close(1000, 'User disconnect');
            this.ws = null;
        }
        this.connected = false;
        this.connecting = false;
        this.roomCode = null;
        this._lastRoomCode = null;
        this.players = [];
        this.isHost = false;
        this.playerId = null;
        this.reconnectAttempts = 0;
        this._selectedInviteIds.clear();
    },

    isReady() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
};

// Handle page visibility changes (mobile background/foreground)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (Multiplayer._lastRoomCode && !Multiplayer.connected && !Multiplayer.connecting) {
            console.log('[Multiplayer] Page visible again, reconnecting...');
            Multiplayer.reconnectAttempts = 0;
            Multiplayer.connect().then(() => {
                if (Multiplayer._lastRoomCode && Multiplayer._lastPlayerName) {
                    Multiplayer.send({
                        type: 'room:rejoin',
                        roomCode: Multiplayer._lastRoomCode,
                        playerName: Multiplayer._lastPlayerName,
                        avatar: Multiplayer._lastAvatar
                    });
                }
            }).catch(() => {});
        }
    }
});


/* ============================================
   MultiplayerGameWrapper
   Intercepts game actions for multiplayer sync
   ============================================ */

const MultiplayerGameWrapper = {
    wrap(game) {
        if (!game || !App.isMultiplayer) return game;

        const gameName = game.name;

        if (['math', 'quiz', 'pattern', 'countobj'].includes(gameName)) {
            this._wrapQAGame(game);
        } else if (gameName === 'words') {
            this._wrapWordExplorer(game);
        } else if (gameName === 'memory') {
            this._wrapMemoryMatch(game);
        } else if (gameName === 'colorseq') {
            this._wrapColorSequence(game);
        } else if (gameName === 'draw') {
            this._wrapColorDraw(game);
        } else if (gameName === 'intrus') {
            this._wrapIntrusGame(game);
        } else if (gameName === 'vf') {
            this._wrapVFGame(game);
        } else if (gameName === 'timer') {
            this._wrapTimerGame(game);
        }

        return game;
    },

    _wrapQAGame(game) {
        const origCheckAnswer = game.checkAnswer.bind(game);
        game._multiLocked = false;

        game.checkAnswer = function(btn, selected) {
            if (game._multiLocked) return;
            game._multiLocked = true;

            const q = game.questions[game.current];
            let isCorrect, correctAnswer;

            if (game.name === 'math' || game.name === 'countobj') {
                correctAnswer = game.name === 'countobj' ? q.targetCount : q.answer;
                isCorrect = selected === correctAnswer;
            } else if (game.name === 'quiz') {
                correctAnswer = q.answer;
                isCorrect = selected === correctAnswer;
            } else if (game.name === 'pattern') {
                correctAnswer = q.answer;
                isCorrect = btn.dataset.answer === correctAnswer;
            }

            Multiplayer.sendAction('answer', {
                questionIndex: game.current,
                selected,
                isCorrect,
                correctAnswer
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType !== 'answer') return;
            if (msg.questionIndex !== game.current) return;

            const q = game.questions[game.current];
            const buttons = game.container.querySelectorAll('.answer-btn');
            buttons.forEach(b => b.classList.add('disabled'));

            let clickedBtn = null;
            buttons.forEach(b => {
                const val = game.name === 'pattern' ? b.dataset.answer : parseInt(b.dataset.answer || b.dataset.index);
                if (val === msg.selected || String(val) === String(msg.selected)) {
                    clickedBtn = b;
                }
            });

            if (msg.isCorrect) {
                if (clickedBtn) clickedBtn.classList.add('correct');
                if (msg.playerId === Multiplayer.playerId) game.score++;
                Sound.play('correct');
                App.showFeedback(true);
            } else {
                if (clickedBtn) clickedBtn.classList.add('wrong');
                Sound.play('wrong');
                App.showFeedback(false);
                buttons.forEach(b => {
                    const val = game.name === 'pattern' ? b.dataset.answer : parseInt(b.dataset.answer || b.dataset.index);
                    if (val === msg.correctAnswer || String(val) === String(msg.correctAnswer)) {
                        b.classList.add('correct');
                    }
                });
            }

            // Show who answered with avatar mini-image
            if (clickedBtn && msg.playerId !== Multiplayer.playerId) {
                const indicator = document.createElement('span');
                indicator.className = 'mp-answer-indicator';
                const avatarSrc = App.getAvatarSrc(msg.playerAvatar);
                indicator.innerHTML = `<img src="${avatarSrc}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`;
                clickedBtn.appendChild(indicator);
            }

            if (msg.scores) {
                App._mpScores = msg.scores;
                App.updateMultiplayerScores(msg.scores);
            }

            game._multiLocked = false;

            if (game.name === 'pattern') {
                const mystery = game.container.querySelector('.pattern-item.mystery');
                if (mystery) {
                    mystery.textContent = q.answer;
                    mystery.classList.remove('mystery');
                }
            }

            game.current++;
            setTimeout(() => game.showQuestion(), 1200);
        };
    },

    _wrapIntrusGame(game) {
        const origCheck = game.checkAnswer.bind(game);
        game._multiLocked = false;

        game.checkAnswer = function(btn, selected) {
            if (game._multiLocked) return;
            game._multiLocked = true;

            const q = game.questions[game.current];
            const isCorrect = selected === q.intrus;

            Multiplayer.sendAction('answer', {
                questionIndex: game.current,
                selected,
                isCorrect,
                correctAnswer: q.intrus
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType !== 'answer') return;
            if (msg.questionIndex !== game.current) return;

            const q = game.questions[game.current];
            const items = game.container.querySelectorAll('.intrus-item');
            items.forEach(b => b.classList.add('disabled'));

            if (msg.isCorrect) {
                items[msg.selected].classList.add('correct-intrus');
                if (msg.playerId === Multiplayer.playerId) game.score++;
                Sound.play('correct');
                App.showFeedback(true);
            } else {
                items[msg.selected].classList.add('wrong-intrus');
                Sound.play('wrong');
                App.showFeedback(false);
                items[q.intrus].classList.add('highlight-answer');
            }

            if (msg.scores) {
                App._mpScores = msg.scores;
                App.updateMultiplayerScores(msg.scores);
            }

            game._multiLocked = false;
            game.current++;
            setTimeout(() => game.showQuestion(), 1300);
        };
    },

    _wrapVFGame(game) {
        const origCheck = game.checkAnswer.bind(game);
        game._multiLocked = false;

        game.checkAnswer = function(btn) {
            if (game._multiLocked) return;
            game._multiLocked = true;

            const q = game.questions[game.current];
            const selected = btn.dataset.answer === 'true';
            const isCorrect = selected === q.answer;

            Multiplayer.sendAction('answer', {
                questionIndex: game.current,
                selected: btn.dataset.answer,
                isCorrect,
                correctAnswer: String(q.answer)
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType !== 'answer') return;
            if (msg.questionIndex !== game.current) return;

            const q = game.questions[game.current];
            const buttons = game.container.querySelectorAll('.vf-btn');
            buttons.forEach(b => b.classList.add('disabled'));

            let clickedBtn = null;
            buttons.forEach(b => {
                if (b.dataset.answer === msg.selected) clickedBtn = b;
            });

            if (msg.isCorrect) {
                if (clickedBtn) clickedBtn.classList.add('correct');
                if (msg.playerId === Multiplayer.playerId) game.score++;
                Sound.play('correct');
                App.showFeedback(true);
            } else {
                if (clickedBtn) clickedBtn.classList.add('wrong');
                Sound.play('wrong');
                App.showFeedback(false);
                buttons.forEach(b => {
                    const val = b.dataset.answer === 'true';
                    if (val === q.answer) b.classList.add('correct');
                });
            }

            if (msg.scores) {
                App._mpScores = msg.scores;
                App.updateMultiplayerScores(msg.scores);
            }

            game._multiLocked = false;
            game.current++;
            setTimeout(() => game.showQuestion(), 1300);
        };
    },

    _wrapWordExplorer(game) {
        game._multiLocked = false;

        const origCheck = game.checkAnswer.bind(game);
        game.checkAnswer = function(btn, selected, correct) {
            if (game._multiLocked) return;
            game._multiLocked = true;

            const isCorrect = selected === correct;
            Multiplayer.sendAction('answer', {
                questionIndex: game.current,
                selected,
                isCorrect,
                correctAnswer: correct
            });
        };

        const origBind = game.bindUnscrambleEvents.bind(game);
        game.bindUnscrambleEvents = function(q) {
            origBind(q);
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType === 'answer') {
                if (msg.questionIndex !== game.current) return;

                const q = game.questions[game.current];
                if (q.type === 'startLetter' || q.type === 'fillLetter') {
                    const buttons = game.container.querySelectorAll('.answer-btn');
                    buttons.forEach(b => b.classList.add('disabled'));

                    let clickedBtn = null;
                    buttons.forEach(b => {
                        if (b.dataset.answer === msg.selected) clickedBtn = b;
                    });

                    if (msg.isCorrect) {
                        if (clickedBtn) clickedBtn.classList.add('correct');
                        if (msg.playerId === Multiplayer.playerId) game.score++;
                        Sound.play('correct');
                        App.showFeedback(true);
                    } else {
                        if (clickedBtn) clickedBtn.classList.add('wrong');
                        Sound.play('wrong');
                        App.showFeedback(false);
                        buttons.forEach(b => {
                            if (b.dataset.answer === msg.correctAnswer) b.classList.add('correct');
                        });
                    }

                    if (msg.scores) {
                        App._mpScores = msg.scores;
                        App.updateMultiplayerScores(msg.scores);
                    }

                    game._multiLocked = false;
                    game.current++;
                    setTimeout(() => game.showQuestion(), 1200);
                }
            } else if (msg.actionType === 'unscramble-complete') {
                if (msg.questionIndex !== game.current) return;

                if (msg.isCorrect) {
                    if (msg.playerId === Multiplayer.playerId) game.score++;
                    Sound.play('correct');
                    App.showFeedback(true);
                } else {
                    Sound.play('wrong');
                    App.showFeedback(false);
                }

                if (msg.scores) {
                    App._mpScores = msg.scores;
                    App.updateMultiplayerScores(msg.scores);
                }

                game._multiLocked = false;
                game.current++;
                setTimeout(() => game.showQuestion(), 1000);
            }
        };
    },

    _wrapMemoryMatch(game) {
        game._multiTurn = null;
        game._multiTurnPlayer = Multiplayer.isHost ? Multiplayer.playerId : Multiplayer.getPartner()?.id;

        const origFlip = game.flipCard.bind(game);
        game.flipCard = function(card) {
            if (game.isChecking) return;
            if (card.classList.contains('flipped') || card.classList.contains('matched')) return;
            if (game.flippedCards.length >= 2) return;

            const cardIndex = parseInt(card.dataset.index);
            Multiplayer.sendAction('flip', { cardIndex });
        };

        const origCheckMatch = game.checkMatch.bind(game);
        game.checkMatch = function() {
            game.isChecking = true;
            const [card1, card2] = game.flippedCards;
            const matched = card1.dataset.emoji === card2.dataset.emoji;

            Multiplayer.sendAction('memory-result', {
                matched,
                card1: parseInt(card1.dataset.index),
                card2: parseInt(card2.dataset.index)
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType === 'flip') {
                const card = game.container.querySelector(`.memory-card[data-index="${msg.cardIndex}"]`);
                if (!card || card.classList.contains('flipped') || card.classList.contains('matched')) return;

                Sound.play('flip');
                card.classList.add('flipped');
                game.flippedCards.push(card);

                if (game.flippedCards.length === 2) {
                    game.moves++;
                    const moveEl = document.getElementById('move-count');
                    if (moveEl) moveEl.textContent = game.moves;
                    game.checkMatch();
                }
            } else if (msg.actionType === 'memory-result') {
                const card1El = game.container.querySelector(`.memory-card[data-index="${msg.card1}"]`);
                const card2El = game.container.querySelector(`.memory-card[data-index="${msg.card2}"]`);

                setTimeout(() => {
                    if (msg.matched) {
                        if (card1El) card1El.classList.add('matched');
                        if (card2El) card2El.classList.add('matched');
                        game.matches++;
                        Sound.play('match');
                        const matchEl = document.getElementById('match-count');
                        if (matchEl) matchEl.textContent = game.matches;
                        App.updateGameProgress(game.matches, game.pairs);
                        App.updateGameScore(game.matches);

                        if (game.matches === game.pairs) {
                            setTimeout(() => game.endGame(), 500);
                        }
                    } else {
                        if (card1El) card1El.classList.remove('flipped');
                        if (card2El) card2El.classList.remove('flipped');
                        Sound.play('wrong');
                    }

                    game.flippedCards = [];
                    game.isChecking = false;

                    if (msg.scores) {
                        App._mpScores = msg.scores;
                        App.updateMultiplayerScores(msg.scores);
                    }
                }, msg.matched ? 500 : 1000);
            }
        };
    },

    _wrapColorSequence(game) {
        const origClick = game.handlePlayerClick.bind(game);

        game.handlePlayerClick = function(index) {
            if (!game.isPlayerTurn || game.isPlaying) return;

            const expectedIndex = game.playerSequence.length;
            const expected = game.sequence[expectedIndex];
            const isCorrect = index === expected;
            const roundComplete = isCorrect && (game.playerSequence.length + 1 === game.sequence.length);
            const roundFailed = !isCorrect;

            Multiplayer.sendAction('colorseq-click', {
                colorIndex: index,
                isCorrect,
                roundComplete,
                roundFailed
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType !== 'colorseq-click') return;

            const circles = game.container.querySelectorAll('.cs-circle');
            const circle = circles[msg.colorIndex];
            if (!circle) return;

            circle.classList.add('cs-lit');
            game.playTone(game.allColors[msg.colorIndex].freq, 200);
            setTimeout(() => circle.classList.remove('cs-lit'), 200);

            if (msg.isCorrect) {
                game.playerSequence.push(msg.colorIndex);

                if (msg.roundComplete) {
                    game.score++;
                    game.isPlayerTurn = false;
                    App.updateGameScore(game.score);
                    Sound.play('correct');
                    App.showFeedback(true);

                    const dots = game.container.querySelectorAll('.cs-dot');
                    if (dots[game.round - 1]) dots[game.round - 1].className = 'cs-dot cs-dot-done';

                    if (msg.scores) {
                        App._mpScores = msg.scores;
                        App.updateMultiplayerScores(msg.scores);
                    }

                    if (game.round >= game.maxRounds) {
                        setTimeout(() => game.endGame(), 800);
                    } else {
                        setTimeout(() => game.startNewRound(), 1000);
                    }
                }
            } else if (msg.roundFailed) {
                game.isPlayerTurn = false;
                circle.classList.add('cs-wrong-flash');
                Sound.play('wrong');
                App.showFeedback(false);

                const dots = game.container.querySelectorAll('.cs-dot');
                if (dots[game.round - 1]) dots[game.round - 1].className = 'cs-dot cs-dot-fail';

                setTimeout(() => {
                    circle.classList.remove('cs-wrong-flash');
                    game.endGame();
                }, 1000);
            }
        };
    },

    _wrapTimerGame(game) {
        const origStop = game.stopTimer.bind(game);

        game.stopTimer = function() {
            if (game.stopped) return;
            game.stopped = true;
            clearInterval(game.timerInterval);

            const finalTime = game.elapsed;
            const diff = Math.abs(finalTime - 150000);

            Multiplayer.sendAction('timer-stop', {
                round: game.current,
                time: finalTime,
                diff
            });

            const display = document.getElementById('timer-display');
            if (display) display.textContent = game.formatTime(finalTime);
            const stopBtn = document.getElementById('timer-stop-btn');
            if (stopBtn) stopBtn.style.display = 'none';
            const resultArea = document.getElementById('timer-result-area');
            if (resultArea) {
                resultArea.innerHTML = `<div class="timer-result">Ton temps : ${game.formatTime(finalTime)} \u2014 En attente des autres joueurs...</div>`;
            }
        };

        const origStartRound = game.startRound.bind(game);
        game.startRound = function() {
            if (game.current >= game.total) {
                game.endGame();
                return;
            }
            game.stopped = false;
            game.elapsed = 0;

            game.container.innerHTML = `
                <div class="timer-game">
                    <div class="timer-round-info">Manche ${game.current + 1} / ${game.total}</div>
                    <div class="timer-display-wrapper">
                        <div class="timer-display" id="timer-display">000:00</div>
                        <div class="timer-target">Objectif : <strong>150:00</strong></div>
                    </div>
                    <button class="timer-stop-btn" id="timer-stop-btn">STOP</button>
                    <div class="timer-result-area" id="timer-result-area"></div>
                </div>
            `;

            const stopBtn = document.getElementById('timer-stop-btn');
            stopBtn.addEventListener('click', () => game.stopTimer());

            game.showCountdown(() => {
                game.startTime = performance.now();
                game.timerInterval = setInterval(() => game.updateDisplay(), 10);
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType === 'timer-waiting') {
                // Show waiting count
                const resultArea = document.getElementById('timer-result-area');
                if (resultArea && game.stopped) {
                    const remaining = msg.total - msg.submitted;
                    resultArea.innerHTML = `<div class="timer-result">En attente de ${remaining} joueur${remaining > 1 ? 's' : ''}...</div>`;
                }
                return;
            }

            if (msg.actionType !== 'timer-result') return;

            const resultArea = document.getElementById('timer-result-area');

            // N-player ranked results
            const myId = Multiplayer.playerId;
            const results = msg.results; // already sorted by diff
            const myResult = results.find(r => r.playerId === myId);
            const myRank = results.findIndex(r => r.playerId === myId) + 1;

            if (myRank === 1) {
                Sound.play('correct');
                App.showFeedback(true);
            } else {
                Sound.play('wrong');
                App.showFeedback(false);
            }

            if (resultArea) {
                let html = `<div class="timer-result ${myRank === 1 ? 'timer-great' : 'timer-miss-result'}">
                    ${myRank === 1 ? 'Tu gagnes ce round !' : `#${myRank} ce round`}
                </div>`;
                html += '<div class="timer-rankings">';
                results.forEach((r, i) => {
                    const isMe = r.playerId === myId;
                    html += `<div class="timer-rank-row ${isMe ? 'timer-rank-me' : ''}">
                        <span class="timer-rank-pos">#${i + 1}</span>
                        <img src="${App.getAvatarSrc(r.playerAvatar || '')}" class="timer-rank-avatar" onerror="this.style.display='none'">
                        <span class="timer-rank-name">${r.playerName || 'Joueur'}</span>
                        <span class="timer-rank-time">${game.formatTime(r.time)}</span>
                    </div>`;
                });
                html += '</div>';
                resultArea.innerHTML = html;
            }

            if (msg.scores) {
                App._mpScores = msg.scores;
                App.updateMultiplayerScores(msg.scores);
            }

            game.current++;

            const stopBtn = document.getElementById('timer-stop-btn');
            if (stopBtn) {
                if (game.current < game.total) {
                    stopBtn.textContent = 'Manche suivante';
                    stopBtn.style.display = '';
                    stopBtn.onclick = () => game.startRound();
                } else {
                    stopBtn.textContent = 'Voir les r\u00E9sultats';
                    stopBtn.style.display = '';
                    stopBtn.onclick = () => game.endGame();
                }
            }
        };
    },

    _wrapColorDraw(game) {
        // ===== PICTIONARY WORD BANK =====
        const PICTIONARY_WORDS = {
            simple: [
                { word: 'CHAT', emoji: '\u{1F431}' },
                { word: 'SOLEIL', emoji: '\u{2600}\u{FE0F}' },
                { word: 'MAISON', emoji: '\u{1F3E0}' },
                { word: 'ARBRE', emoji: '\u{1F333}' },
                { word: 'FLEUR', emoji: '\u{1F338}' },
                { word: 'POISSON', emoji: '\u{1F41F}' },
                { word: 'BATEAU', emoji: '\u{26F5}' },
                { word: '\u{00C9}TOILE', emoji: '\u{2B50}' },
                { word: 'LUNE', emoji: '\u{1F319}' },
                { word: 'NUAGE', emoji: '\u{2601}\u{FE0F}' },
                { word: 'OISEAU', emoji: '\u{1F426}' },
                { word: 'POMME', emoji: '\u{1F34E}' },
                { word: 'PAPILLON', emoji: '\u{1F98B}' },
                { word: 'COEUR', emoji: '\u{2764}\u{FE0F}' },
                { word: 'BONBON', emoji: '\u{1F36C}' },
                { word: 'BALLON', emoji: '\u{1F388}' },
                { word: 'G\u{00C2}TEAU', emoji: '\u{1F382}' },
                { word: 'LAPIN', emoji: '\u{1F430}' },
                { word: 'VOITURE', emoji: '\u{1F697}' },
                { word: 'CHIEN', emoji: '\u{1F436}' },
                { word: 'ESCARGOT', emoji: '\u{1F40C}' },
                { word: 'PLUIE', emoji: '\u{1F327}\u{FE0F}' },
                { word: 'BANANE', emoji: '\u{1F34C}' },
                { word: 'BOUGIE', emoji: '\u{1F56F}\u{FE0F}' },
                { word: 'NEIGE', emoji: '\u{2744}\u{FE0F}' }
            ],
            medium: [
                { word: 'GUITARE', emoji: '\u{1F3B8}' },
                { word: 'MONTAGNE', emoji: '\u{26F0}\u{FE0F}' },
                { word: 'PARAPLUIE', emoji: '\u{2602}\u{FE0F}' },
                { word: 'ROBOT', emoji: '\u{1F916}' },
                { word: 'FUS\u{00C9}E', emoji: '\u{1F680}' },
                { word: 'TORTUE', emoji: '\u{1F422}' },
                { word: 'CH\u{00C2}TEAU', emoji: '\u{1F3F0}' },
                { word: 'V\u{00C9}LO', emoji: '\u{1F6B2}' },
                { word: 'DRAGON', emoji: '\u{1F409}' },
                { word: 'CACTUS', emoji: '\u{1F335}' },
                { word: 'AVION', emoji: '\u{2708}\u{FE0F}' },
                { word: 'TRAIN', emoji: '\u{1F682}' },
                { word: 'PIZZA', emoji: '\u{1F355}' },
                { word: 'PIRATE', emoji: '\u{1F3F4}\u{200D}\u{2620}\u{FE0F}' },
                { word: 'GIRAFE', emoji: '\u{1F992}' },
                { word: 'SERPENT', emoji: '\u{1F40D}' },
                { word: 'TAMBOUR', emoji: '\u{1F941}' },
                { word: 'ARAIGN\u{00C9}E', emoji: '\u{1F577}\u{FE0F}' },
                { word: '\u{00CE}LE', emoji: '\u{1F3DD}\u{FE0F}' },
                { word: 'CERF-VOLANT', emoji: '\u{1FA81}' },
                { word: 'REQUIN', emoji: '\u{1F988}' },
                { word: 'HIBOU', emoji: '\u{1F989}' },
                { word: 'PHARE', emoji: '\u{1F6E4}\u{FE0F}' },
                { word: 'IGLOO', emoji: '\u{1F3D8}\u{FE0F}' },
                { word: 'VOLCAN', emoji: '\u{1F30B}' }
            ],
            hard: [
                { word: 'ASTRONAUTE', emoji: '\u{1F468}\u{200D}\u{1F680}' },
                { word: 'TRAMPOLINE', emoji: '\u{1F938}' },
                { word: 'BIBLIOTH\u{00C8}QUE', emoji: '\u{1F4DA}' },
                { word: 'H\u{00C9}LICOPT\u{00C8}RE', emoji: '\u{1F681}' },
                { word: 'SORCI\u{00C8}RE', emoji: '\u{1F9D9}\u{200D}\u{2640}\u{FE0F}' },
                { word: 'DINOSAURE', emoji: '\u{1F995}' },
                { word: 'FONTAINE', emoji: '\u{26F2}' },
                { word: 'PYRAMIDE', emoji: '\u{1F53A}' },
                { word: 'PARACHUTE', emoji: '\u{1FA82}' },
                { word: 'ESCALIER', emoji: '\u{1FA9C}' },
                { word: 'AQUARIUM', emoji: '\u{1F420}' },
                { word: 'COURONNE', emoji: '\u{1F451}' },
                { word: 'FANT\u{00D4}ME', emoji: '\u{1F47B}' },
                { word: 'MOULIN', emoji: '\u{1F3D7}\u{FE0F}' },
                { word: 'TR\u{00C9}SOR', emoji: '\u{1F48E}' },
                { word: 'ORCHESTRE', emoji: '\u{1F3BB}' },
                { word: 'T\u{00C9}LESCOPE', emoji: '\u{1F52D}' },
                { word: 'CATH\u{00C9}DRALE', emoji: '\u{26EA}' },
                { word: 'CALENDRIER', emoji: '\u{1F4C5}' },
                { word: 'CHEMIN\u{00C9}E', emoji: '\u{1F525}' },
                { word: 'BALAN\u{00C7}OIRE', emoji: '\u{1F3A0}' },
                { word: 'BOUSSOLE', emoji: '\u{1F9ED}' },
                { word: 'CHENILLE', emoji: '\u{1F41B}' },
                { word: '\u{00C9}POUVANTAIL', emoji: '\u{1F33E}' },
                { word: 'LABORATOIRE', emoji: '\u{1F52C}' }
            ]
        };

        // ===== GAME STATE =====
        const rng = game._rng;
        const playerOrder = App._mpPlayerOrder || Multiplayer.players.map(p => ({
            id: p.id, name: p.name, avatar: p.avatar
        }));
        const numPlayers = playerOrder.length;
        const roundsPerPlayer = numPlayers <= 2 ? 2 : 1;
        const totalRounds = numPlayers * roundsPerPlayer;
        const ROUND_DURATION = 60;

        // Select words using seeded RNG
        const wordBank = game.age <= 6 ? PICTIONARY_WORDS.simple
                       : game.age <= 8 ? PICTIONARY_WORDS.medium
                       : PICTIONARY_WORDS.hard;
        const shuffledWords = rng.shuffle(wordBank);

        // Pre-compute all rounds
        const rounds = [];
        for (let i = 0; i < totalRounds; i++) {
            const drawerIdx = i % numPlayers;
            const drawer = playerOrder[drawerIdx];
            const secretWord = shuffledWords[i % shuffledWords.length];
            const decoyPool = wordBank.filter(w => w.word !== secretWord.word);
            const shuffledDecoys = rng.shuffle(decoyPool);
            const decoys = shuffledDecoys.slice(0, 4);
            const choices = rng.shuffle([secretWord, ...decoys]);
            rounds.push({ drawer, secretWord, choices });
        }

        // Mutable state
        let currentRound = 0;
        let roundTimer = null;
        let roundTimeLeft = ROUND_DURATION;
        let roundLocked = false;
        let sendTimer = null;
        let currentStroke = null;

        function isDrawer() {
            return rounds[currentRound] && rounds[currentRound].drawer.id === Multiplayer.playerId;
        }

        function clearRoundTimer() {
            if (roundTimer) { clearInterval(roundTimer); roundTimer = null; }
        }

        function startRoundTimer() {
            roundTimeLeft = ROUND_DURATION;
            const timerEl = game.container.querySelector('.pictionary-timer-value');
            if (timerEl) timerEl.textContent = roundTimeLeft;

            roundTimer = setInterval(() => {
                roundTimeLeft--;
                const el = game.container.querySelector('.pictionary-timer-value');
                if (el) el.textContent = roundTimeLeft;
                if (roundTimeLeft <= 10) {
                    const tw = game.container.querySelector('.pictionary-timer');
                    if (tw) tw.classList.add('pictionary-timer-urgent');
                }
                if (roundTimeLeft <= 0) {
                    clearRoundTimer();
                    if (isDrawer() && !roundLocked) {
                        Multiplayer.sendAction('pictionary-timeout', {
                            roundIndex: currentRound,
                            correctAnswer: rounds[currentRound].secretWord.word
                        });
                    }
                }
            }, 1000);
        }

        // ===== DRAWER UI =====
        function renderDrawerUI(round) {
            const colors = [
                '#FF6B6B', '#FF8A5C', '#FFE66D', '#51CF66', '#4ECDC4',
                '#339AF0', '#6C63FF', '#9775FA', '#FF6B9D', '#2d3436',
                '#FFFFFF', '#8B4513'
            ];
            game.container.innerHTML = `
                <div class="pictionary-container">
                    <div class="pictionary-header">
                        <div class="pictionary-round-info">Manche ${currentRound + 1} / ${totalRounds}</div>
                        <div class="pictionary-timer">
                            <span class="pictionary-timer-icon">\u{23F1}</span>
                            <span class="pictionary-timer-value">${ROUND_DURATION}</span>s
                        </div>
                    </div>
                    <div class="pictionary-secret-word">
                        <span class="pictionary-label">Dessine :</span>
                        <span class="pictionary-word">${round.secretWord.emoji} ${round.secretWord.word}</span>
                    </div>
                    <div class="draw-toolbar">
                        <div class="color-palette">
                            ${colors.map(c =>
                                `<div class="color-swatch ${c === game.color ? 'active' : ''}"
                                     data-color="${c}"
                                     style="background:${c};${c === '#FFFFFF' ? 'border:2px solid #ccc;' : ''}"></div>`
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
                    </div>
                    <div class="canvas-wrapper">
                        <canvas id="draw-canvas" width="700" height="450"></canvas>
                    </div>
                    <div class="encouragement">Les autres joueurs essaient de deviner ton dessin !</div>
                </div>
            `;

            game.canvas = document.getElementById('draw-canvas');
            game.ctx = game.canvas.getContext('2d');
            game.ctx.fillStyle = '#FFFFFF';
            game.ctx.fillRect(0, 0, game.canvas.width, game.canvas.height);
            game.history = [];
            game.saveState();
            game.isEraser = false;
            game.color = '#FF6B6B';
            game.brushSize = 8;

            game.bindDrawEvents();
            bindStrokeSending();
        }

        // ===== GUESSER UI =====
        function renderGuesserUI(round) {
            const drawerAvatar = App.getAvatarSrc(round.drawer.avatar);
            game.container.innerHTML = `
                <div class="pictionary-container">
                    <div class="pictionary-header">
                        <div class="pictionary-round-info">Manche ${currentRound + 1} / ${totalRounds}</div>
                        <div class="pictionary-timer">
                            <span class="pictionary-timer-icon">\u{23F1}</span>
                            <span class="pictionary-timer-value">${ROUND_DURATION}</span>s
                        </div>
                    </div>
                    <div class="pictionary-drawer-info">
                        <img src="${drawerAvatar}" class="pictionary-drawer-avatar" alt="${round.drawer.name}">
                        <span>${round.drawer.name} dessine...</span>
                    </div>
                    <div class="canvas-wrapper">
                        <canvas id="draw-canvas" width="700" height="450"></canvas>
                    </div>
                    <div class="pictionary-choices">
                        ${round.choices.map((c, idx) =>
                            `<button class="pictionary-choice-btn" data-word="${c.word}" data-index="${idx}">
                                ${c.emoji} ${c.word}
                            </button>`
                        ).join('')}
                    </div>
                </div>
            `;

            game.canvas = document.getElementById('draw-canvas');
            game.ctx = game.canvas.getContext('2d');
            game.ctx.fillStyle = '#FFFFFF';
            game.ctx.fillRect(0, 0, game.canvas.width, game.canvas.height);

            // Remove crosshair cursor for guessers (read-only canvas)
            const wrapper = game.container.querySelector('.canvas-wrapper');
            if (wrapper) wrapper.style.cursor = 'default';

            game.container.querySelectorAll('.pictionary-choice-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    if (roundLocked) return;
                    roundLocked = true;
                    const selected = btn.dataset.word;
                    const isCorrect = selected === round.secretWord.word;
                    Sound.play('click');
                    Multiplayer.sendAction('pictionary-guess', {
                        roundIndex: currentRound,
                        selected,
                        isCorrect,
                        correctAnswer: round.secretWord.word,
                        drawerId: round.drawer.id
                    });
                });
            });
        }

        // ===== STROKE SENDING (drawer only) =====
        function bindStrokeSending() {
            const canvas = game.canvas;
            const trackStroke = (e) => {
                if (!game.isDrawing) return;
                const r = canvas.getBoundingClientRect();
                const scaleX = canvas.width / r.width;
                const scaleY = canvas.height / r.height;
                let x, y;
                if (e.touches) {
                    x = (e.touches[0].clientX - r.left) * scaleX;
                    y = (e.touches[0].clientY - r.top) * scaleY;
                } else {
                    x = (e.clientX - r.left) * scaleX;
                    y = (e.clientY - r.top) * scaleY;
                }
                if (currentStroke) {
                    currentStroke.points.push({ x, y });
                    if (!sendTimer) {
                        sendTimer = setTimeout(() => {
                            if (currentStroke && currentStroke.points.length > 0) {
                                Multiplayer.sendAction('draw-stroke', {
                                    stroke: {
                                        color: game.isEraser ? 'eraser' : game.color,
                                        size: game.brushSize,
                                        points: [...currentStroke.points]
                                    }
                                });
                            }
                            sendTimer = null;
                        }, 50);
                    }
                }
            };
            const startStroke = () => { currentStroke = { points: [] }; };
            const endStroke = () => {
                if (currentStroke && currentStroke.points.length > 0) {
                    Multiplayer.sendAction('draw-stroke', {
                        stroke: {
                            color: game.isEraser ? 'eraser' : game.color,
                            size: game.brushSize,
                            points: currentStroke.points
                        }
                    });
                }
                currentStroke = null;
            };
            canvas.addEventListener('mousedown', startStroke);
            canvas.addEventListener('mousemove', trackStroke);
            canvas.addEventListener('mouseup', endStroke);
            canvas.addEventListener('touchstart', startStroke, { passive: true });
            canvas.addEventListener('touchmove', trackStroke, { passive: true });
            canvas.addEventListener('touchend', endStroke);
        }

        // ===== STROKE RECEIVING (guesser canvas) =====
        function applyStroke(stroke) {
            if (!game.ctx) return;
            const ctx = game.ctx;
            if (stroke.points.length < 2) return;
            ctx.lineWidth = stroke.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (stroke.color === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.strokeStyle = 'rgba(0,0,0,1)';
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = stroke.color;
            }
            ctx.beginPath();
            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        // ===== START ROUND =====
        function startRound() {
            if (currentRound >= totalRounds) {
                endPictionary();
                return;
            }
            roundLocked = false;
            const round = rounds[currentRound];
            App.updateGameProgress(currentRound + 1, totalRounds);

            if (isDrawer()) {
                renderDrawerUI(round);
            } else {
                renderGuesserUI(round);
            }
            startRoundTimer();
        }

        // ===== SHOW ROUND RESULT =====
        function showRoundResult(isCorrect, guesserId, guesserName, correctWord) {
            clearRoundTimer();
            const round = rounds[currentRound];

            // Highlight correct choice for guessers
            const buttons = game.container.querySelectorAll('.pictionary-choice-btn');
            buttons.forEach(btn => {
                btn.classList.add('disabled');
                if (btn.dataset.word === correctWord) {
                    btn.classList.add('correct');
                }
            });

            // Result banner
            const banner = document.createElement('div');
            banner.className = 'pictionary-result-banner';
            if (isCorrect) {
                if (guesserId === Multiplayer.playerId) {
                    banner.innerHTML = '<span class="pictionary-result-correct">Bravo ! Tu as devin\u{00E9} !</span>';
                } else if (isDrawer()) {
                    banner.innerHTML = `<span class="pictionary-result-correct">${guesserName} a devin\u{00E9} ton dessin !</span>`;
                } else {
                    banner.innerHTML = `<span class="pictionary-result-other">${guesserName} a devin\u{00E9} en premier !</span>`;
                }
                Sound.play('correct');
                App.showFeedback(true);
            } else {
                banner.innerHTML = `<span class="pictionary-result-timeout">Temps \u{00E9}coul\u{00E9} ! C'\u{00E9}tait : ${round.secretWord.emoji} ${correctWord}</span>`;
                Sound.play('wrong');
                App.showFeedback(false);
            }

            const container = game.container.querySelector('.pictionary-container');
            if (container) container.appendChild(banner);

            currentRound++;
            setTimeout(() => startRound(), 2500);
        }

        // ===== END GAME =====
        function endPictionary() {
            clearRoundTimer();
            game.score = 0;
            const scores = App._mpScores;
            if (scores && scores[Multiplayer.playerId] != null) {
                game.score = scores[Multiplayer.playerId];
            }
            const maxPossible = totalRounds * 2;
            const ratio = maxPossible > 0 ? game.score / maxPossible : 0;
            const stars = ratio >= 0.6 ? 3 : ratio >= 0.35 ? 2 : ratio > 0 ? 1 : 0;
            App.addStars('draw', stars);
            App.showModal(
                'Pictionary termin\u{00E9} !',
                `Tu as marqu\u{00E9} ${game.score} point${game.score > 1 ? 's' : ''} !`,
                '',
                stars
            );
        }

        // Cleanup timer on game exit
        const origCleanup = game.cleanup ? game.cleanup.bind(game) : () => {};
        game.cleanup = function() {
            clearRoundTimer();
            origCleanup();
        };

        // ===== MULTIPLAYER MESSAGE HANDLER =====
        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType === 'draw-stroke') {
                if (msg.playerId === Multiplayer.playerId) return;
                applyStroke(msg.stroke);
                return;
            }
            if (msg.actionType === 'pictionary-guess') {
                if (msg.roundIndex !== currentRound) return;
                roundLocked = true;
                if (msg.scores) {
                    App._mpScores = msg.scores;
                    App.updateMultiplayerScores(msg.scores);
                }
                showRoundResult(msg.isCorrect, msg.playerId, msg.playerName, msg.correctAnswer);
                return;
            }
            if (msg.actionType === 'pictionary-timeout') {
                if (msg.roundIndex !== currentRound) return;
                roundLocked = true;
                if (msg.scores) {
                    App._mpScores = msg.scores;
                    App.updateMultiplayerScores(msg.scores);
                }
                showRoundResult(false, null, null, msg.correctAnswer);
                return;
            }
        };

        // ===== KICK OFF FIRST ROUND =====
        startRound();
    }
};
