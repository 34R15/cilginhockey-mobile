import { SERVER_URL, SOCKET_OPTS } from './config.js';

/**
 * SocketManager — owns the socket.io connection and all socket.on handlers.
 * Translates raw socket events into structured callbacks consumed by main.js.
 *
 * callbacks shape:
 *   onConnect()
 *   onDisconnect()
 *   onConnectError(err)
 *   onRoomCreated(data)       { roomId }
 *   onRoomJoined(data)        { roomId, hostName, scoreLimit, courtType }
 *   onRoomError(msg)
 *   onPlayerJoined(data)      { playerNumber, playerName }
 *   onGameStart()
 *   onBotGameStart(data)      { roomId, scoreLimit, courtType, botName }
 *   onMatchFound(data)        { roomId, playerNumber, opponentName, scoreLimit, courtType }
 *   onState(data)             physics snapshot
 *   onGoal(data)              { score }
 *   onHit(data)               { player }
 *   onGameOver(data)          { winner }
 *   onOpponentDisconnected()
 *   onOpponentReconnected()
 *   onRejoined(data)          { scoreLimit, courtType }
 *   onServerRestarting()
 */
export class SocketManager {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    // eslint-disable-next-line no-undef
    this.socket = io(SERVER_URL, SOCKET_OPTS);
    this._bindAll();
  }

  // ─── Emit helpers ──────────────────────────────────────────────────────────

  get connected() { return this.socket.connected; }
  connect()       { this.socket.connect(); }
  disconnect()    { this.socket.disconnect(); }

  createRoom({ roomId, playerName, scoreLimit, courtType }) {
    this._ensureConnected();
    setTimeout(() => this.socket.emit('createRoom', { roomId, playerName, scoreLimit, courtType }), 500);
  }

  createBotRoom({ playerName, scoreLimit, courtType, difficulty }) {
    this._ensureConnected();
    setTimeout(() => this.socket.emit('createBotRoom', { playerName, scoreLimit, courtType, difficulty }), 300);
  }

  joinRoom({ roomId, playerName }) {
    this.socket.emit('joinRoom', { roomId, playerName });
  }

  quickMatch(playerName) {
    this._ensureConnected();
    this.socket.emit('quickMatch', { playerName });
  }

  cancelMatch() {
    this.socket.emit('cancelMatch');
  }

  sendInput(roomId, relX, relY) {
    this.socket.emit('input', { roomId, x: relX, y: relY });
  }

  playerReady(roomId) {
    this.socket.emit('playerReady', { roomId });
  }

  rejoinRoom({ roomId, playerNumber, playerName }) {
    this.socket.emit('rejoinRoom', { roomId, playerNumber, playerName });
  }

  usePower(roomId, power) {
    this.socket.emit('usePower', { roomId, power });
  }

  // ─── Internal binding ──────────────────────────────────────────────────────

  _bindAll() {
    const s  = this.socket;
    const cb = this.cb;

    s.on('connect',     () => cb.onConnect?.());
    s.on('disconnect',  () => cb.onDisconnect?.());
    s.on('connect_error', (e) => cb.onConnectError?.(e));
    s.on('connect_timeout', () => cb.onConnectError?.('timeout'));
    s.on('connected',   () => {});   // server handshake ack — no action needed

    s.on('roomCreated',  (d) => cb.onRoomCreated?.(d));
    s.on('roomJoined',   (d) => cb.onRoomJoined?.(d));
    s.on('roomError',    (m) => cb.onRoomError?.(m));
    s.on('playerJoined', (d) => cb.onPlayerJoined?.(d));

    s.on('gameStart',     ()  => cb.onGameStart?.());
    s.on('botGameStart',  (d) => cb.onBotGameStart?.(d));
    s.on('searchingMatch',()  => {});  // server ack — UI already shown
    s.on('matchFound',    (d) => cb.onMatchFound?.(d));

    s.on('state',    (d) => cb.onState?.(d));
    s.on('goal',     (d) => cb.onGoal?.(d));
    s.on('hit',      (d) => cb.onHit?.(d));
    s.on('gameOver', (d) => cb.onGameOver?.(d));

    s.on('powerActivated',       (d) => cb.onPowerActivated?.(d));
    s.on('opponentDisconnected', () => cb.onOpponentDisconnected?.());
    s.on('opponentReconnected',  () => cb.onOpponentReconnected?.());
    s.on('rejoined',             (d) => cb.onRejoined?.(d));
    s.on('serverRestarting',     () => cb.onServerRestarting?.());
  }

  _ensureConnected() {
    if (!this.socket.connected) this.socket.connect();
  }
}
