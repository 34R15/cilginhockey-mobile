const express = require('express');
const app = express();
const http = require('http').createServer(app);
// Allowed origins: set ALLOWED_ORIGINS env (comma separated) in production, defaults to localhost in dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ["http://localhost:3000"];

const io = require('socket.io')(http, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});
const path = require('path');

// Lightweight logger: silence verbose logs in production (NODE_ENV=production)
const DEBUG = process.env.NODE_ENV !== 'production';
const log = (...args) => { if (DEBUG) console.log(...args); };

// Serve static files from project root (index.html, game.js, assets/)
// NOTE: this exposes the entire parent directory; keep only public assets there.
app.use(express.static(path.join(__dirname, '..')));

// ───────────────────────────────────────────────────────────────────────────
//  AUTHORITATIVE PHYSICS — all gameplay runs here, in a fixed virtual field.
//  Clients only send paddle input and render the state the server broadcasts.
// ───────────────────────────────────────────────────────────────────────────
const TICK_HZ = 60;
const FIELD_W = 900;          // virtual field width  (9:16 to match client canvas)
const FIELD_H = 1600;         // virtual field height
const PADDLE_R = FIELD_W * 0.1;
const PUCK_R = PADDLE_R * 0.5;
const FRICTION = 0.992;       // per-tick friction
const MAX_PUCK_SPEED = 28;    // virtual px / tick
const MIN_PUCK_SPEED = 4;     // floor while moving
const GOAL_WIDTH_RATIO = 0.66;
const GOAL_BAND = 34;         // depth of the goal mouth band (virtual px)
const SERVE_SPEED = 9;        // initial serve speed after a goal / kickoff

const rooms = new Map();
const socketToRoom = new Map();
const disconnectTimers = new Map();
const REJOIN_GRACE_MS = 20000;

// ── Bot / AI opponent profiles ──────────────────────────────────────────────
// speed  : max virtual px the bot paddle can travel per tick
// react  : 0–1 multiplier on how decisively it moves toward its target
// errorPx: random target offset so weaker bots misjudge and miss
const BOT_PROFILES = {
    easy:   { speed: 7,  react: 0.55, errorPx: 75 },
    medium: { speed: 12, react: 0.82, errorPx: 32 },
    hard:   { speed: 19, react: 1.0,  errorPx: 0  }
};
const BOT_HOME_Y = PADDLE_R * 2.2;   // bot's defensive resting line (near its goal)
const BOT_SENTINEL = 'BOT';          // placeholder socket id for the AI "guest"

// ── Quick-match (random matchmaking) ────────────────────────────────────────
const matchQueue = [];               // [{ id, name }] players waiting for a random opponent
const QUICK_MATCH_SCORE_LIMIT = 5;
const QUICK_MATCH_COURT = 'full';

function removeFromQueue(socketId) {
    const i = matchQueue.findIndex(e => e.id === socketId);
    if (i !== -1) matchQueue.splice(i, 1);
}

// Input flood protection: drop paddle inputs that arrive faster than this.
// Physics runs at 60Hz, so accepting more than ~125 inputs/sec is pointless;
// anything faster is either jitter or a malicious flood.
const MIN_INPUT_INTERVAL_MS = 8;   // ~125 inputs/sec ceiling per socket
const lastInputAt = new Map();     // socket.id -> last accepted input timestamp

function getMemberRoom(socket, roomId) {
    if (socketToRoom.get(socket.id) !== roomId) return null;
    const room = rooms.get(roomId);
    if (!room) return null;
    if (room.host !== socket.id && room.guest !== socket.id) return null;
    return room;
}

function freshPhysics() {
    return {
        puck: { x: FIELD_W / 2, y: FIELD_H / 2, vx: 0, vy: 0 },
        // p1 = bottom (green), p2 = top (red); lastX/Y used to derive paddle velocity
        p1: { x: FIELD_W / 2, y: FIELD_H - PADDLE_R * 2, lastX: FIELD_W / 2, lastY: FIELD_H - PADDLE_R * 2 },
        p2: { x: FIELD_W / 2, y: PADDLE_R * 2, lastX: FIELD_W / 2, lastY: PADDLE_R * 2 },
        score: { player1: 0, player2: 0 }
    };
}

// Serve the puck toward a random player with a slight horizontal angle
function servePuck(phys, towardPlayer) {
    phys.puck.x = FIELD_W / 2;
    phys.puck.y = FIELD_H / 2;
    const dir = towardPlayer === 1 ? 1 : -1; // +y goes down toward player 1
    const angle = (Math.random() - 0.5) * 0.6;
    phys.puck.vx = Math.sin(angle) * SERVE_SPEED;
    phys.puck.vy = Math.cos(angle) * SERVE_SPEED * dir;
}

// Clamp a paddle target to its allowed region given court type
function clampPaddle(player, courtType, x, y) {
    const cx = Math.min(Math.max(x, PADDLE_R), FIELD_W - PADDLE_R);
    let cy;
    if (courtType === 'half') {
        cy = player === 1
            ? Math.min(Math.max(y, FIELD_H / 2), FIELD_H - PADDLE_R)
            : Math.min(Math.max(y, PADDLE_R), FIELD_H / 2);
    } else {
        cy = Math.min(Math.max(y, PADDLE_R), FIELD_H - PADDLE_R);
    }
    return { x: cx, y: cy };
}

// Resolve a puck/paddle collision, mutating the puck.
// Returns 'contact' (overlapping this tick) so the caller can detect rising edges.
// The bounce impulse is only applied on a *new* contact (paddle.wasContact === false),
// so resting a paddle on the puck doesn't re-launch it or spam the hit sound every tick.
function resolvePaddle(puck, paddle) {
    const dx = puck.x - paddle.x;
    const dy = puck.y - paddle.y;
    const dist = Math.hypot(dx, dy);
    const minDist = PUCK_R + PADDLE_R;
    if (dist >= minDist) return false;

    // Contact normal. If the paddle is exactly centered on the puck (dist 0),
    // fall back to the paddle's travel direction, else push the puck away from
    // the paddle's own side so it always gets launched.
    let angle;
    if (dist > 0.0001) {
        angle = Math.atan2(dy, dx);
    } else {
        const pvx = paddle.x - paddle.lastX;
        const pvy = paddle.y - paddle.lastY;
        angle = (Math.abs(pvx) + Math.abs(pvy) > 0.01)
            ? Math.atan2(pvy, pvx)
            : Math.atan2(FIELD_H / 2 - paddle.y, 0.0001); // toward field center
    }
    // Always push the puck to the paddle edge so it can't get stuck inside
    puck.x = paddle.x + Math.cos(angle) * minDist;
    puck.y = paddle.y + Math.sin(angle) * minDist;

    if (paddle.wasContact) return true; // already touching — no new impulse

    const pvx = paddle.x - paddle.lastX;
    const pvy = paddle.y - paddle.lastY;
    const paddleSpeed = Math.hypot(pvx, pvy);
    const impactForce = Math.min(Math.max(paddleSpeed / 5, 0.6), 2.2);
    const currentSpeed = Math.hypot(puck.vx, puck.vy);
    let newSpeed = Math.max(currentSpeed, 11) * impactForce + paddleSpeed * 1.4;
    newSpeed = Math.min(newSpeed, MAX_PUCK_SPEED);

    const jitter = (Math.random() - 0.5) * 0.18;
    const a = angle + jitter;
    puck.vx = Math.cos(a) * newSpeed;
    puck.vy = Math.sin(a) * newSpeed;
    return true;
}

// Push two paddles apart when they overlap. Neither paddle acquires velocity from
// this — they simply can't occupy the same space.
function resolvePaddles(pa, pb) {
    const dx   = pb.x - pa.x;
    const dy   = pb.y - pa.y;
    const dist = Math.hypot(dx, dy);
    const min  = PADDLE_R * 2;
    if (dist >= min || dist < 0.0001) return;

    // Overlap amount split evenly between both paddles
    const overlap = (min - dist) / 2;
    const nx = dx / dist;
    const ny = dy / dist;
    pa.x -= nx * overlap;
    pa.y -= ny * overlap;
    pb.x += nx * overlap;
    pb.y += ny * overlap;
}

// Drive the AI paddle (always player 2 / top). Called once per tick before stepRoom,
// so the movement it makes this tick becomes its paddle velocity for hit impulses.
function updateBot(room) {
    const p = room.phys;
    const prof = room.bot.profile;
    const puck = p.puck;
    const bot = p.p2;

    let tx, ty;
    const puckInBotHalf = puck.y < FIELD_H / 2;
    if (puckInBotHalf && puck.vy < 1.5) {
        // Attack: slip just above the puck and shove it down toward the player.
        tx = puck.x;
        ty = puck.y - (PUCK_R + PADDLE_R) * 0.55;
    } else {
        // Defend: fall back to the goal line, mirroring the puck's x to block.
        tx = puck.x;
        ty = BOT_HOME_Y;
    }

    // Weaker bots aim imperfectly
    if (prof.errorPx) {
        tx += (Math.random() - 0.5) * prof.errorPx;
        ty += (Math.random() - 0.5) * prof.errorPx * 0.5;
    }

    // Move toward the target, capped by the profile's max speed
    const dx = tx - bot.x;
    const dy = ty - bot.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01) {
        const step = Math.min(dist, prof.speed) * prof.react;
        bot.x += (dx / dist) * step;
        bot.y += (dy / dist) * step;
    }

    // Keep the bot inside its allowed half/region
    const pos = clampPaddle(2, room.courtType, bot.x, bot.y);
    bot.x = pos.x;
    bot.y = pos.y;
}

function broadcastState(room) {
    const p = room.phys;
    io.to(room.id).emit('state', {
        puck: { x: p.puck.x / FIELD_W, y: p.puck.y / FIELD_H },
        p1: { x: p.p1.x / FIELD_W, y: p.p1.y / FIELD_H },
        p2: { x: p.p2.x / FIELD_W, y: p.p2.y / FIELD_H },
        score: p.score,
        puckSpeed: Math.hypot(p.puck.vx, p.puck.vy) / MAX_PUCK_SPEED  // normalized 0–1
    });
}

function stepRoom(room) {
    const p = room.phys;
    const puck = p.puck;
    const goalW = FIELD_W * GOAL_WIDTH_RATIO;
    const goalStart = (FIELD_W - goalW) / 2;
    const goalEnd = goalStart + goalW;

    // Integrate
    puck.x += puck.vx;
    puck.y += puck.vy;

    // Paddle–paddle collision: push them apart so they can't overlap.
    resolvePaddles(p.p1, p.p2);

    // Paddle–puck collisions (server is the only authority — no client conflict).
    // Emit 'hit' only on a rising edge (new contact), not every overlapping tick.
    const c1 = resolvePaddle(puck, p.p1);
    const c2 = resolvePaddle(puck, p.p2);
    // Tell clients which paddle was hit so each can flash the correct one.
    if (c1 && !p.p1.wasContact) io.to(room.id).emit('hit', { player: 1 });
    if (c2 && !p.p2.wasContact) io.to(room.id).emit('hit', { player: 2 });
    p.p1.wasContact = c1;
    p.p2.wasContact = c2;

    // Friction
    const speed = Math.hypot(puck.vx, puck.vy);
    if (speed > 0.2) {
        puck.vx *= FRICTION;
        puck.vy *= FRICTION;
        if (speed > MAX_PUCK_SPEED) {
            const s = MAX_PUCK_SPEED / speed;
            puck.vx *= s; puck.vy *= s;
        }
    } else {
        puck.vx = 0; puck.vy = 0;
    }

    // Side walls
    if (puck.x - PUCK_R < 0) { puck.x = PUCK_R; puck.vx = Math.abs(puck.vx) * 0.9; }
    if (puck.x + PUCK_R > FIELD_W) { puck.x = FIELD_W - PUCK_R; puck.vx = -Math.abs(puck.vx) * 0.9; }

    // Top: goal if within mouth, else wall bounce
    if (puck.y - PUCK_R < 0) {
        if (puck.x > goalStart && puck.x < goalEnd) { scoreGoal(room, 1); return; }
        puck.y = PUCK_R; puck.vy = Math.abs(puck.vy) * 0.9;
    }
    // Bottom: goal if within mouth, else wall bounce
    if (puck.y + PUCK_R > FIELD_H) {
        if (puck.x > goalStart && puck.x < goalEnd) { scoreGoal(room, 2); return; }
        puck.y = FIELD_H - PUCK_R; puck.vy = -Math.abs(puck.vy) * 0.9;
    }

    broadcastState(room);
}

function scoreGoal(room, scorer) {
    const p = room.phys;
    if (scorer === 1) p.score.player1++; else p.score.player2++;
    log(`Goal in ${room.id} by player ${scorer}: ${p.score.player1}-${p.score.player2}`);

    io.to(room.id).emit('goal', { scorer, score: p.score });

    if (p.score.player1 >= room.scoreLimit || p.score.player2 >= room.scoreLimit) {
        const winner = p.score.player1 > p.score.player2 ? 1 : 2;
        room.gameOver = true;
        stopLoop(room);
        io.to(room.id).emit('gameOver', { winner });
        // Clean up shortly after
        setTimeout(() => destroyRoom(room.id), 8000);
        return;
    }

    // Reset for next point: brief pause, then serve toward the player who was scored on
    servePuck(p, scorer === 1 ? 2 : 1);
    p.puck.vx = 0; p.puck.vy = 0; // hold still during the kickoff pause
    broadcastState(room);
    if (room.serveTimer) clearTimeout(room.serveTimer);
    room.serveTimer = setTimeout(() => {
        if (rooms.get(room.id) === room && !room.gameOver) {
            servePuck(p, scorer === 1 ? 2 : 1);
        }
    }, 1200);
}

function startLoop(room) {
    if (room.loop) return;
    room.gameOver = false;
    // Kickoff: the puck rests at center; whoever reaches it first puts it in play
    // (like real air hockey). This avoids serving the puck past a player who has
    // not engaged yet right after the countdown.
    room.phys.puck.x = FIELD_W / 2;
    room.phys.puck.y = FIELD_H / 2;
    room.phys.puck.vx = 0;
    room.phys.puck.vy = 0;
    room.phys.p1.wasContact = false;
    room.phys.p2.wasContact = false;
    room.loop = setInterval(() => {
        // Isolate each room: an error in one room's physics must not crash the whole
        // server (which would drop every other live game). Kill just the bad room.
        try {
            const p = room.phys;
            if (room.bot) updateBot(room);   // move the AI paddle before physics integration
            stepRoom(room);
            p.p1.lastX = p.p1.x; p.p1.lastY = p.p1.y;
            p.p2.lastX = p.p2.x; p.p2.lastY = p.p2.y;
        } catch (err) {
            console.error('Physics error in room', room.id, err);
            io.to(room.id).emit('roomError', 'Oyunda bir hata oluştu');
            destroyRoom(room.id);
        }
    }, 1000 / TICK_HZ);
    log('Physics loop started for room', room.id);
}

function stopLoop(room) {
    if (room.loop) { clearInterval(room.loop); room.loop = null; }
    if (room.serveTimer) { clearTimeout(room.serveTimer); room.serveTimer = null; }
}

function destroyRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    stopLoop(room);
    if (room.host) socketToRoom.delete(room.host);
    if (room.guest) socketToRoom.delete(room.guest);
    const t = disconnectTimers.get(roomId);
    if (t) { clearTimeout(t); disconnectTimers.delete(roomId); }
    rooms.delete(roomId);
}

function maybeStart(room) {
    // Start once both players are present and both have finished their countdown
    if (room.host && room.guest && room.ready1 && room.ready2 && !room.gameOver) {
        startLoop(room);
    }
}

io.on('connection', (socket) => {
    log('User connected:', socket.id);
    socket.emit('connected', { id: socket.id });

    socket.on('createRoom', (data) => {
        const { roomId, playerName, scoreLimit, courtType } = data || {};
        if (!roomId) return;
        if (rooms.has(roomId)) { socket.emit('roomError', 'Room already exists'); return; }

        const safeScoreLimit = [3, 5, 7, 10].includes(Number(scoreLimit)) ? Number(scoreLimit) : 5;
        const room = {
            id: roomId,
            host: socket.id,
            hostName: playerName,
            guest: null,
            guestName: null,
            scoreLimit: safeScoreLimit,
            courtType: courtType === 'half' ? 'half' : 'full',
            gameOver: false,
            ready1: false,
            ready2: false,
            loop: null,
            serveTimer: null,
            phys: freshPhysics()
        };
        rooms.set(roomId, room);
        socketToRoom.set(socket.id, roomId);
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
        log('Room created:', roomId);
    });

    // Single-player: create a room whose "guest" is a server-side AI.
    socket.on('createBotRoom', (data) => {
        const { playerName, scoreLimit, courtType, difficulty } = data || {};
        const safeScoreLimit = [3, 5, 7, 10].includes(Number(scoreLimit)) ? Number(scoreLimit) : 5;
        const profile = BOT_PROFILES[difficulty] || BOT_PROFILES.medium;

        // Generate a unique, non-colliding room id (prefixed so it never clashes with
        // the 4-digit human codes).
        let roomId;
        do { roomId = 'bot-' + Math.random().toString(36).slice(2, 8); } while (rooms.has(roomId));

        const room = {
            id: roomId,
            host: socket.id,
            hostName: playerName,
            guest: BOT_SENTINEL,            // AI occupies the guest slot
            guestName: 'Bilgisayar',
            scoreLimit: safeScoreLimit,
            courtType: courtType === 'half' ? 'half' : 'full',
            gameOver: false,
            ready1: false,
            ready2: true,                   // the bot is always "ready"
            loop: null,
            serveTimer: null,
            bot: { difficulty: BOT_PROFILES[difficulty] ? difficulty : 'medium', profile },
            phys: freshPhysics()
        };
        rooms.set(roomId, room);
        socketToRoom.set(socket.id, roomId);
        socket.join(roomId);
        socket.emit('botGameStart', {
            roomId,
            scoreLimit: safeScoreLimit,
            courtType: room.courtType,
            botName: room.guestName
        });
        log('Bot room created:', roomId, 'difficulty:', room.bot.difficulty);
    });

    // Quick-match: pair with a random waiting opponent, or wait in the queue.
    socket.on('quickMatch', (data) => {
        const playerName = (data && data.playerName) || 'Oyuncu';
        // Already in a room? ignore.
        if (socketToRoom.has(socket.id)) return;
        // Already queued? just re-confirm searching.
        if (matchQueue.some(e => e.id === socket.id)) { socket.emit('searchingMatch'); return; }

        // Find a still-connected waiting opponent (skip stale entries).
        let opp = null;
        while (matchQueue.length > 0) {
            const candidate = matchQueue.shift();
            if (candidate.id !== socket.id && io.sockets.sockets.get(candidate.id)) { opp = candidate; break; }
        }

        if (!opp) {
            matchQueue.push({ id: socket.id, name: playerName });
            socket.emit('searchingMatch');
            log('Queued for quick match:', socket.id);
            return;
        }

        // Pair them — opponent is host (player 1), the new arrival is guest (player 2).
        let roomId;
        do { roomId = 'qm-' + Math.random().toString(36).slice(2, 8); } while (rooms.has(roomId));

        const room = {
            id: roomId,
            host: opp.id,
            hostName: opp.name,
            guest: socket.id,
            guestName: playerName,
            scoreLimit: QUICK_MATCH_SCORE_LIMIT,
            courtType: QUICK_MATCH_COURT,
            gameOver: false,
            ready1: false,
            ready2: false,
            loop: null,
            serveTimer: null,
            phys: freshPhysics()
        };
        rooms.set(roomId, room);
        socketToRoom.set(opp.id, roomId);
        socketToRoom.set(socket.id, roomId);
        const oppSocket = io.sockets.sockets.get(opp.id);
        if (oppSocket) oppSocket.join(roomId);
        socket.join(roomId);

        // Tell each side who they are, then start.
        io.to(opp.id).emit('matchFound', {
            roomId, playerNumber: 1, opponentName: playerName,
            scoreLimit: room.scoreLimit, courtType: room.courtType
        });
        socket.emit('matchFound', {
            roomId, playerNumber: 2, opponentName: opp.name,
            scoreLimit: room.scoreLimit, courtType: room.courtType
        });
        io.to(roomId).emit('gameStart');
        log('Quick match paired:', opp.id, '<->', socket.id, 'room', roomId);
    });

    socket.on('cancelMatch', () => {
        removeFromQueue(socket.id);
        log('Quick match cancelled:', socket.id);
    });

    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data || {};
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) { socket.emit('roomError', 'Room does not exist'); return; }
        if (room.guest) { socket.emit('roomError', 'Room is full'); return; }

        room.guest = socket.id;
        room.guestName = playerName;
        socketToRoom.set(socket.id, roomId);
        socket.join(roomId);

        socket.emit('roomJoined', {
            roomId, hostName: room.hostName,
            scoreLimit: room.scoreLimit, courtType: room.courtType
        });
        io.to(room.host).emit('playerJoined', { playerNumber: 2, playerName });
        io.to(roomId).emit('gameStart');
        log('Guest joined room', roomId);
    });

    // Client finished its start countdown and is ready for the puck to move
    socket.on('playerReady', (data) => {
        const room = data && getMemberRoom(socket, data.roomId);
        if (!room) return;
        if (socket.id === room.host) room.ready1 = true;
        else if (socket.id === room.guest) room.ready2 = true;
        maybeStart(room);
    });

    // Paddle input: client sends desired normalized position; server is authoritative
    socket.on('input', (data) => {
        const room = data && getMemberRoom(socket, data.roomId);
        if (!room) return;
        if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
        // Ignore non-finite / out-of-range coordinates (malformed or malicious)
        if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
        if (data.x < -0.5 || data.x > 1.5 || data.y < -0.5 || data.y > 1.5) return;
        // Throttle: drop inputs arriving faster than MIN_INPUT_INTERVAL_MS
        const now = Date.now();
        if (now - (lastInputAt.get(socket.id) || 0) < MIN_INPUT_INTERVAL_MS) return;
        lastInputAt.set(socket.id, now);
        const player = socket.id === room.host ? 1 : 2;
        const pos = clampPaddle(player, room.courtType, data.x * FIELD_W, data.y * FIELD_H);
        const paddle = player === 1 ? room.phys.p1 : room.phys.p2;
        paddle.x = pos.x;
        paddle.y = pos.y;
    });

    // Reconnect support
    socket.on('rejoinRoom', (data) => {
        const { roomId, playerNumber, playerName } = data || {};
        const room = rooms.get(roomId);
        if (!room) { socket.emit('roomError', 'Room does not exist'); return; }

        if (playerNumber === 1) { room.host = socket.id; room.hostName = playerName || room.hostName; }
        else if (playerNumber === 2) { room.guest = socket.id; room.guestName = playerName || room.guestName; }
        else return;

        const timer = disconnectTimers.get(roomId);
        if (timer) { clearTimeout(timer); disconnectTimers.delete(roomId); }

        socketToRoom.set(socket.id, roomId);
        socket.join(roomId);
        socket.emit('rejoined', {
            roomId, playerNumber,
            scoreLimit: room.scoreLimit, courtType: room.courtType,
            score: room.phys.score
        });
        broadcastState(room);
        socket.to(roomId).emit('opponentReconnected');
        // Resume physics if it was running before the disconnect
        if (room.ready1 && room.ready2 && !room.gameOver) startLoop(room);
        log('Player', playerNumber, 'rejoined', roomId);
    });

    socket.on('disconnect', () => {
        log('User disconnected:', socket.id);
        lastInputAt.delete(socket.id);
        removeFromQueue(socket.id);
        const roomId = socketToRoom.get(socket.id);
        if (!roomId) return;
        const room = rooms.get(roomId);
        socketToRoom.delete(socket.id);
        if (!room) return;

        // Pause physics while a player is away
        stopLoop(room);

        if (room.gameOver) { destroyRoom(roomId); return; }

        const hadOpponent =
            (room.host === socket.id && room.guest) ||
            (room.guest === socket.id && room.host);
        if (!hadOpponent) { destroyRoom(roomId); return; }

        const opponent = room.host === socket.id ? room.guest : room.host;
        io.to(opponent).emit('opponentDisconnected', { grace: REJOIN_GRACE_MS });

        if (disconnectTimers.has(roomId)) return;
        const timer = setTimeout(() => {
            disconnectTimers.delete(roomId);
            const r = rooms.get(roomId);
            if (!r) return;
            io.to(roomId).emit('roomError', 'Opponent did not reconnect');
            destroyRoom(roomId);
        }, REJOIN_GRACE_MS);
        disconnectTimers.set(roomId, timer);
    });
});

// ── Resilience ──────────────────────────────────────────────────────────────
// Single-instance deploy: room state lives in memory, so the priority is keeping
// the process alive and cleaning up after itself. (Horizontal scaling / surviving
// a restart would need a Redis adapter + shared state — deferred until traffic
// actually demands it.)

// Never let one stray error take down every live game.
process.on('uncaughtException', (err) => console.error('Uncaught exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

// Reap abandoned rooms: if neither participant has a live socket anymore, the
// disconnect grace already covers most cases, but this catches anything that slips
// through (e.g. a room created and instantly abandoned before any disconnect fired).
setInterval(() => {
    for (const [roomId, room] of rooms) {
        const hostLive = room.host && io.sockets.sockets.get(room.host);
        const guestLive = room.guest === BOT_SENTINEL || (room.guest && io.sockets.sockets.get(room.guest));
        // Keep rooms that still have at least one human present, or are within their
        // reconnect grace window (a disconnect timer is pending).
        if (!hostLive && !guestLive && !disconnectTimers.has(roomId)) {
            log('Reaping abandoned room', roomId);
            destroyRoom(roomId);
        }
    }
}, 60000);

// Graceful shutdown: tell clients before we go so they show a clear message
// instead of silently hanging on the reconnect overlay.
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    io.emit('serverRestarting');
    for (const [, room] of rooms) stopLoop(room);
    io.close();
    http.close(() => process.exit(0));
    // Failsafe: force-exit if close() hangs
    setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
