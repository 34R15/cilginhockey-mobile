import { settings } from './settings.js';

/**
 * LobbyManager — owns all pre-game UI: name form, main menu,
 * waiting room, and settings popup.
 * Communicates outward only through callbacks; never calls socket directly.
 *
 * callbacks shape:
 *   onNameSubmit(name)
 *   onCreateRoom()
 *   onBotRoom()
 *   onJoinRoom(roomCode)
 *   onQuickMatch()
 *   onCopyCode(code)
 *   onShareCode(code)
 */
export class LobbyManager {
  constructor(state, callbacks = {}) {
    this.state = state;
    this.cb    = callbacks;
  }

  /** Wire all DOM button listeners. Call once after DOMContentLoaded. */
  init() {
    this._bind('submitNameBtn',    'click',    () => this._submitName());
    this._bind('playerNameInput',  'keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._submitName(); } });
    this._bind('createRoomBtn',    'click',    () => this.cb.onCreateRoom?.());
    this._bind('botPlayBtn',       'click',    () => this.cb.onBotRoom?.());
    this._bind('quickPlayBtn',     'click',    () => this.cb.onQuickMatch?.());
    this._bind('joinRoomBtn',      'click',    () => this._joinRoom());
    this._bind('roomId',           'keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._joinRoom(); } });
    this._bind('confirmScoreLimit','click',    () => this._confirmSettings());
    this._bind('backToNameBtn',    'click',    () => this._goBackToName());
    this._bind('copyRoomBtn',      'click',    () => {
      const code = document.getElementById('currentRoomId')?.textContent;
      if (code) this.cb.onCopyCode?.(code);
    });
    this._bind('shareRoomBtn',     'click',    () => {
      const code = document.getElementById('currentRoomId')?.textContent;
      if (code) this.cb.onShareCode?.(code);
    });
    this._bind('settingsBtn',        'click', () => this._openAppSettings());
    this._bind('closeAppSettings',   'click', () => this._closeAppSettings());

    this._initSegments();
    this._initAppSettingsToggles();
  }

  // ─── Public navigation helpers ─────────────────────────────────────────────

  showMainMenu() {
    this._el('nameForm')?.style     && (this._el('nameForm').style.display = 'none');
    this._el('waitingRoom')?.style  && (this._el('waitingRoom').style.display = 'none');
    this._el('scoreLimitPopup')?.style && (this._el('scoreLimitPopup').style.display = 'none');
    this._el('mainMenu')?.style     && (this._el('mainMenu').style.display = 'flex');
    this._el('menu')?.style         && (this._el('menu').style.display = 'flex');
  }

  showWaitingRoom(roomCode) {
    const codeEl = this._el('currentRoomId');
    if (codeEl) codeEl.textContent = roomCode;
    this._el('mainMenu')?.style     && (this._el('mainMenu').style.display = 'none');
    this._el('waitingRoom')?.style  && (this._el('waitingRoom').style.display = 'block');
    this._el('menu')?.style         && (this._el('menu').style.display = 'block');
  }

  showSettingsPopup(isBotMode) {
    const diffGroup = this._el('difficultyGroup');
    if (diffGroup) diffGroup.style.display = isBotMode ? 'block' : 'none';
    this._el('scoreLimitPopup')?.style && (this._el('scoreLimitPopup').style.display = 'flex');
    this._el('mainMenu')?.style        && (this._el('mainMenu').style.display = 'none');
  }

  hideAll() {
    ['menu', 'mainMenu', 'waitingRoom', 'scoreLimitPopup'].forEach(id => {
      const el = this._el(id);
      if (el) el.style.display = 'none';
    });
  }

  showToast() {
    const toast = this._el('toast');
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // ─── Segmented control helpers ─────────────────────────────────────────────

  getSegValue(segmentId, fallback) {
    const seg    = this._el(segmentId);
    const active = seg?.querySelector('.seg-option.active');
    return active ? active.dataset.value : fallback;
  }

  _initSegments() {
    document.querySelectorAll('.segment').forEach((seg) => {
      seg.addEventListener('click', (e) => {
        const opt = e.target.closest('.seg-option');
        if (!opt || !seg.contains(opt)) return;
        seg.querySelectorAll('.seg-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });
  }

  // ─── Private handlers ──────────────────────────────────────────────────────

  _submitName() {
    const input = this._el('playerNameInput');
    const name  = input?.value.trim() ?? '';
    if (name.length < 2) { alert('Lütfen en az 2 karakterli bir takma ad girin'); return; }

    this.state.playerName = name;
    input.blur(); // dismiss keyboard — no auto-focus

    this._el('nameForm').style.display = 'none';
    this._el('menu').style.display     = 'flex';

    this.cb.onNameSubmit?.(name);
  }

  _joinRoom() {
    const code = this._el('roomId')?.value;
    if (!code) { alert('Lütfen oda kodu girin'); return; }
    this.cb.onJoinRoom?.(code);
  }

  _confirmSettings() {
    const scoreLimit  = parseInt(this.getSegValue('scoreSegment', '5'), 10);
    const courtType   = this.getSegValue('courtSegment', 'full');
    const difficulty  = this.getSegValue('difficultySegment', 'medium');

    this.state.scoreLimit = scoreLimit;
    this.state.courtType  = courtType;

    this._el('scoreLimitPopup').style.display = 'none';
    this.cb.onSettingsConfirmed?.({ scoreLimit, courtType, difficulty });
  }

  _goBackToName() {
    this.state.hasJoinedGame = false;
    this.state.gamePaused    = false;
    this.state.renderRunning = false;
    this.state.playerNumber  = null;
    this.state.roomId        = null;
    this.state.gameStarted   = false;
    this.state.score         = { player1: 0, player2: 0 };
    this.state.opponentName  = 'Bekleniyor...';

    ['menu', 'scoreLimitPopup', 'waitingRoom'].forEach(id => {
      const el = this._el(id);
      if (el) el.style.display = 'none';
    });
    this._el('mainMenu').style.display = 'flex';

    const nameForm  = this._el('nameForm');
    const nameInput = this._el('playerNameInput');
    if (nameForm)  nameForm.style.display = 'flex';
    if (nameInput) { nameInput.value = ''; nameInput.blur(); }

    const canvas = this._el('gameCanvas');
    if (canvas) canvas.style.display = 'none';

    window.scrollTo(0, 0);
    document.body.style.overflow = 'hidden';

    this.cb.onBackToName?.();
  }

  // ─── App settings popup ────────────────────────────────────────────────────

  _initAppSettingsToggles() {
    const soundEl = this._el('soundToggle');
    const vibEl   = this._el('vibrationToggle');
    if (soundEl) soundEl.checked = settings.soundEnabled;
    if (vibEl)   vibEl.checked   = settings.vibrationEnabled;

    soundEl?.addEventListener('change', () => { settings.soundEnabled = soundEl.checked; });
    vibEl?.addEventListener('change',   () => { settings.vibrationEnabled = vibEl.checked; });
  }

  _openAppSettings() {
    const popup = this._el('appSettingsPopup');
    if (popup) popup.style.display = 'flex';
    this._el('settingsBtn')?.classList.add('spinning');
  }

  _closeAppSettings() {
    const popup = this._el('appSettingsPopup');
    if (popup) popup.style.display = 'none';
    this._el('settingsBtn')?.classList.remove('spinning');
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  _el(id) { return document.getElementById(id); }

  _bind(id, event, handler) {
    const el = this._el(id);
    if (el) el.addEventListener(event, handler);
  }
}
