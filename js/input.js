/**
 * How far (in screen px) the paddle sits ABOVE the fingertip, so the finger
 * doesn't cover it. Applied in physical-screen space (before the player-2
 * rotation), so each player sees the paddle lifted toward the field on their
 * own device regardless of view orientation.
 */
const PADDLE_FINGER_OFFSET = 24;

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
    this._rect   = null; // cached canvas bounds — refreshed on gesture start

    this._handleMove         = this._handleMove.bind(this);
    // Block default touch behaviour (scroll / rubber-band) during play, BUT let
    // touches on the power-up FAB through so it can be tapped while the other
    // finger is still controlling the paddle (multi-touch).
    this._preventDefaultTouch = (e) => {
      if (e.target.closest && e.target.closest('#powerupFab')) return;
      e.preventDefault();
    };
  }

  attach() {
    const c = this.canvas;
    this._rect = c.getBoundingClientRect();
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

    // Refresh cached bounds only at gesture start (touchstart), not on every move —
    // getBoundingClientRect forces a layout flush and causes jank at touch frequency.
    if (e.type === 'touchstart' || !this._rect) {
      this._rect = this.canvas.getBoundingClientRect();
    }
    const rect = this._rect;
    let clientX, clientY;

    if (e.type.startsWith('touch')) {
      // Under multi-touch (e.g. one finger on FAB, one on canvas) touches[0]
      // may belong to the FAB, not the canvas. Find the touch that actually
      // lands inside the canvas rect so the paddle doesn't jump to the FAB.
      let best = null;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        if (t.clientX >= rect.left && t.clientX <= rect.right &&
            t.clientY >= rect.top  && t.clientY <= rect.bottom) {
          best = t; break;
        }
      }
      if (!best) return; // no touch on canvas — ignore
      clientX = best.clientX;
      clientY = best.clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    let mx = clientX - rect.left;
    // Lift the paddle slightly above the fingertip (physical-screen space) so the
    // finger doesn't obscure it — feels better than the paddle sitting under it.
    let my = clientY - rect.top - PADDLE_FINGER_OFFSET;

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
