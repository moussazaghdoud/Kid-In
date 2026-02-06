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

// ==================== CALL SYSTEM ====================
const onlinePlayers = new Map();  // character -> { ws, playerName, avatar }
const pendingCalls = new Map();   // callerId -> { callerWs, targetCharacter, timeout }

function cleanupCall(callerPlayerId) {
    const call = pendingCalls.get(callerPlayerId);
    if (call) {
        clearTimeout(call.timeout);
        pendingCalls.delete(callerPlayerId);
    }
}

function removeOnlinePlayer(ws) {
    for (const [character, data] of onlinePlayers.entries()) {
        if (data.ws === ws) {
            onlinePlayers.delete(character);
            console.log(`[Server] ${character} went offline`);
            break;
        }
    }
    // Cancel any pending calls involving this player
    for (const [callerId, call] of pendingCalls.entries()) {
        if (call.callerWs === ws) {
            // Caller disconnected - notify target
            const targetData = onlinePlayers.get(call.targetCharacter);
            if (targetData) {
                sendTo(targetData.ws, { type: 'call:cancelled' });
            }
            cleanupCall(callerId);
        }
    }
    // Check if someone was calling this player
    for (const [callerId, call] of pendingCalls.entries()) {
        const targetData = onlinePlayers.get(call.targetCharacter);
        if (targetData && targetData.ws === ws) {
            // Target disconnected - notify caller
            sendTo(call.callerWs, { type: 'call:cancelled' });
            cleanupCall(callerId);
        }
    }
}

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
    ws.missedPings = 0;

    console.log(`[Server] New connection: ${ws.playerId}`);

    // Send immediate confirmation to client
    sendTo(ws, { type: 'connected', playerId: ws.playerId });

    ws.on('pong', () => {
        ws.isAlive = true;
        ws.missedPings = 0;
    });

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }

        // Any message from client proves it's alive
        ws.isAlive = true;
        ws.missedPings = 0;

        switch (msg.type) {
            // ---- Keep-alive ----
            case 'ping': {
                sendTo(ws, { type: 'pong' });
                break;
            }

            // ---- Room Management ----
            case 'room:create': {
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();

                console.log(`[Server] Creating room ${code} for player ${ws.playerId}`);

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
                const roomCode = String(msg.roomCode).trim();
                console.log(`[Server] Player ${ws.playerId} trying to join room: "${roomCode}"`);
                console.log(`[Server] Available rooms:`, Array.from(rooms.keys()));

                const room = rooms.get(roomCode);
                if (!room) {
                    console.log(`[Server] Room "${roomCode}" not found`);
                    sendTo(ws, { type: 'room:error', message: 'Salle introuvable' });
                    break;
                }
                if (room.players.length >= 2) {
                    console.log(`[Server] Room "${roomCode}" is full`);
                    sendTo(ws, { type: 'room:error', message: 'Salle pleine' });
                    break;
                }

                ws.playerName = msg.playerName || 'Joueur';
                ws.playerAvatar = msg.avatar || 'aissa';
                ws.roomCode = roomCode;

                room.players.push({
                    id: ws.playerId,
                    name: ws.playerName,
                    avatar: ws.playerAvatar,
                    ws,
                    score: 0
                });

                console.log(`[Server] Player ${ws.playerName} joined room ${roomCode}. Players: ${room.players.length}`);
                sendTo(ws, { type: 'room:joined-ack', playerId: ws.playerId, roomCode: roomCode });
                broadcastRoomState(roomCode);
                break;
            }

            // Rejoin after reconnection - swap the WebSocket reference
            case 'room:rejoin': {
                const roomCode = String(msg.roomCode).trim();
                const room = rooms.get(roomCode);
                if (!room) {
                    sendTo(ws, { type: 'room:error', message: 'Salle introuvable' });
                    break;
                }

                // Find existing player slot by name (since playerId changed on reconnect)
                const existing = room.players.find(p => p.name === msg.playerName);
                if (existing) {
                    // Swap WebSocket reference to the new connection
                    existing.ws = ws;
                    existing.id = ws.playerId;
                    ws.playerName = msg.playerName;
                    ws.playerAvatar = msg.avatar || existing.avatar;
                    ws.roomCode = roomCode;
                    console.log(`[Server] Player ${msg.playerName} rejoined room ${roomCode}`);
                    sendTo(ws, { type: 'room:rejoined', playerId: ws.playerId, roomCode });
                    broadcastRoomState(roomCode);
                } else if (room.players.length < 2) {
                    // Player slot was already cleaned up, join fresh
                    ws.playerName = msg.playerName || 'Joueur';
                    ws.playerAvatar = msg.avatar || 'aissa';
                    ws.roomCode = roomCode;
                    room.players.push({
                        id: ws.playerId,
                        name: ws.playerName,
                        avatar: ws.playerAvatar,
                        ws,
                        score: 0
                    });
                    sendTo(ws, { type: 'room:rejoined', playerId: ws.playerId, roomCode });
                    broadcastRoomState(roomCode);
                } else {
                    sendTo(ws, { type: 'room:error', message: 'Salle pleine' });
                }
                break;
            }

            case 'room:leave': {
                removePlayerFromRoom(ws);
                ws.roomCode = null;
                break;
            }

            // ---- Call System ----
            case 'call:register': {
                const character = msg.character; // 'izaac' or 'aissa'
                ws.playerName = msg.playerName || character;
                ws.playerAvatar = character;
                onlinePlayers.set(character, { ws, playerName: ws.playerName, avatar: character });
                console.log(`[Server] ${character} (${ws.playerName}) registered online`);

                // Check if someone is waiting to call this character
                for (const [callerId, call] of pendingCalls.entries()) {
                    if (call.targetCharacter === character) {
                        // Ring the newly registered player
                        console.log(`[Server] ${call.callerName} was waiting - now ringing ${character}`);
                        sendTo(call.callerWs, { type: 'call:ringing', targetCharacter: character });
                        sendTo(ws, {
                            type: 'call:incoming',
                            callerCharacter: call.callerCharacter,
                            callerName: call.callerName
                        });
                        break;
                    }
                }
                break;
            }

            case 'call:initiate': {
                const targetCharacter = msg.targetCharacter; // 'izaac' or 'aissa'
                const targetData = onlinePlayers.get(targetCharacter);

                // Clean up any existing call from this caller
                cleanupCall(ws.playerId);

                if (!targetData || targetData.ws.readyState !== 1) {
                    // Target not online - wait for them
                    console.log(`[Server] ${ws.playerName} calling ${targetCharacter} (not online yet - waiting)`);
                    const timeout = setTimeout(() => {
                        sendTo(ws, { type: 'call:timeout' });
                        pendingCalls.delete(ws.playerId);
                    }, 60000);

                    pendingCalls.set(ws.playerId, {
                        callerWs: ws,
                        callerCharacter: ws.playerAvatar,
                        callerName: ws.playerName,
                        targetCharacter,
                        timeout
                    });
                    sendTo(ws, { type: 'call:waiting', targetCharacter });
                } else {
                    // Target is online - ring them
                    console.log(`[Server] ${ws.playerName} calling ${targetCharacter} (online - ringing)`);
                    const timeout = setTimeout(() => {
                        sendTo(ws, { type: 'call:timeout' });
                        sendTo(targetData.ws, { type: 'call:cancelled' });
                        pendingCalls.delete(ws.playerId);
                    }, 60000);

                    pendingCalls.set(ws.playerId, {
                        callerWs: ws,
                        callerCharacter: ws.playerAvatar,
                        callerName: ws.playerName,
                        targetCharacter,
                        timeout
                    });
                    sendTo(ws, { type: 'call:ringing', targetCharacter });
                    sendTo(targetData.ws, {
                        type: 'call:incoming',
                        callerCharacter: ws.playerAvatar,
                        callerName: ws.playerName
                    });
                }
                break;
            }

            case 'call:cancel': {
                const call = pendingCalls.get(ws.playerId);
                if (call) {
                    const targetData = onlinePlayers.get(call.targetCharacter);
                    if (targetData) {
                        sendTo(targetData.ws, { type: 'call:cancelled' });
                    }
                    cleanupCall(ws.playerId);
                    console.log(`[Server] ${ws.playerName} cancelled call`);
                }
                break;
            }

            case 'call:accept': {
                // Find the pending call targeting this player's character
                let foundCallerId = null;
                for (const [callerId, call] of pendingCalls.entries()) {
                    if (call.targetCharacter === ws.playerAvatar) {
                        foundCallerId = callerId;
                        break;
                    }
                }

                if (!foundCallerId) {
                    console.log(`[Server] No pending call found for ${ws.playerAvatar}`);
                    break;
                }

                const call = pendingCalls.get(foundCallerId);
                cleanupCall(foundCallerId);

                // Create a room for the matched players
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();

                const callerWs = call.callerWs;
                callerWs.roomCode = code;
                ws.roomCode = code;

                rooms.set(code, {
                    code,
                    host: callerWs.playerId,
                    players: [
                        {
                            id: callerWs.playerId,
                            name: call.callerName,
                            avatar: call.callerCharacter,
                            ws: callerWs,
                            score: 0
                        },
                        {
                            id: ws.playerId,
                            name: ws.playerName,
                            avatar: ws.playerAvatar,
                            ws,
                            score: 0
                        }
                    ],
                    gameState: null,
                    lockedActions: new Set()
                });

                console.log(`[Server] Call matched! Room ${code} created for ${call.callerName} and ${ws.playerName}`);

                // Notify both players
                sendTo(callerWs, { type: 'call:matched', roomCode: code });
                sendTo(ws, { type: 'call:matched', roomCode: code });
                broadcastRoomState(code);
                break;
            }

            case 'call:decline': {
                // Find the pending call targeting this player's character
                for (const [callerId, call] of pendingCalls.entries()) {
                    if (call.targetCharacter === ws.playerAvatar) {
                        sendTo(call.callerWs, { type: 'call:declined', targetCharacter: ws.playerAvatar });
                        cleanupCall(callerId);
                        console.log(`[Server] ${ws.playerName} declined call from ${call.callerName}`);
                        break;
                    }
                }
                break;
            }

            // ---- Age Selection (host broadcasts to room) ----
            case 'age:select': {
                const room = rooms.get(ws.roomCode);
                if (!room) break;
                if (room.host !== ws.playerId) break;

                const ageMsg = {
                    type: 'age:selected',
                    age: msg.age
                };
                room.players.forEach(p => sendTo(p.ws, ageMsg));
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
        removeOnlinePlayer(ws);
        removePlayerFromRoom(ws);
    });

    ws.on('error', (err) => {
        console.error(`[Server] Connection error: ${ws.playerId}`, err.message);
        removeOnlinePlayer(ws);
        removePlayerFromRoom(ws);
    });
});

// Heartbeat - tolerant: allow 2 missed pings before terminating
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            ws.missedPings = (ws.missedPings || 0) + 1;
            if (ws.missedPings >= 3) {
                console.log(`[Server] Terminating dead connection: ${ws.playerId} (${ws.missedPings} missed pings)`);
                removePlayerFromRoom(ws);
                return ws.terminate();
            }
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 15000);

wss.on('close', () => clearInterval(heartbeat));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Kid-in server running on port ${PORT}`);
});
