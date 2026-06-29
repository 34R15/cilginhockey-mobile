/**
 * Single source of truth for all mutable game state.
 * Every module imports this object and reads/writes it directly.
 * No module owns a private copy of these values.
 */
export const state = {
  // Identity
  playerNumber: null,
  roomId:       null,
  playerName:   '',
  opponentName: 'Bekleniyor...',

  // Session flags
  gameStarted:    false,
  gamePaused:     false,
  hasJoinedGame:  false,
  renderRunning:  false,
  pendingBotMode: false,
  searching:      false,

  // Settings
  scoreLimit: 5,
  courtType:  'half',

  // Render positions (canvas coords)
  paddle1:   { x: 0, y: 0 },
  paddle2:   { x: 0, y: 0 },
  puck:      { x: 0, y: 0 },
  puckTarget:{ x: 0, y: 0 },
  oppTarget: { x: 0, y: 0 },
  score:     { player1: 0, player2: 0 },

  // Visual effects
  hitFlashTime:   0,
  hitFlashPlayer: 0,
  puckSpeed:      0,

  // Canvas sizing (updated by Renderer.resize())
  PADDLE_RADIUS: 30,
  PUCK_RADIUS:   15,
};
