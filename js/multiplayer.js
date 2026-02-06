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
    _lastRoomCode: null,   // Remember room for rejoin after reconnect
    _lastPlayerName: null,
    _lastAvatar: null,
    _intentionalDisconnect: false,
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
    onConnectionChange: null,
    onCallRinging: null,
    onCallWaiting: null,
    onCallIncoming: null,
    onCallMatched: null,
    onCallDeclined: null,
    onCallCancelled: null,
    onCallTimeout: null,
    onAgeSelected: null,

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

                // Don't auto-reconnect if user intentionally disconnected
                if (this._intentionalDisconnect) return;

                // Remember room info for rejoin (don't clear it!)
                if (this.roomCode) {
                    this._lastRoomCode = this.roomCode;
                }

                // Auto-reconnect with exponential backoff
                if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 15000);
                    console.log(`[Multiplayer] Reconnecting in ${Math.round(delay)}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
                    this.connected = false;
                    this.connecting = false;
                    setTimeout(() => {
                        this.connect().then(() => {
                            // After reconnect, try to rejoin the room
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
                    // All retries exhausted - notify player
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

    // Client-side keep-alive ping every 10s
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
                // Keep-alive response, connection is healthy
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

            case 'call:ringing':
                if (this.onCallRinging) this.onCallRinging(msg);
                break;

            case 'call:waiting':
                if (this.onCallWaiting) this.onCallWaiting(msg);
                break;

            case 'call:incoming':
                if (this.onCallIncoming) this.onCallIncoming(msg);
                break;

            case 'call:matched':
                this.roomCode = msg.roomCode;
                this._lastRoomCode = msg.roomCode;
                console.log('[Multiplayer] Call matched, room:', msg.roomCode);
                if (this.onCallMatched) this.onCallMatched(msg);
                break;

            case 'call:declined':
                if (this.onCallDeclined) this.onCallDeclined(msg);
                break;

            case 'call:cancelled':
                if (this.onCallCancelled) this.onCallCancelled(msg);
                break;

            case 'call:timeout':
                if (this.onCallTimeout) this.onCallTimeout(msg);
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
        }
    },

    send(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    },

    registerOnline(character, playerName) {
        this._lastPlayerName = playerName;
        this._lastAvatar = character;
        this.send({ type: 'call:register', character, playerName });
    },

    initiateCall(targetCharacter) {
        this.send({ type: 'call:initiate', targetCharacter });
    },

    cancelCall() {
        this.send({ type: 'call:cancel' });
    },

    acceptCall() {
        this.send({ type: 'call:accept' });
    },

    declineCall() {
        this.send({ type: 'call:decline' });
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

    sendRtc(type, data) {
        this.send({ type, data });
    },

    getPartner() {
        return this.players.find(p => p.id !== this.playerId);
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
    },

    isReady() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
};

// Handle page visibility changes (mobile background/foreground)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Page came back to foreground - check if we need to reconnect
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

        // Wrap Q&A style games (math, quiz, intrus, vf, pattern, countobj)
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

            // Show who answered
            if (clickedBtn && msg.playerId !== Multiplayer.playerId) {
                const indicator = document.createElement('span');
                indicator.className = 'mp-answer-indicator';
                indicator.textContent = msg.playerAvatar === 'izaac' ? '👦' : '👧';
                clickedBtn.appendChild(indicator);
            }

            // Update multiplayer scores display
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

        // Wrap checkAnswer for startLetter and fillLetter modes
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

        // Wrap unscramble events
        const origBind = game.bindUnscrambleEvents.bind(game);
        game.bindUnscrambleEvents = function(q) {
            origBind(q);
            // The original already bound events, but we override the completion logic
            // by adding a mutation observer approach - simpler to just let both sides
            // track letters and the completion sends the answer
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
        game._multiTurn = null; // whose turn it is (alternate)
        game._multiTurnPlayer = Multiplayer.isHost ? Multiplayer.playerId : Multiplayer.getPartner()?.id;

        const origFlip = game.flipCard.bind(game);
        game.flipCard = function(card) {
            if (game.isChecking) return;
            if (card.classList.contains('flipped') || card.classList.contains('matched')) return;
            if (game.flippedCards.length >= 2) return;

            const cardIndex = parseInt(card.dataset.index);

            // Send flip to server
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

    _wrapColorDraw(game) {
        // Batch stroke sending for performance
        let strokeBuffer = [];
        let sendTimer = null;

        const origBindDraw = game.bindDrawEvents.bind(game);
        game.bindDrawEvents = function() {
            origBindDraw();

            // Add partner canvas overlay
            const wrapper = game.container.querySelector('.canvas-wrapper');
            if (wrapper) {
                const partnerCanvas = document.createElement('canvas');
                partnerCanvas.id = 'partner-draw-canvas';
                partnerCanvas.width = 700;
                partnerCanvas.height = 450;
                partnerCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
                wrapper.style.position = 'relative';
                wrapper.appendChild(partnerCanvas);
                game._partnerCtx = partnerCanvas.getContext('2d');
            }

            // Intercept draw to broadcast strokes
            const canvas = game.canvas;

            const origStartDraw = canvas.onmousedown;
            let currentStroke = null;

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

                    // Batch send every 50ms
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

            canvas.addEventListener('mousedown', () => {
                currentStroke = { points: [] };
            });
            canvas.addEventListener('mousemove', trackStroke);
            canvas.addEventListener('mouseup', () => {
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
            });

            canvas.addEventListener('touchstart', () => {
                currentStroke = { points: [] };
            }, { passive: true });
            canvas.addEventListener('touchmove', trackStroke, { passive: true });
            canvas.addEventListener('touchend', () => {
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
            });
        };

        Multiplayer.onGameUpdate = function(msg) {
            if (msg.actionType !== 'draw-stroke') return;
            if (!game._partnerCtx) return;

            const ctx = game._partnerCtx;
            const stroke = msg.stroke;

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
        };
    }
};
