/**
 * InputHandler — translates pointer/touch events on the canvas into
 * normalised (0-1) paddle positions and calls `onMove(relX, relY)`.
 * Completely decoupled from the network layer via the callback.
 */
export class InputHandler {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object}            state   - shared game state
   * @param {function}          onMove  - called with (relX, relY) when pointer moves
   */
  constructor(canvas, state, onMove) {
    this.canvas  = canvas;
    this.state   = state;
    this.onMove  = onMove;

    this._handleMove         = this._handleMove.bind(this);
    this._preventDefaultTouch = (e) => e.preventDefault();
  }

  attach() {
    const c = this.canvas;
    c.addEventListener('mousemove',  this._handleMove);
    c.addEventListener('touchmove',  this._handleMove, { passive: false });
    c.addEventListener('touchstart', this._handleMove, { passive: false });
    document.addEventListener('touchmove', this._preventDefaultTouch, { passive: false });
  }

  detach() {
    const c = this.canvas;
    c.removeEventListener('mousemove',  this._handleMove);
    c.removeEventListener('touchmove',  this._handleMove);
    c.removeEventListener('touchstart', this._handleMove);
    document.removeEventListener('touchmove', this._preventDefaultTouch);
  }

  _handleMove(e) {
    const s = this.state;
    if (!s.gameStarted || s.gamePaused) {
      e.preventDefault();
      return;
    }
    e.preventDefault();

    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.type.startsWith('touch') ? e.touches[0].clientX : e.clientX;
    const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;

    let mx = clientX - rect.left;
    let my = clientY - rect.top;

    // Player 2's view is rotated 180° — invert the pointer to game-space
    if (s.playerNumber === 2) {
      mx = this.canvas.width  - mx;
      my = this.canvas.height - my;
    }

    const R = s.PADDLE_RADIUS;
    const W = this.canvas.width;
    const H = this.canvas.height;

    const tx = Math.min(Math.max(mx, R), W - R);
    let   ty;

    if (s.playerNumber === 1) {
      ty = (s.courtType === 'half')
        ? Math.min(Math.max(my, H / 2), H - R)
        : Math.min(Math.max(my, R), H - R);
      s.paddle1.x = tx; s.paddle1.y = ty;   // local prediction
    } else {
      ty = (s.courtType === 'half')
        ? Math.min(Math.max(my, R), H / 2)
        : Math.min(Math.max(my, R), H - R);
      s.paddle2.x = tx; s.paddle2.y = ty;   // local prediction
    }

    this.onMove(tx / W, ty / H);
  }
}
