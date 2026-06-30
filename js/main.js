/**
 * GameController — entry point and orchestration layer.
 * Wires every module together; contains no business logic of its own.
 * All actual work is delegated to the appropriate module.
 */
import { state }        from './state.js';
import { SoundManager } from './sound.js';
import { Renderer }     from './renderer.js';
import { InputHandler } from './input.js';
import { UI }           from './ui.js';
import { LobbyManager } from './lobby.js';
import { SocketManager } from './network.js';
import { Onboarding }   from './onboarding.js';
import { haptic } from './haptics.js';

document.addEventListener('DOMContentLoaded', () => {

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  const canvas = document.getElementById('gameCanvas');

  const sound    = new SoundManager();
  const renderer = new Renderer(canvas, state);
  const ui       = new UI();
  const input    = new InputHandler(canvas, state, (relX, relY) => {
    net.sendInput(state.roomId, relX, relY);
  });

  // Timers for reconnect countdowns
  let reconnectTimer      = null;
  let selfDisconnectTimer = null;

  // Power-up FAB — created once, shown/hidden per game session
  const powerUp = ui.initPowerUpButton((id) => {
    net.usePower(state.roomId, id);
  });

  // ─── Network ───────────────────────────────────────────────────────────────

  const net = new SocketManager({

    onConnect() {
      if (selfDisconnectTimer) { selfDisconnectTimer(); selfDisconnectTimer = null; }
      if (state.hasJoinedGame && state.roomId && state.playerNumber) {
        net.rejoinRoom({ roomId: state.roomId, playerNumber: state.playerNumber, playerName: state.playerName });
      }
    },

    onDisconnect() {
      if (!state.hasJoinedGame) return;
      state.gamePaused = true;
      if (selfDisconnectTimer) selfDisconnectTimer();
      selfDisconnectTimer = ui.startCountdownOverlay(
        'Bağlantı koptu\nYeniden bağlanılıyor...',
        () => {
          selfDisconnectTimer = null;
          ui.showReconnect('Bağlantı kurulamadı.\nSayfayı yenileyin.');
        }
      );
    },

    onConnectError(err) {
      console.error('Connection error:', err);
    },

    onRoomCreated(data) {
      state.roomId       = data.roomId;
      state.playerNumber = 1;
      state.gameStarted  = false;
      state.hasJoinedGame = true;
      lobby.showWaitingRoom(data.roomId);
    },

    onRoomJoined(data) {
      state.roomId        = data.roomId;
      state.playerNumber  = 2;
      state.opponentName  = data.hostName;
      state.scoreLimit    = data.scoreLimit;
      state.courtType     = data.courtType;
      state.hasJoinedGame = true;
      lobby.hideAll();
    },

    onRoomError(msg) {
      alert(msg);
    },

    onPlayerJoined(data) {
      if (data.playerNumber !== state.playerNumber) {
        state.opponentName = data.playerName;
      }
    },

    onGameStart() {
      lobby.hideAll();
      canvas.style.display = 'block';
      renderer.resize();
      _startGame();
    },

    onBotGameStart(data) {
      state.roomId        = data.roomId;
      state.playerNumber  = 1;
      state.hasJoinedGame = true;
      state.gameStarted   = false;
      if (data.scoreLimit) state.scoreLimit = data.scoreLimit;
      if (data.courtType)  state.courtType  = data.courtType;
      state.opponentName  = data.botName || 'Bilgisayar';
      lobby.hideAll();
      canvas.style.display = 'block';
      renderer.resize();
      _startGame();
    },

    onMatchFound(data) {
      state.searching     = false;
      ui.hideSearching();
      state.roomId        = data.roomId;
      state.playerNumber  = data.playerNumber;
      state.opponentName  = data.opponentName || 'Rakip';
      if (data.scoreLimit) state.scoreLimit = data.scoreLimit;
      if (data.courtType)  state.courtType  = data.courtType;
      state.hasJoinedGame = true;
      state.gameStarted   = false;
      lobby.hideAll();
    },

    onState(data) {
      if (!data) return;
      if (data.puck) {
        const p = renderer.relToCanvas(data.puck.x, data.puck.y);
        state.puckTarget.x = p.x; state.puckTarget.y = p.y;
      }
      if (state.playerNumber === 1) {
        if (data.p2) { const o = renderer.relToCanvas(data.p2.x, data.p2.y); state.oppTarget.x = o.x; state.oppTarget.y = o.y; }
        if (state.gamePaused && data.p1) { const s = renderer.relToCanvas(data.p1.x, data.p1.y); state.paddle1.x = s.x; state.paddle1.y = s.y; }
      } else {
        if (data.p1) { const o = renderer.relToCanvas(data.p1.x, data.p1.y); state.oppTarget.x = o.x; state.oppTarget.y = o.y; }
        if (state.gamePaused && data.p2) { const s = renderer.relToCanvas(data.p2.x, data.p2.y); state.paddle2.x = s.x; state.paddle2.y = s.y; }
      }
      if (data.score)                    state.score     = data.score;
      if (data.puckSpeed !== undefined)  state.puckSpeed = data.puckSpeed;
      if (data.powers)                   state.powers    = data.powers;
    },

    onGoal(data) {
      if (data?.score) state.score = data.score;
      ui.showGoalAnimation();
      sound.playGoal();
      haptic.notification('Success');
      ui.hideMatchPoint();
      _checkMatchPoint();
    },

    onHit(data) {
      const who = data?.player ?? state.playerNumber;
      state.hitFlashTime   = Date.now();
      state.hitFlashPlayer = who;
      sound.playHit();
      if (who === state.playerNumber) haptic.impact('Light');
    },

    onGameOver(data) {
      _handleGameOver(data?.winner);
    },

    onOpponentDisconnected() {
      state.gamePaused = true;
      if (reconnectTimer) { reconnectTimer(); reconnectTimer = null; }
      reconnectTimer = ui.startCountdownOverlay(
        'Rakibin bağlantısı koptu\nGeri dönmesi bekleniyor...',
        () => { reconnectTimer = null; }
      );
    },

    onOpponentReconnected() {
      state.gamePaused = false;
      if (reconnectTimer) { reconnectTimer(); reconnectTimer = null; }
      ui.hideReconnect();
    },

    onRejoined(data) {
      if (data?.scoreLimit) state.scoreLimit = data.scoreLimit;
      if (data?.courtType)  state.courtType  = data.courtType;
      state.gamePaused = false;
      ui.hideReconnect();
    },

    onPowerActivated(data) {
      const labels = { speed: '⚡ Turbo!', big: '🛡 Dev Raket!', freeze: '❄ Dondur!', smallGoal: '🥅 Kalen Küçüldü!' };
      const oppLabels = { freeze: '❄ Donduruldun!', smallGoal: '🥅 Rakibin Kalesi Küçüldü!' };
      const isOwn  = data.player === state.playerNumber;
      const msg    = isOwn ? labels[data.power] : (oppLabels[data.power] ?? null);
      if (msg) _showPowerToast(msg);
      if (isOwn) {
        sound.playPower();
        haptic.impact('Medium');
        // Show countdown ring for own powers
        const durations = { speed: 5000, big: 5000, freeze: 3000, smallGoal: 6000 };
        if (durations[data.power]) ui.showPowerCountdown(data.power, durations[data.power]);
      }
    },

    onOvertime() {
      state.inOvertime = true;
      ui.showOvertime();
      ui.hideMatchPoint(); // clear any match point warning
    },

    onServerRestarting() {
      state.gamePaused = true;
      if (state.hasJoinedGame) {
        ui.showReconnect('Sunucu yeniden başlatılıyor.\nLütfen birazdan tekrar deneyin.');
      }
    },
  });

  // ─── Lobby ─────────────────────────────────────────────────────────────────

  const lobby = new LobbyManager(state, {
    onNameSubmit(name) {
      state.playerName = name;
    },

    onCreateRoom() {
      state.pendingBotMode = false;
      lobby.showSettingsPopup(false);
    },

    onBotRoom() {
      state.pendingBotMode = true;
      lobby.showSettingsPopup(true);
    },

    onSettingsConfirmed({ scoreLimit, courtType, difficulty }) {
      state.scoreLimit = scoreLimit;
      state.courtType  = courtType;
      if (state.pendingBotMode) {
        net.createBotRoom({ playerName: state.playerName, scoreLimit, courtType, difficulty });
      } else {
        const roomCode = Math.floor(Math.random() * 9000 + 1000).toString();
        net.createRoom({ roomId: roomCode, playerName: state.playerName, scoreLimit, courtType });
      }
    },

    onJoinRoom(roomCode) {
      net.joinRoom({ roomId: roomCode, playerName: state.playerName });
    },

    onQuickMatch() {
      if (state.searching) return;
      state.searching = true;
      net.quickMatch(state.playerName);
      ui.showSearching(() => {
        state.searching = false;
        net.cancelMatch();
        ui.hideSearching();
      });
    },

    onCopyCode(code) {
      navigator.clipboard.writeText(code).then(() => lobby.showToast());
    },

    onShareCode(code) {
      const text = `Hava hokeyi oynayalım! Oda kodu: ${code}`;
      if (navigator.share) {
        navigator.share({ title: 'Air Hockey', text }).catch(() => {});
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
      }
    },

    onBackToName() {
      net.disconnect();
      ui.hideReconnect();
      net.connect();
    },
  });

  lobby.init();

  // ─── First-launch onboarding ───────────────────────────────────────────────
  // Shows once over the name form; the gate (localStorage) skips it afterwards.
  if (!Onboarding.seen()) {
    new Onboarding(() => { /* name form is already visible underneath */ });
  }

  // ─── Sound unlock on canvas interaction ────────────────────────────────────

  canvas.addEventListener('touchstart', (e) => sound.init(e), { passive: true });
  canvas.addEventListener('click',      (e) => sound.init(e), { passive: true });

  // ─── Canvas resize ─────────────────────────────────────────────────────────

  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());

  // ─── Game flow ─────────────────────────────────────────────────────────────

  function _showPowerToast(msg) {
    let el = document.getElementById('powerToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'powerToast';
      el.style.cssText =
        'position:fixed;bottom:100px;right:16px;padding:10px 18px;border-radius:20px;' +
        'background:rgba(15,15,30,0.92);border:1.5px solid rgba(255,255,255,0.2);' +
        'color:#fff;font-size:15px;font-weight:700;font-family:\'Montserrat\',sans-serif;' +
        'z-index:1300;opacity:0;transition:opacity 0.2s;pointer-events:none;' +
        'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 1800);
  }

  function _checkMatchPoint() {
    const { score, scoreLimit, playerNumber, inOvertime } = state;
    if (!scoreLimit) return;
    if (inOvertime) {
      // In overtime: show match point when one player leads by 1
      const diff = Math.abs(score.player1 - score.player2);
      if (diff === 1) ui.showMatchPoint();
      else ui.hideMatchPoint();
      return;
    }
    const myS  = playerNumber === 1 ? score.player1 : score.player2;
    const oppS = playerNumber === 1 ? score.player2 : score.player1;
    if (myS === scoreLimit - 1 || oppS === scoreLimit - 1) {
      ui.showMatchPoint();
    }
  }

  function _startGame() {
    renderer.initPositions();
    state.gameStarted = false;
    input.detach();
    powerUp.reset();   // restore all one-time-use powers for the fresh game
    renderer.startLoop();

    ui.showStartCountdown(() => {
      state.gameStarted = true;
      canvas.style.display = 'block';
      renderer.resize();
      input.attach();
      powerUp.show();
      net.playerReady(state.roomId);
    });
  }

  function _handleGameOver(winner) {
    state.gameStarted   = false;
    state.hasJoinedGame = false;
    input.detach();

    setTimeout(() => {
      state.renderRunning = false;
    }, 1000);

    const msg = winner === state.playerNumber ? 'Kazandınız!' : 'Kaybettiniz!';
    ui.showGameOver(msg, state.score, state.playerNumber, () => _resetToMenu());
  }

  function _resetToMenu() {
    state.gameStarted   = false;
    state.renderRunning = false;
    state.gamePaused    = false;
    state.hasJoinedGame = false;
    state.searching     = false;
    input.detach();

    if (reconnectTimer)     { reconnectTimer();     reconnectTimer     = null; }
    if (selfDisconnectTimer){ selfDisconnectTimer(); selfDisconnectTimer = null; }

    ui.hideReconnect();
    ui.hideSearching();
    ui.removeGameOver();

    state.playerNumber  = null;
    state.roomId        = null;
    state.score         = { player1: 0, player2: 0 };
    state.opponentName  = 'Bekleniyor...';
    state.puckSpeed     = 0;
    state.hitFlashTime  = 0;
    state.inOvertime    = false;

    powerUp.hide();
    ui.hideMatchPoint();
    document.getElementById('powerCountdownWrap')?.remove();
    canvas.style.display = 'none';
    const goalAnim = document.getElementById('goalAnimation');
    if (goalAnim) { goalAnim.style.display = 'none'; goalAnim.classList.remove('show'); }
    const countdown = document.getElementById('startCountdown');
    if (countdown) countdown.style.display = 'none';

    lobby.showMainMenu();

    const roomInput = document.getElementById('roomId');
    if (roomInput) roomInput.value = '';

    net.disconnect();
    net.connect();

    window.scrollTo(0, 0);
  }
});
