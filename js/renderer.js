import { GOAL_WIDTH_RATIO, LERP_PUCK, LERP_OPP } from './config.js';

const GOAL_COLORS = [
  '#39ff14','#ff1493','#00ffff','#ff4500',
  '#ffff00','#ff00ff','#1e90ff','#ff3800','#9400d3','#7fff00',
];

/**
 * Renderer — owns the canvas element and all drawing logic.
 * Reads from `state` but never writes to it.
 *
 * Performance strategy (critical on iOS WKWebView):
 *   - ctx.shadowBlur is extremely slow per-frame → used ONCE when baking the
 *     static background layer, never in the live loop.
 *   - The static layer (bg gradient, grid, center line/circle, HUD corners) is
 *     rendered once to an offscreen canvas on resize, then blitted each frame.
 *   - Paddle/puck glows use pre-rendered radial-gradient sprites (cheap drawImage)
 *     instead of recreating gradients or using shadowBlur every frame.
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

    // Cached offscreen layers (built in resize)
    this._static = document.createElement('canvas');
    this._glowGreen = null;
    this._glowRed   = null;
    this._glowPuck  = null;
    this._glowHit   = null;
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

    this._buildStaticLayer();
    this._buildGlowSprites();
  }

  // ─── Offscreen layer baking (one-time, on resize) ──────────────────────────

  /**
   * Bakes the unchanging field decoration into an offscreen canvas.
   * Everything here is symmetric under the 180° player-2 rotation, so the layer
   * can be blitted before the rotate transform. shadowBlur is OK here — runs once.
   */
  _buildStaticLayer() {
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!W || !H) return;

    this._static.width  = W;
    this._static.height = H;
    const ctx = this._static.getContext('2d');
    const cx = W / 2;
    const cy = H / 2;

    // Deep-space radial gradient background (opaque — clears prior frame on blit)
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.72);
    bg.addColorStop(0, '#080818');
    bg.addColorStop(1, '#000000');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Faint HUD grid
    ctx.strokeStyle = 'rgba(34,211,238,0.045)';
    ctx.lineWidth = 1;
    const grid = W * 0.111;
    for (let x = 0; x <= W; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Center line — neon cyan glow
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = 'rgba(34,211,238,0.55)';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([8, 16]);
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(W, cy);
    ctx.stroke();
    ctx.restore();

    // Center circle + dot
    const circleR = W * 0.16;
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 14;
    ctx.strokeStyle = 'rgba(34,211,238,0.45)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, circleR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(34,211,238,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // HUD corner brackets
    const arm = W * 0.065;
    const gap = 6;
    ctx.save();
    ctx.strokeStyle = 'rgba(34,211,238,0.35)';
    ctx.lineWidth   = 2;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur  = 8;
    ctx.lineCap     = 'square';
    const corners = [
      [gap, gap, 1, 1], [W - gap, gap, -1, 1],
      [gap, H - gap, 1, -1], [W - gap, H - gap, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * arm);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Builds reusable radial-glow sprites sized to the current paddle/puck radius. */
  _buildGlowSprites() {
    const pr = this.state.PADDLE_RADIUS || 40;
    const ur = this.state.PUCK_RADIUS   || 20;
    this._glowGreen = this._radialGlow(Math.ceil(pr * 2.4), '74,222,128');
    this._glowRed   = this._radialGlow(Math.ceil(pr * 2.4), '244,63,94');
    this._glowHit   = this._radialGlow(Math.ceil(pr * 4.8), '255,220,80');
    this._glowPuck  = this._radialGlow(Math.ceil(ur * 6),   '255,90,0');
  }

  _radialGlow(size, rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0,    `rgba(${rgb},0.55)`);
    grad.addColorStop(0.45, `rgba(${rgb},0.26)`);
    grad.addColorStop(1,    `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(r, r, r, 0, Math.PI * 2);
    g.fill();
    return c;
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

    // Blit baked static field (opaque — also clears the previous frame)
    ctx.drawImage(this._static, 0, 0);

    ctx.save();
    if (s.playerNumber === 2) {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    }

    this._drawGoals();
    this._drawNames();
    this._drawScores();
    this._drawHitFlash();
    this._drawPaddles();
    this._updateTrail();
    this._drawTrail();
    this._drawPuck();

    ctx.restore();
  }

  /** Goals are dynamic (smallGoal power changes width) — no shadowBlur, fake glow. */
  _drawGoals() {
    const { canvas, ctx, state: s } = this;
    const pw    = s.powers || {};
    const SMALL = 0.32;
    const thick = 5;

    const topRatio    = pw.p2SmallGoal ? SMALL : GOAL_WIDTH_RATIO;
    const bottomRatio = pw.p1SmallGoal ? SMALL : GOAL_WIDTH_RATIO;

    const gwTop = canvas.width * topRatio;
    const gsTop = (canvas.width - gwTop) / 2;
    const gwBot = canvas.width * bottomRatio;
    const gsBot = (canvas.width - gwBot) / 2;

    const topColor = pw.p2SmallGoal ? '244,63,94' : '34,211,238';
    const botColor = pw.p1SmallGoal ? '244,63,94' : '34,211,238';

    // Top goal walls
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, thick);
    ctx.fillRect(0, 0, gsTop, 22);
    ctx.fillRect(gsTop + gwTop, 0, canvas.width - gsTop - gwTop, 22);
    this._goalPosts(gsTop, gsTop + gwTop, 0, 22, topColor);
    ctx.fillStyle = `rgba(${topColor},${pw.p2SmallGoal ? 0.14 : 0.07})`;
    ctx.fillRect(gsTop, 0, gwTop, 22);

    // Bottom goal walls
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, canvas.height - thick, canvas.width, thick);
    ctx.fillRect(0, canvas.height - 22, gsBot, 22);
    ctx.fillRect(gsBot + gwBot, canvas.height - 22, canvas.width - gsBot - gwBot, 22);
    this._goalPosts(gsBot, gsBot + gwBot, canvas.height, -22, botColor);
    ctx.fillStyle = `rgba(${botColor},${pw.p1SmallGoal ? 0.14 : 0.07})`;
    ctx.fillRect(gsBot, canvas.height - 22, gwBot, 22);
  }

  /** Two goalposts with a faked glow (wide soft stroke under a crisp core). */
  _goalPosts(x1, x2, edgeY, dir, rgb) {
    const ctx = this.ctx;
    const innerY = edgeY + dir;
    // Soft outer glow
    ctx.strokeStyle = `rgba(${rgb},0.25)`;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(x1, edgeY); ctx.lineTo(x1, innerY);
    ctx.moveTo(x2, edgeY); ctx.lineTo(x2, innerY);
    ctx.stroke();
    // Crisp core
    ctx.strokeStyle = `rgb(${rgb})`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x1, edgeY); ctx.lineTo(x1, innerY);
    ctx.moveTo(x2, edgeY); ctx.lineTo(x2, innerY);
    ctx.stroke();
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
    ctx.fillStyle = 'rgba(244,63,94,0.26)';
    ctx.fillText(s.score.player2.toString(), 0, 0);
    ctx.restore();

    // Bottom half (self)
    ctx.fillStyle = 'rgba(74,222,128,0.26)';
    ctx.fillText(s.score.player1.toString(), canvas.width / 2, canvas.height * 3 / 4);
  }

  _drawHitFlash() {
    const { ctx, state: s } = this;
    const age = Date.now() - s.hitFlashTime;
    if (s.hitFlashTime <= 0 || age >= 250 || !this._glowHit) return;

    const alpha  = 1 - age / 250;
    const target = s.hitFlashPlayer === 1 ? s.paddle1 : s.paddle2;
    const sz = this._glowHit.width;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._glowHit, target.x - sz / 2, target.y - sz / 2, sz, sz);
    ctx.restore();
  }

  _drawPaddles() {
    const { state: s } = this;
    const isP2 = s.playerNumber === 2;
    const pw   = s.powers || {};

    const r1 = (pw.p1Big ? 1.9 : 1) * s.PADDLE_RADIUS;
    const r2 = (pw.p2Big ? 1.9 : 1) * s.PADDLE_RADIUS;

    this._drawOnePaddle(s.paddle1, this._paddle1Img, r1, isP2, pw.p1Frozen, '#818cf8', this._glowGreen);
    this._drawOnePaddle(s.paddle2, this._paddle2Img, r2, isP2, pw.p2Frozen, '#818cf8', this._glowRed);
  }

  _drawOnePaddle(pos, img, radius, rotated, frozen, freezeColor, glowSprite) {
    const { ctx } = this;
    const size = radius * 2;
    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (rotated) ctx.rotate(Math.PI);

    // Pre-rendered glow sprite scaled to current paddle size
    if (glowSprite) {
      const gs = radius * 2.4;
      ctx.drawImage(glowSprite, -gs / 2, -gs / 2, gs, gs);
    }

    ctx.drawImage(img, -radius, -radius, size, size);

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
      const t     = i / (len - 1);
      const pt    = trail[i];
      if (pt.speed < 0.15) continue;

      const opacity = t * t * (isTurbo ? 0.75 : 0.45);
      const radius  = s.PUCK_RADIUS * (0.25 + t * 0.55);
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

    // Speed glow via pre-rendered sprite (scaled + faded by speed)
    if (s.puckSpeed > 0.25 && this._glowPuck) {
      const t  = Math.min((s.puckSpeed - 0.25) / 0.75, 1);
      const gs = this._glowPuck.width * (0.7 + t * 0.5);
      ctx.save();
      ctx.globalAlpha = 0.35 + t * 0.45;
      ctx.drawImage(this._glowPuck, s.puck.x - gs / 2, s.puck.y - gs / 2, gs, gs);
      ctx.restore();
    }

    ctx.drawImage(this._puckImg, s.puck.x - size / 2, s.puck.y - size / 2, size, size);
  }

  static randomGoalColor() {
    return GOAL_COLORS[Math.floor(Math.random() * GOAL_COLORS.length)];
  }
}
