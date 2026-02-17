const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ==================== MAINTENANCE MODE ====================
const MAINTENANCE_MODE = false; // Set to true to block access

if (MAINTENANCE_MODE) {
    app.use((req, res) => {
        res.status(503).send('\u{1F6A7} Site temporairement indisponible - Maintenance en cours');
    });
}

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')));

// ==================== ROOM MANAGEMENT ====================
const rooms = new Map();
const MAX_ROOM_SIZE = 6;

// ==================== ONLINE PLAYERS & INVITE SYSTEM ====================
const onlinePlayers = new Map();  // playerId -> { ws, playerName, avatar }
const pendingInvites = new Map(); // hostPlayerId -> { hostWs, hostName, hostAvatar, targetIds: [], accepted: [], timeout }

function broadcastOnlineList() {
    const list = [];
    for (const [playerId, data] of onlinePlayers.entries()) {
        if (data.ws.readyState === 1) {
            list.push({ id: playerId, name: data.playerName, avatar: data.avatar });
        }
    }
    const msg = JSON.stringify({ type: 'online:list', players: list });
    for (const [, data] of onlinePlayers.entries()) {
        if (data.ws.readyState === 1) {
            data.ws.send(msg);
        }
    }
}

function removeOnlinePlayer(ws) {
    if (ws.playerId && onlinePlayers.has(ws.playerId)) {
        onlinePlayers.delete(ws.playerId);
        console.log(`[Server] ${ws.playerName || ws.playerId} went offline`);
        broadcastOnlineList();
    }
    // Cancel any pending invites from or to this player
    cleanupInvitesForPlayer(ws.playerId);
}

function cleanupInvitesForPlayer(playerId) {
    // If this player was a host
    const invite = pendingInvites.get(playerId);
    if (invite) {
        clearTimeout(invite.timeout);
        // Notify all targets that invite was cancelled
        for (const targetId of invite.targetIds) {
            const targetData = onlinePlayers.get(targetId);
            if (targetData) {
                sendTo(targetData.ws, { type: 'invite:cancelled' });
            }
        }
        pendingInvites.delete(playerId);
    }
    // If this player was a target in someone's invite
    for (const [hostId, inv] of pendingInvites.entries()) {
        const idx = inv.targetIds.indexOf(playerId);
        if (idx !== -1) {
            // Notify host that this player declined (disconnected)
            sendTo(inv.hostWs, { type: 'invite:declined', playerId, playerName: '' });
        }
    }
}

function generateRoomCode() {
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
    if (ws && ws.readyState === 1) {
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
                ws.playerAvatar = msg.avatar || 'isaac';
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

                const room = rooms.get(roomCode);
                if (!room) {
                    sendTo(ws, { type: 'room:error', message: 'Salle introuvable' });
                    break;
                }
                if (room.players.length >= MAX_ROOM_SIZE) {
                    sendTo(ws, { type: 'room:error', message: 'Salle pleine (max 6)' });
                    break;
                }

                ws.playerName = msg.playerName || 'Joueur';
                ws.playerAvatar = msg.avatar || 'isaac';
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
                    existing.ws = ws;
                    existing.id = ws.playerId;
                    ws.playerName = msg.playerName;
                    ws.playerAvatar = msg.avatar || existing.avatar;
                    ws.roomCode = roomCode;
                    console.log(`[Server] Player ${msg.playerName} rejoined room ${roomCode}`);
                    sendTo(ws, { type: 'room:rejoined', playerId: ws.playerId, roomCode });
                    broadcastRoomState(roomCode);
                } else if (room.players.length < MAX_ROOM_SIZE) {
                    ws.playerName = msg.playerName || 'Joueur';
                    ws.playerAvatar = msg.avatar || 'isaac';
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

            // ---- Online/Invite System ----
            case 'invite:register': {
                ws.playerName = msg.playerName || 'Joueur';
                ws.playerAvatar = msg.avatar || 'isaac';
                onlinePlayers.set(ws.playerId, { ws, playerName: ws.playerName, avatar: ws.playerAvatar });
                console.log(`[Server] ${ws.playerName} (${ws.playerId}) registered online`);
                broadcastOnlineList();
                break;
            }

            case 'invite:send': {
                const targetIds = msg.targetIds || []; // array of playerIds to invite (up to 5)
                if (targetIds.length === 0 || targetIds.length > 5) break;

                // Clean up any existing invite from this host
                cleanupInvitesForPlayer(ws.playerId);

                const timeout = setTimeout(() => {
                    sendTo(ws, { type: 'invite:timeout' });
                    pendingInvites.delete(ws.playerId);
                }, 60000);

                pendingInvites.set(ws.playerId, {
                    hostWs: ws,
                    hostName: ws.playerName,
                    hostAvatar: ws.playerAvatar,
                    targetIds,
                    accepted: [],
                    timeout
                });

                // Notify each target
                for (const targetId of targetIds) {
                    const targetData = onlinePlayers.get(targetId);
                    if (targetData && targetData.ws.readyState === 1) {
                        sendTo(targetData.ws, {
                            type: 'invite:incoming',
                            hostId: ws.playerId,
                            hostName: ws.playerName,
                            hostAvatar: ws.playerAvatar
                        });
                    }
                }

                console.log(`[Server] ${ws.playerName} invited ${targetIds.length} player(s)`);
                break;
            }

            case 'invite:accept': {
                const hostId = msg.hostId;
                const invite = pendingInvites.get(hostId);
                if (!invite) break;

                // Add this player to accepted list
                if (!invite.accepted.find(a => a.id === ws.playerId)) {
                    invite.accepted.push({
                        id: ws.playerId,
                        name: ws.playerName,
                        avatar: ws.playerAvatar,
                        ws
                    });
                }

                // Notify host
                sendTo(invite.hostWs, {
                    type: 'invite:accepted',
                    playerId: ws.playerId,
                    playerName: ws.playerName,
                    acceptedCount: invite.accepted.length,
                    totalInvited: invite.targetIds.length
                });

                console.log(`[Server] ${ws.playerName} accepted invite from ${invite.hostName} (${invite.accepted.length}/${invite.targetIds.length})`);
                break;
            }

            case 'invite:decline': {
                const hostId = msg.hostId;
                const invite = pendingInvites.get(hostId);
                if (!invite) break;

                sendTo(invite.hostWs, {
                    type: 'invite:declined',
                    playerId: ws.playerId,
                    playerName: ws.playerName
                });

                console.log(`[Server] ${ws.playerName} declined invite from ${invite.hostName}`);
                break;
            }

            case 'invite:cancel': {
                cleanupInvitesForPlayer(ws.playerId);
                console.log(`[Server] ${ws.playerName} cancelled invite`);
                break;
            }

            case 'invite:start': {
                // Host starts the room with all accepted players
                const invite = pendingInvites.get(ws.playerId);
                if (!invite || invite.accepted.length === 0) break;

                clearTimeout(invite.timeout);

                // Create room
                let code = generateRoomCode();
                while (rooms.has(code)) code = generateRoomCode();

                const allPlayers = [
                    {
                        id: ws.playerId,
                        name: ws.playerName,
                        avatar: ws.playerAvatar,
                        ws,
                        score: 0
                    }
                ];

                for (const acc of invite.accepted) {
                    allPlayers.push({
                        id: acc.id,
                        name: acc.name,
                        avatar: acc.avatar,
                        ws: acc.ws,
                        score: 0
                    });
                    acc.ws.roomCode = code;
                }

                ws.roomCode = code;

                rooms.set(code, {
                    code,
                    host: ws.playerId,
                    players: allPlayers,
                    gameState: null,
                    lockedActions: new Set()
                });

                console.log(`[Server] Invite matched! Room ${code} with ${allPlayers.length} players`);

                // Notify all players
                const matchMsg = { type: 'invite:matched', roomCode: code };
                allPlayers.forEach(p => sendTo(p.ws, matchMsg));
                broadcastRoomState(code);

                // Remove from online list (they're in a room now)
                pendingInvites.delete(ws.playerId);
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

                // For timer game stops - N player support
                if (msg.actionType === 'timer-stop') {
                    if (!room.gameState._timerRounds) room.gameState._timerRounds = {};
                    const roundKey = `round-${msg.round}`;
                    if (!room.gameState._timerRounds[roundKey]) room.gameState._timerRounds[roundKey] = [];

                    // Prevent duplicate submissions from same player
                    if (room.gameState._timerRounds[roundKey].find(r => r.playerId === ws.playerId)) break;

                    room.gameState._timerRounds[roundKey].push({
                        playerId: ws.playerId,
                        playerName: ws.playerName,
                        playerAvatar: ws.playerAvatar,
                        time: msg.time,
                        diff: msg.diff
                    });

                    const submissions = room.gameState._timerRounds[roundKey];
                    const totalPlayers = room.players.length;

                    if (submissions.length < totalPlayers) {
                        // Not everyone has submitted yet - broadcast waiting status
                        const waitingMsg = {
                            type: 'game:update',
                            actionType: 'timer-waiting',
                            submitted: submissions.length,
                            total: totalPlayers
                        };
                        room.players.forEach(p => sendTo(p.ws, waitingMsg));
                    } else {
                        // All players submitted - sort by diff (closest to 10s first)
                        const results = [...submissions].sort((a, b) => a.diff - b.diff);
                        const winner = results[0];
                        const tie = results.length >= 2 && results[0].diff === results[1].diff;
                        if (!tie) {
                            room.gameState.scores[winner.playerId] = (room.gameState.scores[winner.playerId] || 0) + 1;
                        }

                        const update = {
                            type: 'game:update',
                            actionType: 'timer-result',
                            results,
                            winnerId: tie ? null : winner.playerId,
                            scores: room.gameState.scores
                        };
                        room.players.forEach(p => sendTo(p.ws, update));
                    }
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

            // ---- WebRTC Signaling (targeted for mesh) ----
            case 'rtc:offer':
            case 'rtc:answer':
            case 'rtc:ice': {
                if (msg.targetId) {
                    // Targeted signaling for mesh audio
                    const room = rooms.get(ws.roomCode);
                    if (!room) break;
                    const target = room.players.find(p => p.id === msg.targetId);
                    if (target) {
                        sendTo(target.ws, {
                            type: msg.type,
                            data: msg.data,
                            from: ws.playerId
                        });
                    }
                } else {
                    // Legacy broadcast (2-player fallback)
                    broadcastToRoom(ws.roomCode, {
                        type: msg.type,
                        data: msg.data,
                        from: ws.playerId
                    }, ws);
                }
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
