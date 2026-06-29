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

    // Paddle collisions (server is the only authority — no client conflict).
    // Emit 'hit' only on a rising edge (new contact), not every overlapping tick.
    const c1 = resolvePaddle(puck, p.p1);
    const c2 = resolvePaddle(puck, p.p2);
    if ((c1 && !p.p1.wasContact) || (c2 && !p.p2.wasContact)) io.to(room.id).emit('hit');
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
        // Update paddle velocities snapshot, then step
        const p = room.phys;
        stepRoom(room);
        p.p1.lastX = p.p1.x; p.p1.lastY = p.p1.y;
        p.p2.lastX = p.p2.x; p.p2.lastY = p.p2.y;
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

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
