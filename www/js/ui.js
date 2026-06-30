import { GRACE_SEC } from './config.js';
import { Renderer } from './renderer.js';

/**
 * UI — manages all in-game overlays and animated DOM elements.
 * Receives callbacks; never touches network or game state directly.
 *
 * Overlays managed:
 *   1. Reconnect / pause overlay  (#reconnectOverlay)
 *   2. Quick-match searching card (#searchingOverlay)
 *   3. Game-over dialog           (#gameOverDialog)
 *   4. Goal animation             (#goalAnimation)
 *   5. Start countdown            (#startCountdown)
 */
export class UI {

  // ─── 1. Reconnect overlay ──────────────────────────────────────────────────

  showReconnect(message, secondLine) {
    let el = document.getElementById('reconnectOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reconnectOverlay';
      el.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,0.82);color:#fff;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;text-align:center;z-index:1500;' +
        "font-family:'Montserrat','Arial',sans-serif;padding:24px;gap:14px;";
      document.body.appendChild(el);
    }
    const lines = message.split('\n');
    let html = `<div style="font-size:20px;opacity:0.9;line-height:1.5;">${lines.join('<br>')}</div>`;
    if (secondLine !== undefined) {
      html += `<div style="font-size:52px;font-weight:bold;color:#ff9900;` +
              `text-shadow:0 0 20px #ff9900;">${secondLine}</div>`;
    }
    el.innerHTML = html;
    el.style.display = 'flex';
  }

  hideReconnect() {
    const el = document.getElementById('reconnectOverlay');
    if (el) el.style.display = 'none';
  }

  /**
   * Shows a ticking countdown overlay.
   * @returns {function} cancel function — call to stop the timer
   */
  startCountdownOverlay(titleLine, onExpire) {
    let remaining = GRACE_SEC;
    this.showReconnect(titleLine, remaining);
    const timer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timer);
        if (onExpire) onExpire();
      } else {
        this.showReconnect(titleLine, remaining);
      }
    }, 1000);
    return () => clearInterval(timer);
  }

  // ─── 2. Searching overlay ──────────────────────────────────────────────────

  showSearching(onCancel) {
    let el = document.getElementById('searchingOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'searchingOverlay';
      el.style.cssText =
        'position:fixed;inset:0;z-index:1600;display:grid;place-items:center;' +
        'background:rgba(8,8,22,0.82);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
        "font-family:'Montserrat','Arial',sans-serif;padding:24px;box-sizing:border-box;";
      el.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:24px;' +
        'padding:34px 30px;border-radius:26px;background:rgba(255,255,255,0.06);' +
        'border:1px solid rgba(255,255,255,0.14);box-shadow:0 24px 60px rgba(0,0,0,0.55);">' +
          '<div style="font-family:\'Orbitron\',sans-serif;font-size:19px;font-weight:700;' +
          'letter-spacing:0.5px;color:#eef1f8;">Rakip Aranıyor</div>' +
          '<div style="width:54px;height:54px;border:4px solid rgba(255,255,255,0.18);' +
          'border-top-color:#22d3ee;border-radius:50%;animation:qmspin 0.9s linear infinite;"></div>' +
          '<button id="cancelSearchBtn" style="padding:13px 34px;font-size:16px;border:none;' +
          'border-radius:14px;background:linear-gradient(135deg,#f43f5e 0%,#7c3aed 100%);' +
          'color:#fff;font-weight:700;cursor:pointer;box-shadow:0 8px 22px rgba(124,58,237,0.4);">' +
          'İptal</button>' +
        '</div>';
      document.body.appendChild(el);

      if (!document.getElementById('qmSpinStyle')) {
        const st = document.createElement('style');
        st.id = 'qmSpinStyle';
        st.textContent = '@keyframes qmspin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
      }
    }
    // Re-wire cancel button each time (onCancel may differ)
    const btn = el.querySelector('#cancelSearchBtn');
    if (btn) {
      btn.onclick = onCancel;
    }
    el.style.display = 'grid';
  }

  hideSearching() {
    const el = document.getElementById('searchingOverlay');
    if (el) el.style.display = 'none';
  }

  // ─── 3. Game-over dialog ───────────────────────────────────────────────────

  /**
   * @param {string}   message   - 'Kazandınız!' | 'Kaybettiniz!'
   * @param {{player1:number, player2:number}} score
   * @param {number}   playerNumber - 1 or 2 (to label score sides)
   * @param {function} onNewGame
   */
  showGameOver(message, score, playerNumber, onNewGame) {
    const existing = document.getElementById('gameOverDialog');
    if (existing) existing.remove();

    const isWin = message.includes('Kazand');
    const p1    = score?.player1 ?? 0;
    const p2    = score?.player2 ?? 0;
    const myScore  = playerNumber === 2 ? p2 : p1;
    const oppScore = playerNumber === 2 ? p1 : p2;

    const winIcon = `<svg viewBox="0 0 24 24" fill="currentColor" width="52" height="52">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
    </svg>`;
    const loseIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" width="52" height="52">
      <circle cx="12" cy="12" r="10"/>
      <path d="M16 16s-1.5-2-4-2-4 2-4 2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>`;

    const wrap = document.createElement('div');
    wrap.id = 'gameOverDialog';
    wrap.innerHTML = `
      <div class="go-backdrop"></div>
      <div class="go-card">
        <div class="go-icon ${isWin ? 'go-icon--win' : 'go-icon--lose'}">${isWin ? winIcon : loseIcon}</div>
        <h2 class="go-title ${isWin ? 'go-title--win' : 'go-title--lose'}">${message}</h2>
        <div class="go-score">
          <div class="go-score-block go-score--me">
            <span class="go-score-num">${myScore}</span>
            <span class="go-score-lbl">Sen</span>
          </div>
          <div class="go-score-sep">–</div>
          <div class="go-score-block go-score--opp">
            <span class="go-score-num">${oppScore}</span>
            <span class="go-score-lbl">Rakip</span>
          </div>
        </div>
        <button class="btn btn-cta go-btn" id="goNewGameBtn">Yeni Oyun</button>
      </div>
    `;

    document.body.appendChild(wrap);
    wrap.querySelector('#goNewGameBtn').addEventListener('click', () => {
      wrap.classList.add('go-exit');
      setTimeout(() => { wrap.remove(); if (onNewGame) onNewGame(); }, 280);
    });
  }

  removeGameOver() {
    const el = document.getElementById('gameOverDialog');
    if (el) el.remove();
  }

  // ─── 4. Goal animation ─────────────────────────────────────────────────────

  showGoalAnimation() {
    const el = document.getElementById('goalAnimation');
    if (!el) return;
    el.style.color = Renderer.randomGoalColor();
    el.style.display = 'block';
    el.classList.remove('show');
    void el.offsetWidth; // force reflow
    el.classList.add('show');
    try { if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]); } catch {}
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.style.display = 'none'; }, 500);
    }, 1500);
  }

  // ─── 5. Start countdown ────────────────────────────────────────────────────

  showStartCountdown(onComplete) {
    const el = document.getElementById('startCountdown');
    const steps = [
      ['Hazır ol!', '#ffffff', 'countdownPop 0.6s ease-out forwards',  '3.2rem'],
      ['3',         '#ff4444', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['2',         '#ffaa00', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['1',         '#44ff44', 'countdownPop 0.5s ease-out forwards',  '7rem'],
      ['BAŞLA!',    '#39ff14', 'countdownGo  0.55s ease-out forwards', '5rem'],
    ];
    let i = 0;

    const show = (idx) => {
      const [text, color, anim, size] = steps[idx];
      el.style.display   = 'flex';
      el.style.opacity   = '1';
      el.style.color     = color;
      el.style.fontSize  = size;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = anim;
      el.textContent     = text;
    };

    const next = () => {
      i++;
      if (i >= steps.length) return;
      show(i);
      if (i < steps.length - 1) {
        setTimeout(next, 900);
      } else {
        setTimeout(() => {
          el.style.opacity = '0';
          setTimeout(() => {
            el.style.display   = 'none';
            el.style.opacity   = '1';
            el.style.animation = 'none';
            el.textContent     = '';
            if (onComplete) onComplete();
          }, 350);
        }, 600);
      }
    };

    show(0);
    setTimeout(next, 1100);
  }

  // ─── 6. Active power countdown ring ───────────────────────────────────────

  /**
   * Shows a small circular countdown ring near the FAB for durationMs.
   * One ring per call; a new call replaces the previous one.
   */
  showPowerCountdown(powerId, durationMs) {
    // Power label + color map
    const META = {
      speed:     { label: '⚡', color: '#facc15' },
      big:       { label: '🛡', color: '#22d3ee' },
      freeze:    { label: '❄',  color: '#818cf8' },
      smallGoal: { label: '🥅', color: '#fb923c' },
    };
    const m = META[powerId] || { label: '✨', color: '#fff' };

    let wrap = document.getElementById('powerCountdownWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'powerCountdownWrap';
      wrap.style.cssText =
        'position:fixed;bottom:96px;left:16px;z-index:1250;' +
        'display:flex;flex-direction:column;align-items:center;gap:4px;' +
        'pointer-events:none;';
      document.body.appendChild(wrap);
    }

    const SIZE = 48, R = 20, CIRC = 2 * Math.PI * R;
    wrap.innerHTML = `
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" style="transform:rotate(-90deg)">
        <circle cx="24" cy="24" r="${R}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
        <circle id="pcRing" cx="24" cy="24" r="${R}" fill="none"
          stroke="${m.color}" stroke-width="3" stroke-linecap="round"
          stroke-dasharray="${CIRC}" stroke-dashoffset="0"
          style="transition:stroke-dashoffset linear ${durationMs}ms"/>
      </svg>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-58%);
        font-size:18px;line-height:1;">${m.label}</div>
    `;

    // Trigger animation on next frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ring = document.getElementById('pcRing');
        if (ring) ring.style.strokeDashoffset = `${CIRC}`;
      });
    });

    clearTimeout(this._pcTimer);
    this._pcTimer = setTimeout(() => {
      wrap.style.opacity = '0';
      wrap.style.transition = 'opacity 0.3s';
      setTimeout(() => { wrap.remove(); }, 300);
    }, durationMs);

    wrap.style.opacity = '1';
    wrap.style.transition = 'none';
  }

  // ─── 7. Match point warning ────────────────────────────────────────────────

  showMatchPoint() {
    // Edge pulse overlay
    let el = document.getElementById('matchPointOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'matchPointOverlay';
      el.style.cssText =
        'position:fixed;inset:0;z-index:1400;pointer-events:none;' +
        'display:flex;align-items:center;justify-content:center;';
      document.body.appendChild(el);
    }

    el.innerHTML = `
      <div id="mpEdge" style="position:absolute;inset:0;
        box-shadow:inset 0 0 60px 20px rgba(244,63,94,0.55);
        animation:mpPulse 0.8s ease-in-out 3;"></div>
      <div id="mpText" style="
        font-family:'Orbitron',sans-serif;font-weight:900;font-size:28px;
        color:#f43f5e;letter-spacing:2px;text-align:center;
        text-shadow:0 0 30px rgba(244,63,94,0.9),0 0 60px rgba(244,63,94,0.5);
        animation:mpTextPop 0.45s cubic-bezier(0.34,1.56,0.64,1) both;">
        MAÇ TOPU
      </div>
    `;

    if (!document.getElementById('mpStyle')) {
      const st = document.createElement('style');
      st.id = 'mpStyle';
      st.textContent = `
        @keyframes mpPulse {
          0%,100% { opacity:0; } 50% { opacity:1; }
        }
        @keyframes mpTextPop {
          from { opacity:0; transform:scale(0.6); }
          to   { opacity:1; transform:scale(1); }
        }
      `;
      document.head.appendChild(st);
    }

    el.style.display = 'flex';
    clearTimeout(this._mpTimer);
    this._mpTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.5s';
      setTimeout(() => { el.style.display = 'none'; el.style.opacity = '1'; el.style.transition = ''; }, 500);
    }, 2200);
  }

  hideMatchPoint() {
    const el = document.getElementById('matchPointOverlay');
    if (el) el.style.display = 'none';
  }

  // ─── 8. Overtime announcement ─────────────────────────────────────────────

  showOvertime() {
    // Remove any existing
    document.getElementById('overtimeBanner')?.remove();

    if (!document.getElementById('otAnimStyle')) {
      const st = document.createElement('style');
      st.id = 'otAnimStyle';
      st.textContent = `
        @keyframes otSlideIn {
          from { transform: translateY(-120%) scale(0.85); opacity: 0; }
          to   { transform: translateY(0)        scale(1);    opacity: 1; }
        }
        @keyframes otPulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(251,146,60,0); }
          50%      { box-shadow: 0 0 0 16px rgba(251,146,60,0.35); }
        }
        @keyframes otShimmer {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.65; }
        }
      `;
      document.head.appendChild(st);
    }

    const wrap = document.createElement('div');
    wrap.id = 'overtimeBanner';
    wrap.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:1400;display:flex;' +
      'align-items:center;justify-content:center;padding:' +
      'max(52px,env(safe-area-inset-top)) 20px 0;pointer-events:none;';

    const card = document.createElement('div');
    card.style.cssText =
      'display:flex;flex-direction:column;align-items:center;gap:4px;' +
      'padding:14px 32px 16px;border-radius:20px;' +
      'background:linear-gradient(135deg,rgba(251,146,60,0.18) 0%,rgba(244,63,94,0.18) 100%);' +
      'border:1.5px solid rgba(251,146,60,0.55);' +
      'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'box-shadow:0 12px 36px rgba(0,0,0,0.5);' +
      'animation:otSlideIn 0.45s cubic-bezier(0.34,1.56,0.64,1) both,otPulse 2s ease 0.6s infinite;';

    card.innerHTML =
      '<div style="font-family:\'Orbitron\',sans-serif;font-size:22px;font-weight:900;' +
      'letter-spacing:2px;color:#fb923c;text-shadow:0 0 20px rgba(251,146,60,0.8),' +
      '0 0 40px rgba(251,146,60,0.4);animation:otShimmer 1.6s ease infinite;">UZATMA</div>' +
      '<div style="font-family:\'Montserrat\',sans-serif;font-size:12px;font-weight:600;' +
      'color:rgba(255,255,255,0.75);letter-spacing:0.5px;">2 fark için oyna</div>';

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    // Auto-hide after 4 seconds
    setTimeout(() => {
      if (wrap.parentNode) {
        wrap.style.transition = 'opacity 0.4s';
        wrap.style.opacity = '0';
        setTimeout(() => wrap.remove(), 420);
      }
    }, 4000);
  }

  // ─── 9. Power-up FAB ───────────────────────────────────────────────────────

  /**
   * Creates the power-up FAB in the bottom-right corner.
   * Call once when gameplay begins; use show/hide to toggle visibility.
   * @param {function} onSelect - called with power id: 'speed' | 'big' | 'freeze'
   * @returns {{ show, hide, destroy }} controls
   */
  initPowerUpButton(onSelect) {
    // Remove any previous instance
    document.getElementById('powerupFab')?.remove();
    document.getElementById('powerupStyle')?.remove();

    const POWERS = [
      {
        id: 'speed', label: 'Turbo', color: '#facc15', shadow: 'rgba(250,204,21,0.55)',
        svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>`,
      },
      {
        id: 'big', label: 'Dev Raket', color: '#22d3ee', shadow: 'rgba(34,211,238,0.55)',
        svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5z"/></svg>`,
      },
      {
        id: 'freeze', label: 'Dondur', color: '#818cf8', shadow: 'rgba(129,140,248,0.55)',
        svg: `<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M22 11h-4.17l2.24-2.24-1.41-1.42L15 11h-2V9l3.66-3.66-1.42-1.41L13 5.83V2h-2v3.83L8.76 3.93 7.34 5.34 11 9v2H9L5.34 7.34 3.93 8.76 6.17 11H2v2h4.17l-2.24 2.24 1.41 1.42L9 13h2v2l-3.66 3.66 1.42 1.41L11 18.17V22h2v-3.83l2.24 2.24 1.42-1.41L13 15v-2h2l3.66 3.66 1.41-1.42L17.83 13H22z"/></svg>`,
      },
      {
        id: 'smallGoal', label: 'Kale Küçült', color: '#fb923c', shadow: 'rgba(251,146,60,0.55)',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M4 20v-8h16v8"/><path d="M8 12V6h8v6"/><line x1="12" y1="6" x2="12" y2="20"/></svg>`,
      },
    ];

    // Fan layout: first 3 powers in the original arc (up → diagonal → right),
    // 4th power (smallGoal) sits above the arc group — visually separated.
    const FAN = [
      { x: 0,   y: -96  },   // straight up   (Turbo)
      { x: 68,  y: -68  },   // diagonal      (Dev Raket)
      { x: 96,  y: 0    },   // straight right (Dondur)
      { x: 0,   y: -172 },   // above group   (Kale Küçült)
    ];

    // Inject keyframes + base styles once
    const style = document.createElement('style');
    style.id = 'powerupStyle';
    style.textContent = `
      #powerupFab { position:fixed; bottom:24px; left:24px; width:58px; height:58px;
        display:none; align-items:center; justify-content:center; z-index:1200; }
      .pu-main {
        width:58px; height:58px; border-radius:50%; border:none; cursor:pointer;
        background: rgba(15,15,30,0.85);
        border: 2px solid rgba(255,255,255,0.18);
        box-shadow: 0 0 18px rgba(34,211,238,0.35), 0 4px 16px rgba(0,0,0,0.5);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        color: #22d3ee; display:flex; align-items:center; justify-content:center;
        transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1),
                    box-shadow 0.2s, border-color 0.2s;
        position: relative; z-index: 2;
        -webkit-tap-highlight-color: transparent;
      }
      .pu-main.open {
        transform: rotate(45deg);
        border-color: rgba(34,211,238,0.5);
        box-shadow: 0 0 28px rgba(34,211,238,0.6), 0 4px 20px rgba(0,0,0,0.6);
      }
      .pu-item {
        position: absolute; bottom: 0; left: 0;
        width: 50px; height: 50px; border-radius: 50%; border: none; cursor: pointer;
        background: rgba(15,15,30,0.9);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 2px solid rgba(255,255,255,0.12);
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 1px;
        opacity: 0; transform: scale(0);
        transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.34,1.56,0.64,1),
                    box-shadow 0.2s;
        pointer-events: none;
        -webkit-tap-highlight-color: transparent;
      }
      .pu-item.visible { opacity: 1; transform: scale(1); pointer-events: auto; }
      .pu-item:active { transform: scale(0.9) !important; }
      .pu-label {
        font-size: 8px; font-weight: 700; letter-spacing: 0.3px;
        font-family: 'Montserrat', sans-serif; color: #fff; opacity: 0.85;
        text-transform: uppercase; line-height: 1;
      }
      @keyframes puPulse {
        0%,100% { box-shadow: 0 0 18px rgba(34,211,238,0.35), 0 4px 16px rgba(0,0,0,0.5); }
        50%      { box-shadow: 0 0 28px rgba(34,211,238,0.6),  0 4px 20px rgba(0,0,0,0.6); }
      }
      .pu-main:not(.open) { animation: puPulse 2.4s ease-in-out infinite; }
    `;
    document.head.appendChild(style);

    // Container
    const container = document.createElement('div');
    container.id = 'powerupFab';

    // Fire `handler` on tap. Uses touchend (not click) so it registers reliably
    // under multi-touch — i.e. tapping a power while the other finger holds the
    // paddle. preventDefault on touchend suppresses the ghost click; a dedupe
    // guard keeps the desktop click path from double-firing.
    const bindActivate = (el, handler) => {
      let handledByTouch = false;
      el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handledByTouch = true;
        handler();
        setTimeout(() => { handledByTouch = false; }, 500);
      }, { passive: false });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handledByTouch) return;
        handler();
      });
    };

    // Main FAB — the ⚡ toggle (created before items so item handlers can close it)
    const mainBtn = document.createElement('button');
    mainBtn.className = 'pu-main';
    mainBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>`;
    mainBtn.setAttribute('aria-label', 'Özel Güçler');

    let open = false;
    const items = () => container.querySelectorAll('.pu-item');

    // (Re)builds all power sub-items. Each power is one-time-use within a game
    // (its button is removed when activated), so this must run at the start of
    // every new game to restore the full set. See `reset` in the returned API.
    const _buildItems = () => {
      container.querySelectorAll('.pu-item').forEach(el => el.remove());
      POWERS.forEach((p, i) => {
        const item = document.createElement('button');
        item.className = 'pu-item';
        item.dataset.id = p.id;
        item.style.color = p.color;
        item.style.borderColor = `rgba(${_hexToRgb(p.color)},0.4)`;
        item.innerHTML = p.svg + `<span class="pu-label">${p.label}</span>`;

        // Position: start at center, animate to fan position
        item.style.bottom  = `${4 - FAN[i].y}px`;  // negative y = up
        item.style.left    = `${4 + FAN[i].x}px`;  // positive x = right
        item.style.transitionDelay = `${i * 40}ms`;

        bindActivate(item, () => {
          _closeMenu();
          // Remove this power-up from DOM — one-time use (restored on reset())
          item.classList.remove('visible');
          setTimeout(() => item.remove(), 300); // wait for fade-out transition
          onSelect?.(p.id);
          // Brief glow feedback on the main button
          mainBtn.style.boxShadow = `0 0 32px ${p.shadow}, 0 4px 20px rgba(0,0,0,0.6)`;
          setTimeout(() => { mainBtn.style.boxShadow = ''; }, 600);
        });

        // Insert before mainBtn so the toggle stays the last child (top z-order)
        container.insertBefore(item, mainBtn);
      });
    };

    const _openMenu = () => {
      open = true;
      mainBtn.classList.add('open');
      items().forEach((el, i) => {
        setTimeout(() => el.classList.add('visible'), i * 40);
      });
    };
    const _closeMenu = () => {
      open = false;
      mainBtn.classList.remove('open');
      items().forEach(el => el.classList.remove('visible'));
    };

    // touchend-based activation (see bindActivate) so the toggle works under
    // multi-touch and the document close-listener isn't tripped by its own tap.
    bindActivate(mainBtn, () => { open ? _closeMenu() : _openMenu(); });

    // Tap anywhere else closes the menu
    document.addEventListener('click', _closeMenu);
    document.addEventListener('touchstart', _closeMenu, { passive: true });

    container.appendChild(mainBtn);
    _buildItems();
    document.body.appendChild(container);

    return {
      show:    () => { container.style.display = 'flex'; },
      hide:    () => { _closeMenu(); container.style.display = 'none'; },
      reset:   () => { _closeMenu(); _buildItems(); }, // restore all powers for a new game
      destroy: () => { _closeMenu(); container.remove(); style.remove();
                       document.removeEventListener('click', _closeMenu);
                       document.removeEventListener('touchstart', _closeMenu); },
    };
  }
}

// ── internal helper ────────────────────────────────────────────────────────────
function _hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}
