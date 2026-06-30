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
    this._trail = []; // puck position history for trail effect
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

    this._drawBackground();

    ctx.save();
    if (s.playerNumber === 2) {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    }

    this._drawField();
    this._drawHudCorners();
    this._drawNames();
    this._drawScores();
    this._drawHitFlash();
    this._drawPaddles();
    this._updateTrail();
    this._drawTrail();
    this._drawPuck();

    ctx.restore();
  }

  _drawBackground() {
    const { canvas, ctx } = this;
    // Deep space gradient — subtle radial from dark navy center to pure black
    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, canvas.height * 0.72
    );
    grad.addColorStop(0, '#080818');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Faint grid overlay — HUD style
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.045)';
    ctx.lineWidth = 1;
    const gridSize = canvas.width * 0.111; // ~9 columns
    for (let x = 0; x <= canvas.width; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  _drawField() {
    const { canvas, ctx, state: s } = this;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // ── Center line — neon cyan glow ─────────────────────────────────────────
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = 'rgba(34,211,238,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([8, 16]);
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(canvas.width, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Center circle — neon cyan ─────────────────────────────────────────────
    const circleR = canvas.width * 0.16;
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 14;
    ctx.strokeStyle = 'rgba(34,211,238,0.45)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, circleR, 0, Math.PI * 2);
    ctx.stroke();
    // Center dot
    ctx.fillStyle = 'rgba(34,211,238,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // ── Goals ─────────────────────────────────────────────────────────────────
    const pw    = s.powers || {};
    const SMALL = 0.32;
    const thick = 5;

    const topRatio    = pw.p2SmallGoal ? SMALL : GOAL_WIDTH_RATIO;
    const bottomRatio = pw.p1SmallGoal ? SMALL : GOAL_WIDTH_RATIO;

    const gwTop = canvas.width * topRatio;
    const gsTop = (canvas.width - gwTop) / 2;
    const gwBot = canvas.width * bottomRatio;
    const gsBot = (canvas.width - gwBot) / 2;

    const topSmall    = pw.p2SmallGoal;
    const bottomSmall = pw.p1SmallGoal;

    // Top goal walls
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, thick);
    ctx.fillRect(0, 0, gsTop, 22);
    ctx.fillRect(gsTop + gwTop, 0, canvas.width - gsTop - gwTop, 22);

    ctx.save();
    ctx.shadowColor = topSmall ? '#f43f5e' : '#22d3ee';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = topSmall ? '#f43f5e' : '#22d3ee';
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(gsTop, 0);         ctx.lineTo(gsTop, 22);
    ctx.moveTo(gsTop + gwTop, 0); ctx.lineTo(gsTop + gwTop, 22);
    ctx.stroke();
    ctx.restore();

    // Bottom goal walls
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, canvas.height - thick, canvas.width, thick);
    ctx.fillRect(0, canvas.height - 22, gsBot, 22);
    ctx.fillRect(gsBot + gwBot, canvas.height - 22, canvas.width - gsBot - gwBot, 22);

    ctx.save();
    ctx.shadowColor = bottomSmall ? '#f43f5e' : '#22d3ee';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = bottomSmall ? '#f43f5e' : '#22d3ee';
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(gsBot, canvas.height);         ctx.lineTo(gsBot, canvas.height - 22);
    ctx.moveTo(gsBot + gwBot, canvas.height); ctx.lineTo(gsBot + gwBot, canvas.height - 22);
    ctx.stroke();
    ctx.restore();

    // Goal area fills
    ctx.fillStyle = topSmall    ? 'rgba(244,63,94,0.14)'  : 'rgba(34,211,238,0.07)';
    ctx.fillRect(gsTop, 0, gwTop, 22);
    ctx.fillStyle = bottomSmall ? 'rgba(244,63,94,0.14)'  : 'rgba(34,211,238,0.07)';
    ctx.fillRect(gsBot, canvas.height - 22, gwBot, 22);
  }

  _drawHudCorners() {
    const { canvas, ctx } = this;
    const arm = canvas.width * 0.065; // bracket arm length
    const gap = 6;                    // inset from edge
    const lw  = 2;

    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth   = lw;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 8;
    ctx.lineCap     = 'square';

    const corners = [
      [gap, gap,                         1,  1],   // top-left
      [canvas.width - gap, gap,         -1,  1],   // top-right
      [gap, canvas.height - gap,         1, -1],   // bottom-left
      [canvas.width - gap, canvas.height - gap, -1, -1], // bottom-right
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawNames() {
    const { canvas, ctx, state: s } = this;
    ctx.font = `700 ${Math.round(canvas.width * 0.052)}px 'Montserrat', Arial`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';

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
    ctx.textAlign = 'center';

    const fontSize = Math.round(canvas.width * 0.175);
    ctx.font = `900 ${fontSize}px 'Orbitron', Arial`;

    // Top half (opponent) — rotated upright for their perspective
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 4);
    ctx.rotate(Math.PI);
    ctx.shadowColor = '#f43f5e';
    ctx.shadowBlur  = 28;
    ctx.fillStyle = 'rgba(244,63,94,0.22)';
    ctx.fillText(s.score.player2.toString(), 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    // Bottom half (self) — green neon glow
    ctx.save();
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur  = 28;
    ctx.fillStyle = 'rgba(74,222,128,0.22)';
    ctx.fillText(s.score.player1.toString(), canvas.width / 2, canvas.height * 3 / 4);
    ctx.shadowBlur = 0;
    ctx.restore();
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

    this._drawOnePaddle(s.paddle1, this._paddle1Img, r1, isP2, pw.p1Frozen, '#818cf8', '#4ade80');
    this._drawOnePaddle(s.paddle2, this._paddle2Img, r2, isP2, pw.p2Frozen, '#818cf8', '#f43f5e');
  }

  _drawOnePaddle(pos, img, radius, rotated, frozen, freezeColor, glowColor) {
    const { ctx } = this;
    const size = radius * 2;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (rotated) ctx.rotate(Math.PI);

    // Neon glow halo behind paddle
    if (glowColor) {
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur  = 22;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle   = glowColor;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    ctx.drawImage(img, -radius, -radius, size, size);

    // Freeze overlay
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

  _updateTrail() {
    const s = this.state;
    if (!s.gameStarted) { this._trail = []; return; }
    this._trail.push({ x: s.puck.x, y: s.puck.y, speed: s.puckSpeed || 0 });
    if (this._trail.length > 10) this._trail.shift();
  }

  _drawTrail() {
    const { ctx, state: s } = this;
    const trail = this._trail;
    if (trail.length < 2) return;

    const isTurbo = s.powers?.speed;
    const len = trail.length;

    for (let i = 0; i < len - 1; i++) {
      const t      = i / (len - 1);          // 0 = oldest, 1 = newest
      const pt     = trail[i];
      const speed  = pt.speed;
      if (speed < 0.15) continue;            // no trail at low speed

      const opacity = t * t * (isTurbo ? 0.75 : 0.45);
      const radius  = s.PUCK_RADIUS * (0.25 + t * 0.55);

      // Color: cyan for turbo, orange-red for normal
      const r = isTurbo ? 34  : 255;
      const g = isTurbo ? 211 : Math.round(80 * (1 - t));
      const b = isTurbo ? 238 : 0;

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity.toFixed(2)})`;
      ctx.fill();
    }
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
