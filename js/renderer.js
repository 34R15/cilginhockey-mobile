import { GOAL_WIDTH_RATIO, LERP_PUCK, LERP_OPP } from './config.js';

const GOAL_COLORS = [
  '#39ff14','#ff1493','#00ffff','#ff4500',
  '#ffff00','#ff00ff','#1e90ff','#ff3800','#9400d3','#7fff00',
];

/**
 * Renderer — owns the canvas element and all drawing logic.
 * Reads from `state` but never writes to it.
 */
export class Renderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.state  = state;

    this._paddle1Img = new Image();
    this._paddle2Img = new Image();
    this._puckImg    = new Image();
    this._paddle1Img.src = 'assets/images/paddle-green.png';
    this._paddle2Img.src = 'assets/images/paddle-red.png';
    this._puckImg.src    = 'assets/images/disk.png';

    this._rafId = null;
  }

  // ─── Coordinate helpers ────────────────────────────────────────────────────

  relToCanvas(relX, relY) {
    return { x: relX * this.canvas.width, y: relY * this.canvas.height };
  }

  canvasToRel(canvasX, canvasY) {
    return { x: canvasX / this.canvas.width, y: canvasY / this.canvas.height };
  }

  // ─── Sizing ────────────────────────────────────────────────────────────────

  resize() {
    const s = this.state;
    const aspectRatio = 9 / 16;
    const mh = window.innerHeight;
    const mw = window.innerWidth;

    if (mh / mw > aspectRatio) {
      this.canvas.width  = mw;
      this.canvas.height = mw / aspectRatio;
    } else {
      this.canvas.height = mh;
      this.canvas.width  = mh * aspectRatio;
    }

    s.PADDLE_RADIUS = this.canvas.width * 0.115;
    s.PUCK_RADIUS   = s.PADDLE_RADIUS * 0.5;
  }

  // ─── Initial positions ─────────────────────────────────────────────────────

  initPositions() {
    const s  = this.state;
    const cx = this.canvas.width / 2;
    s.paddle1    = { x: cx, y: this.canvas.height - s.PADDLE_RADIUS * 2 };
    s.paddle2    = { x: cx, y: s.PADDLE_RADIUS * 2 };
    s.puck       = { x: cx, y: this.canvas.height / 2 };
    s.puckTarget = { x: cx, y: this.canvas.height / 2 };
    s.oppTarget  = {
      x: cx,
      y: s.playerNumber === 1 ? s.PADDLE_RADIUS * 2 : this.canvas.height - s.PADDLE_RADIUS * 2,
    };
    s.score = { player1: 0, player2: 0 };
    this.draw();
  }

  // ─── Render loop ───────────────────────────────────────────────────────────

  startLoop() {
    if (this.state.renderRunning) return;
    this.state.renderRunning = true;
    const loop = () => {
      if (!this.state.renderRunning) return;
      this._lerp();
      this.draw();
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  stopLoop() {
    this.state.renderRunning = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  _lerp() {
    const s = this.state;
    s.puck.x += (s.puckTarget.x - s.puck.x) * LERP_PUCK;
    s.puck.y += (s.puckTarget.y - s.puck.y) * LERP_PUCK;
    if (s.playerNumber === 1) {
      s.paddle2.x += (s.oppTarget.x - s.paddle2.x) * LERP_OPP;
      s.paddle2.y += (s.oppTarget.y - s.paddle2.y) * LERP_OPP;
    } else {
      s.paddle1.x += (s.oppTarget.x - s.paddle1.x) * LERP_OPP;
      s.paddle1.y += (s.oppTarget.y - s.paddle1.y) * LERP_OPP;
    }
  }

  // ─── Drawing ───────────────────────────────────────────────────────────────

  draw() {
    const { canvas, ctx, state: s } = this;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    if (s.playerNumber === 2) {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    }

    this._drawField();
    this._drawNames();
    this._drawScores();
    this._drawHitFlash();
    this._drawPaddles();
    this._drawPuck();

    ctx.restore();
  }

  _drawField() {
    const { canvas, ctx, state: s } = this;

    // Center dashed line
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([5, 15]);
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const gw    = canvas.width * GOAL_WIDTH_RATIO;
    const gs    = (canvas.width - gw) / 2;
    const thick = 5;

    // Top goal
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, canvas.width, thick);
    ctx.fillRect(0, 0, gs, 20);
    ctx.fillRect(gs + gw, 0, gs, 20);

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(gs, 0);       ctx.lineTo(gs, 20);
    ctx.moveTo(gs + gw, 0);  ctx.lineTo(gs + gw, 20);
    ctx.stroke();

    // Bottom goal
    ctx.fillStyle = '#333';
    ctx.fillRect(0, canvas.height - thick, canvas.width, thick);
    ctx.fillRect(0, canvas.height - 20, gs, 20);
    ctx.fillRect(gs + gw, canvas.height - 20, gs, 20);

    ctx.beginPath();
    ctx.moveTo(gs, canvas.height);       ctx.lineTo(gs, canvas.height - 20);
    ctx.moveTo(gs + gw, canvas.height);  ctx.lineTo(gs + gw, canvas.height - 20);
    ctx.stroke();

    // Semi-transparent goal area fills
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(gs, 0, gw, 20);
    ctx.fillRect(gs, canvas.height - 20, gw, 20);
  }

  _drawNames() {
    const { canvas, ctx, state: s } = this;
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';

    const isP2 = s.playerNumber === 2;
    const p2Text = isP2 ? s.playerName : s.opponentName;
    const p1Text = isP2 ? s.opponentName : s.playerName;

    if (isP2) {
      ctx.save();
      ctx.translate(s.paddle2.x, s.paddle2.y - s.PADDLE_RADIUS - 10);
      ctx.rotate(Math.PI);
      ctx.fillText(p2Text, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(s.paddle1.x, s.paddle1.y + s.PADDLE_RADIUS + 25);
      ctx.rotate(Math.PI);
      ctx.fillText(p1Text, 0, 0);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(s.paddle2.x, s.paddle2.y + s.PADDLE_RADIUS + 25);
      ctx.fillText(p2Text, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(s.paddle1.x, s.paddle1.y - s.PADDLE_RADIUS - 10);
      ctx.fillText(p1Text, 0, 0);
      ctx.restore();
    }
  }

  _drawScores() {
    const { canvas, ctx, state: s } = this;
    ctx.font = 'bold 60px Arial';
    ctx.textAlign = 'center';

    // Top half (opponent) — rotated so number reads right-side-up for viewer
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 4);
    ctx.rotate(Math.PI);
    ctx.fillStyle = 'rgba(244,67,54,0.2)';
    ctx.fillText(s.score.player2.toString(), 0, 0);
    ctx.restore();

    // Bottom half (self)
    ctx.fillStyle = 'rgba(76,175,80,0.2)';
    ctx.fillText(s.score.player1.toString(), canvas.width / 2, canvas.height * 3 / 4);
  }

  _drawHitFlash() {
    const { ctx, state: s } = this;
    const age = Date.now() - s.hitFlashTime;
    if (s.hitFlashTime <= 0 || age >= 250) return;

    const alpha = (1 - age / 250) * 0.9;
    const target = s.hitFlashPlayer === 1 ? s.paddle1 : s.paddle2;
    ctx.save();
    ctx.translate(target.x, target.y);
    const g = ctx.createRadialGradient(0, 0, s.PADDLE_RADIUS * 0.5, 0, 0, s.PADDLE_RADIUS * 2.4);
    g.addColorStop(0, `rgba(255,240,80,${alpha})`);
    g.addColorStop(1, 'rgba(255,180,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s.PADDLE_RADIUS * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawPaddles() {
    const { ctx, state: s } = this;
    const isP2 = s.playerNumber === 2;
    const pw   = s.powers || {};

    // Effective radii (1.9× when big power is active — matches server)
    const r1 = (pw.p1Big ? 1.9 : 1) * s.PADDLE_RADIUS;
    const r2 = (pw.p2Big ? 1.9 : 1) * s.PADDLE_RADIUS;

    this._drawOnePaddle(s.paddle1, this._paddle1Img, r1, isP2, pw.p1Frozen, '#818cf8');
    this._drawOnePaddle(s.paddle2, this._paddle2Img, r2, isP2, pw.p2Frozen, '#818cf8');
  }

  _drawOnePaddle(pos, img, radius, rotated, frozen, freezeColor) {
    const { ctx } = this;
    const size = radius * 2;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (rotated) ctx.rotate(Math.PI);
    ctx.drawImage(img, -radius, -radius, size, size);
    // Freeze overlay: blue tint ring
    if (frozen) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = freezeColor;
      ctx.lineWidth   = 4;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _drawPuck() {
    const { ctx, state: s } = this;
    const size = s.PUCK_RADIUS * 2;

    if (s.puckSpeed > 0.25) {
      const t  = Math.min((s.puckSpeed - 0.25) / 0.75, 1);
      const g2 = Math.round(200 * (1 - t));
      const a  = 0.35 + t * 0.45;
      ctx.save();
      ctx.translate(s.puck.x, s.puck.y);
      const glow = ctx.createRadialGradient(0, 0, s.PUCK_RADIUS * 0.3, 0, 0, s.PUCK_RADIUS * 3);
      glow.addColorStop(0, `rgba(255,${g2},0,${a})`);
      glow.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, s.PUCK_RADIUS * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(s.puck.x, s.puck.y);
    ctx.drawImage(this._puckImg, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  static randomGoalColor() {
    return GOAL_COLORS[Math.floor(Math.random() * GOAL_COLORS.length)];
  }
}
