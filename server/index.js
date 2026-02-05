const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')));

// ==================== ROOM MANAGEMENT ====================
const rooms = new Map();

function generateRoomCode() {
    // Simple 3-digit code (000-999)
    const code = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return code;
}

function generateSeed() {
    return Math.floor(Math.random() * 2147483647);
}

function broadcastToRoom(roomCode, message, excludeWs) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const data = JSON.stringify(message);
    room.players.forEach(player => {
        if (player.ws !== excludeWs && player.ws.readyState === 1) {
            player.ws.send(data);
        }
    });
}

function sendTo(ws, message) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

function broadcastRoomState(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const playerList = room.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar
    }));
    const msg = { type: 'room:joined', players: playerList, roomCode };
    room.players.forEach(p => sendTo(p.ws, msg));
}

function removePlayerFromRoom(ws) {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;

    room.players = room.players.filter(p => p.ws !== ws);

    if (room.players.length === 0) {
        rooms.delete(ws.roomCode);
    } else {
        broadcastToRoom(ws.roomCode, {
            type: 'room:player-left',
            playerId: ws.playerId,
            playerName: ws.playerName
        });
        broadcastRoomState(ws.roomCode);
    }
}

// ==================== WEBSOCKET HANDLER ====================
wss.on('connection', (ws) => {
    ws.playerId = uuidv4();
    ws.isAlive = true;

    console.log(`[Server] New connection: ${ws.playerId}`);

    // Send immediate confirmation to client
    sendTo(ws, { type: 'connected', playerId: ws.playerId });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }

        switch (msg.type) {
            // ---- Room Management ----
            case 'room:create': {
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();

                ws.playerName = msg.playerName || 'Joueur';
                ws.playerAvatar = msg.avatar || 'izaac';
                ws.roomCode = code;

                rooms.set(code, {
                    code,
                    host: ws.playerId,
                    players: [{
                        id: ws.playerId,
                        name: ws.playerName,
                        avatar: ws.playerAvatar,
                        ws,
                        score: 0
                    }],
                    gameState: null,
                    lockedActions: new Set()
                });

                sendTo(ws, { type: 'room:created', roomCode: code, playerId: ws.playerId });
                break;
            }

            case 'room:join': {
                const room = rooms.get(msg.roomCode);
                if (!room) {
                    sendTo(ws, { type: 'room:error', message: 'Salle introuvable' });
                    break;
                }
                if (room.players.length >= 2) {
                    sendTo(ws, { type: 'room:error', message: 'Salle pleine' });
                    break;
                }

                ws.playerName = msg.playerName || 'Joueur';
                ws.playerAvatar = msg.avatar || 'aissa';
                ws.roomCode = msg.roomCode;

                room.players.push({
                    id: ws.playerId,
                    name: ws.playerName,
                    avatar: ws.playerAvatar,
                    ws,
                    score: 0
                });

                sendTo(ws, { type: 'room:joined-ack', playerId: ws.playerId, roomCode: msg.roomCode });
                broadcastRoomState(msg.roomCode);
                break;
            }

            case 'room:leave': {
                removePlayerFromRoom(ws);
                ws.roomCode = null;
                break;
            }

            // ---- Game Management ----
            case 'game:select': {
                const room = rooms.get(ws.roomCode);
                if (!room) break;
                if (room.host !== ws.playerId) break;

                const seed = generateSeed();
                room.gameState = {
                    game: msg.game,
                    age: msg.age,
                    seed,
                    scores: {},
                    currentQuestion: 0,
                    totalQuestions: msg.totalQuestions || 10
                };
                room.lockedActions = new Set();
                room.players.forEach(p => {
                    room.gameState.scores[p.id] = 0;
                });

                const startMsg = {
                    type: 'game:start',
                    game: msg.game,
                    age: msg.age,
                    seed,
                    totalQuestions: room.gameState.totalQuestions
                };
                room.players.forEach(p => sendTo(p.ws, startMsg));
                break;
            }

            case 'game:action': {
                const room = rooms.get(ws.roomCode);
                if (!room || !room.gameState) break;

                const actionKey = `${msg.actionType}:${msg.questionIndex}`;

                // For Q&A games, first-click-wins
                if (msg.actionType === 'answer') {
                    if (room.lockedActions.has(actionKey)) {
                        // Already answered by someone
                        break;
                    }
                    room.lockedActions.add(actionKey);

                    if (msg.isCorrect) {
                        room.gameState.scores[ws.playerId] = (room.gameState.scores[ws.playerId] || 0) + 1;
                    }

                    const update = {
                        type: 'game:update',
                        actionType: 'answer',
                        playerId: ws.playerId,
                        playerName: ws.playerName,
                        playerAvatar: ws.playerAvatar,
                        questionIndex: msg.questionIndex,
                        selected: msg.selected,
                        isCorrect: msg.isCorrect,
                        correctAnswer: msg.correctAnswer,
                        scores: room.gameState.scores
                    };
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                // For memory game card flips
                if (msg.actionType === 'flip') {
                    const update = {
                        type: 'game:update',
                        actionType: 'flip',
                        playerId: ws.playerId,
                        playerName: ws.playerName,
                        cardIndex: msg.cardIndex
                    };
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                // For memory match results
                if (msg.actionType === 'memory-result') {
                    if (msg.matched) {
                        room.gameState.scores[ws.playerId] = (room.gameState.scores[ws.playerId] || 0) + 1;
                    }
                    const update = {
                        type: 'game:update',
                        actionType: 'memory-result',
                        playerId: ws.playerId,
                        matched: msg.matched,
                        card1: msg.card1,
                        card2: msg.card2,
                        scores: room.gameState.scores
                    };
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                // For color sequence clicks
                if (msg.actionType === 'colorseq-click') {
                    const update = {
                        type: 'game:update',
                        actionType: 'colorseq-click',
                        playerId: ws.playerId,
                        colorIndex: msg.colorIndex,
                        isCorrect: msg.isCorrect,
                        roundComplete: msg.roundComplete,
                        roundFailed: msg.roundFailed
                    };
                    if (msg.roundComplete && msg.isCorrect) {
                        room.gameState.scores[ws.playerId] = (room.gameState.scores[ws.playerId] || 0) + 1;
                    }
                    update.scores = room.gameState.scores;
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                // For draw strokes
                if (msg.actionType === 'draw-stroke') {
                    broadcastToRoom(ws.roomCode, {
                        type: 'game:update',
                        actionType: 'draw-stroke',
                        playerId: ws.playerId,
                        stroke: msg.stroke
                    }, ws);
                    break;
                }

                // For word explorer letter clicks
                if (msg.actionType === 'letter-click') {
                    if (room.lockedActions.has(actionKey)) break;

                    const update = {
                        type: 'game:update',
                        actionType: 'letter-click',
                        playerId: ws.playerId,
                        playerName: ws.playerName,
                        questionIndex: msg.questionIndex,
                        letterIdx: msg.letterIdx,
                        letter: msg.letter
                    };
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                // For word unscramble completion
                if (msg.actionType === 'unscramble-complete') {
                    if (room.lockedActions.has(actionKey)) break;
                    room.lockedActions.add(actionKey);

                    if (msg.isCorrect) {
                        room.gameState.scores[ws.playerId] = (room.gameState.scores[ws.playerId] || 0) + 1;
                    }

                    const update = {
                        type: 'game:update',
                        actionType: 'unscramble-complete',
                        playerId: ws.playerId,
                        playerName: ws.playerName,
                        questionIndex: msg.questionIndex,
                        isCorrect: msg.isCorrect,
                        scores: room.gameState.scores
                    };
                    room.players.forEach(p => sendTo(p.ws, update));
                    break;
                }

                break;
            }

            case 'game:end': {
                const room = rooms.get(ws.roomCode);
                if (!room || !room.gameState) break;

                const endMsg = {
                    type: 'game:end',
                    scores: room.gameState.scores,
                    game: room.gameState.game
                };
                room.players.forEach(p => sendTo(p.ws, endMsg));
                room.gameState = null;
                room.lockedActions = new Set();
                break;
            }

            // ---- WebRTC Signaling ----
            case 'rtc:offer':
            case 'rtc:answer':
            case 'rtc:ice': {
                broadcastToRoom(ws.roomCode, {
                    type: msg.type,
                    data: msg.data,
                    from: ws.playerId
                }, ws);
                break;
            }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`[Server] Connection closed: ${ws.playerId}, code: ${code}`);
        removePlayerFromRoom(ws);
    });

    ws.on('error', (err) => {
        console.error(`[Server] Connection error: ${ws.playerId}`, err.message);
        removePlayerFromRoom(ws);
    });
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            removePlayerFromRoom(ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Kid-in server running on port ${PORT}`);
});
